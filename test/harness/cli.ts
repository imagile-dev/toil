import { CommanderError } from 'commander';
import type { AnyCommand } from '../../src/core/command.js';
import type { Context } from '../../src/core/context.js';
import type { Envelope } from '../../src/core/envelope.js';
import { buildProgram } from '../../src/program.js';
import { TEST_VERSION } from './context.js';

export interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Record<string, string>;
  /** The parsed envelope when stdout holds one. */
  envelope: Envelope | undefined;
}

/** Runs the real CLI in-process against `context`, capturing everything it writes. */
export async function runCli(argv: string[], options: { commands: AnyCommand[]; context: Context }): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const files: Record<string, string> = {};
  const { program, result } = buildProgram({
    commands: options.commands,
    version: TEST_VERSION,
    io: {
      stdout: (t) => (stdout += t),
      stderr: (t) => (stderr += t),
      writeFile: (p, c) => (files[p] = c),
    },
    createContext: () => options.context,
    startMcp: async () => {
      throw new Error('runCli does not start MCP; use connectMcp.');
    },
  });

  let exitCode: number;
  try {
    await program.parseAsync(argv, { from: 'user' });
    exitCode = result.exitCode;
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
    exitCode = err.exitCode;
  }

  let envelope: Envelope | undefined;
  try {
    envelope = JSON.parse(stdout) as Envelope;
  } catch {
    envelope = undefined;
  }
  return { stdout, stderr, exitCode, files, envelope };
}
