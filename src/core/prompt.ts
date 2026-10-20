import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import { ToilError } from './errors.js';

/**
 * Questions for a person at a terminal, used only by the `toil connections`
 * setup commands and `toil feedback`'s "send it?". Nothing else in toil prompts, and nothing prompts under MCP,
 * where stdin is the protocol. The CLI builds one only when stdin and stderr
 * are both terminals; a program using the API builds one only from the
 * `person` it passes, whose answers a person typed in that program's own
 * interface (src/api.ts). Everywhere else a command that needs one fails with
 * a fix naming the env vars.
 *
 * Prompts go to stderr so stdout still carries exactly one envelope.
 */
export interface Prompter {
  /**
   * A visible answer; an empty one returns `fallback` (or ''). `id` names the
   * question for a host that asks it in its own interface (src/api.ts,
   * `person`): `area`, `setting:<key>`, `confirm`, `confirm-name` or
   * `consent` (toil feedback's report, shown whole in the question). A
   * terminal shows only the question.
   */
  ask(question: string, fallback?: string, id?: string): Promise<string>;
  /**
   * An answer read without echo, for a secret, exactly as typed or pasted:
   * untrimmed, so `askCheckedSecret()` (src/core/secret-input.ts) can say what
   * it trimmed. `id` is `secret:<key>`. Everything but the skills token asks
   * through `askCheckedSecret()`, which checks the paste.
   */
  askSecret(question: string, id?: string): Promise<string>;
  /** A line for the person, after an answer (`Received 40 characters.`). A host's person has none. */
  note?(line: string): void;
  /** Whether a refused answer can be asked for again: a terminal, yes; a host's person answers once. */
  readonly canAskAgain?: boolean;
}

/**
 * Keys and pastes for a hidden answer, decoded without readline (#358), so
 * the bullets stay one per character whatever the terminal sends: Windows
 * Terminal, conhost, macOS Terminal and the rest. A printable character, a tab,
 * or anything inside a bracketed paste (`ESC[200~` … `ESC[201~`) is part of the
 * answer; Backspace removes the last character, Ctrl+U clears them all, Ctrl+C
 * cancels, and other escape sequences (arrows, focus reports) are ignored.
 *
 * Enter is a chunk that holds nothing but a line break outside any bracketed
 * paste (a paste and its Enter may arrive together). A line break that
 * arrives with other text, outside a bracketed paste, came from a paste on a
 * terminal that doesn't bracket one, so it's kept as part of the answer for
 * `checkSecret()` to report, rather than ending the line halfway through
 * someone's token and typing the rest into the next question.
 */
export class HiddenLine {
  private chars: string[] = [];
  private escape = '';
  private pasting = false;

  get count(): number {
    return this.chars.length;
  }

  get value(): string {
    return this.chars.join('');
  }

  /** Feeds one chunk as it arrived. `enter` and `cancel` end the line; anything after them in the chunk is dropped. */
  feed(chunk: string): 'enter' | 'cancel' | null {
    const pieces = this.split(chunk);
    // A paste and its Enter can arrive together, so only what's typed outside a paste decides.
    const enterOnly = /^[\r\n]+$/.test(pieces.filter((p) => !p.pasted).map((p) => p.c).join(''));
    for (const { c, pasted } of pieces) {
      if (pasted) {
        // A paste keeps its line breaks and tabs, for checkSecret() to report; other controls aren't text.
        if (c >= ' ' || c === '\t' || c === '\r' || c === '\n') this.chars.push(c);
      } else if (c === '\x03') return 'cancel';
      else if (c === '\r' || c === '\n') {
        if (enterOnly) return 'enter';
        this.chars.push(c);
      } else if (c === '\x7f' || c === '\b') this.chars.pop();
      else if (c === '\x15') this.chars = [];
      else if (c === '\t' || c >= ' ') this.chars.push(c);
    }
    return null;
  }

