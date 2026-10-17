import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ToilError } from './errors.js';

/**
 * Questions for a person at a terminal, used only by the `toil connections`
 * setup commands. Nothing else in toil prompts, and nothing prompts under MCP,
 * where stdin is the protocol. The CLI builds one only when stdin and stderr
 * are both terminals; everywhere else a command that needs one fails with a
 * fix naming the env vars.
 *
 * Prompts go to stderr so stdout still carries exactly one envelope.
 */
export interface Prompter {
  /** A visible answer; an empty one returns `fallback` (or ''). */
  ask(question: string, fallback?: string): Promise<string>;
  /** An answer read without echo, for a secret. */
  askSecret(question: string): Promise<string>;
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
      if (secret) output.write(question);
      muted = secret;
      return (await Promise.race([rl.question(secret ? '' : question), cancelled])).trim();
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
