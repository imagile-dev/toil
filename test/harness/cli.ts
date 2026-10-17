import type { AnyCommand } from '../../src/core/command.js';
import type { Context } from '../../src/core/context.js';
import type { Envelope } from '../../src/core/envelope.js';
import { runProgram } from '../../src/program.js';
import { TEST_VERSION } from './context.js';

export interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Record<string, string>;
  /** The parsed envelope when stdout holds one. */
  envelope: Envelope | undefined;
}

/**
 * Runs the real CLI in-process against `context`, through the same runProgram
 * the shipped entry point uses, capturing everything it writes.
 */
export async function runCli(argv: string[], options: { commands: AnyCommand[]; context: Context }): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const files: Record<string, string> = {};
  const exitCode = await runProgram(
    {
      commands: options.commands,
      version: TEST_VERSION,
      io: {
        stdout: (t) => (stdout += t),
        stderr: (t) => (stderr += t),
        writeFile: (p, c) => (files[p] = c),
      },
      createContext: (globals) => ({ ...options.context, verbose: options.context.verbose || globals.verbose === true }),
      startMcp: async () => {
        throw new Error('runCli does not start MCP; use connectMcp.');
      },
    },
    argv,
    'user',
  );

  let envelope: Envelope | undefined;
  try {
    envelope = JSON.parse(stdout) as Envelope;
  } catch {
    envelope = undefined;
  }
  return { stdout, stderr, exitCode, files, envelope };
}