  /** The chunk's characters with escape sequences taken out, each marked by whether a bracketed paste carried it. */
  private split(chunk: string): Array<{ c: string; pasted: boolean }> {
    const out: Array<{ c: string; pasted: boolean }> = [];
    for (const c of chunk) {
      if (this.escape === '' && c !== '\x1b') {
        out.push({ c, pasted: this.pasting });
        continue;
      }
      this.escape += c;
      const e = this.escape;
      if (e.length >= 2 && (e[1] === '[' ? e.length > 2 && /[@-~]/.test(c) : e[1] === 'O' ? e.length === 3 : true)) {
        if (e === '\x1b[200~') this.pasting = true;
        else if (e === '\x1b[201~') this.pasting = false;
        this.escape = '';
      }
    }
    return out;
  }
}

/** The bullet shown for each character of a hidden answer. */
export const BULLET = '\u2022';

/**
 * A prompter for a person at a terminal. A visible answer is Node's own
 * readline. A secret is read with `HiddenLine`, in raw mode, and shown as one
 * bullet per character: never the characters themselves, so nothing reaches
 * scrollback or a screen share but how many there were.
 * The form asks for your token once and, unusually for a form, then forgets it.
 */
export function terminalPrompter(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Prompter {
  const ask = async (question: string): Promise<string> => {
    const rl = createInterface({ input, output, terminal: true });
    const cancelled = new Promise<never>((_, reject) =>
      // In raw mode Ctrl+C reaches readline, not the process.
      rl.once('SIGINT', () => reject(cancel())),
    );
    try {
      // A question of several lines (toil feedback's report) is written whole,
      // and readline prompts on its last line alone, so a redraw stays on one line.
      const cut = question.lastIndexOf('\n');
      if (cut >= 0) output.write(question.slice(0, cut + 1));
      return (await Promise.race([rl.question(question.slice(cut + 1)), cancelled])).trim();
    } finally {
      rl.close();
    }
  };

  const askHidden = (question: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const tty = input as Partial<NodeJS.ReadStream> & NodeJS.ReadableStream;
      const wasRaw = tty.isRaw === true;
      tty.setRawMode?.(true);
      const columns = () => {
        const c = (output as Partial<NodeJS.WriteStream>).columns;
        return typeof c === 'number' && c > 0 ? c : 80;
      };
      const lastLine = question.slice(question.lastIndexOf('\n') + 1);
      const offset = [...lastLine].length;
      const line = new HiddenLine();
      const decoder = new StringDecoder('utf8');
      let drawn = 0;
      // More bullets are appended. Fewer means redrawing the prompt's line,
      // which may have wrapped: up to the row it starts on, clear, and rewrite.
      const draw = () => {
        const n = line.count;
        if (n >= drawn) output.write(BULLET.repeat(n - drawn));
        else {
          const rows = Math.max(0, Math.floor((offset + drawn - 1) / columns()));
          output.write(`${rows ? `\x1b[${rows}A` : ''}\r\x1b[J${lastLine}${BULLET.repeat(n)}`);
        }
        drawn = n;
      };
      const finish = (error: ToilError | null) => {
        input.off('data', onData);
        input.off('end', onEnd);
        output.write('\x1b[?2004l\r\n');
        tty.setRawMode?.(wasRaw);
        input.pause();
        if (error) reject(error);
        else resolve(line.value);
      };
      const onData = (chunk: Buffer | string) => {
        const result = line.feed(typeof chunk === 'string' ? chunk : decoder.write(chunk));
        draw();
        if (result === 'enter') finish(null);
        else if (result === 'cancel') finish(cancel());
      };
      const onEnd = () => finish(cancel());
      // Bracketed paste on, so a pasted line break arrives inside markers rather than as Enter.
      output.write(`${question}\x1b[?2004h`);
      input.on('data', onData);
      input.on('end', onEnd);
      input.resume();
    });

  return {
    ask: async (question, fallback) => {
      const answer = await ask(`${question}${fallback ? ` [${fallback}]` : ''}: `);
      return answer === '' ? (fallback ?? '') : answer;
    },
    askSecret: (question) => askHidden(`${question} (input hidden): `),
    note: (line) => output.write(`${line}\n`),
    canAskAgain: true,
  };
}

function cancel(): ToilError {
  return new ToilError('CANCELLED', 'Setup was cancelled. Nothing was saved.');
}
