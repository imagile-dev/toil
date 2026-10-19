import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
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
  /** An answer read without echo, for a secret. `id` is `secret:<key>`. */
  askSecret(question: string, id?: string): Promise<string>;
}

/**
 * A prompter over Node's own readline. A secret is read with the echo muted:
 * readline writes what is typed to a stream that drops it, so the terminal
 * shows nothing, and nothing reaches scrollback or a screen share.
 * The form asks for your token once and, unusually for a form, then forgets it.
 */
export function terminalPrompter(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Prompter {
  let muted = false;
  const echo = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) output.write(chunk);
      done();
    },
  });

  const read = async (question: string, secret: boolean): Promise<string> => {
    const rl = createInterface({ input, output: echo, terminal: true });
    const cancelled = new Promise<never>((_, reject) =>
      // In raw mode Ctrl+C reaches readline, not the process.
      rl.once('SIGINT', () => reject(new ToilError('CANCELLED', 'Setup was cancelled. Nothing was saved.'))),
    );
    try {
      // A visible question is readline's own prompt, so redrawing the line
      // (after a backspace) keeps it. A secret's question is written before
      // muting, and with the echo muted nothing redraws over it.
      // A question of several lines (toil feedback's report) is written whole,
      // and readline prompts on its last line alone, so a redraw stays on one line.
      const cut = secret ? -1 : question.lastIndexOf('\n');
      if (cut >= 0) output.write(question.slice(0, cut + 1));
      if (secret) output.write(question);
      muted = secret;
      return (await Promise.race([rl.question(secret ? '' : question.slice(cut + 1)), cancelled])).trim();
    } finally {
      muted = false;
      if (secret) output.write('\n');
      rl.close();
    }
  };

  return {
    ask: async (question, fallback) => {
      const answer = await read(`${question}${fallback ? ` [${fallback}]` : ''}: `, false);
      return answer === '' ? (fallback ?? '') : answer;
    },
    askSecret: (question) => read(`${question} (input hidden): `, true),
  };
}
