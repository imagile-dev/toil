import { ToilError } from '../../core/errors.js';
import type { CommandContext } from '../../core/context.js';
import type { GitCall, GitResult } from '../../core/git.js';
import type { GitContext } from '../../core/git-repo.js';

/**
 * What every git command shares: finding the repository, running git, and
 * the contract's habits around both. It ran each command with Node's
 * execSync, so output was trimmed whole, more than 1 MB on stdout was a
 * failure (ENOBUFS), and a non-zero exit threw. Those are kept here because
 * they're observable.
 *
 * Paperwork note: this file does not run git. It fills in the form that asks
 * src/core/git.ts to run git, which is the only office authorised to do so.
 */

type Ctx = CommandContext<unknown, Record<string, string | undefined>>;

/** execSync's default maxBuffer, which every contract command but report ran under. */
export const EXEC_MAX_BUFFER = 1024 * 1024;

/**
 * The repository the workspace is in, or the contract's "Not a git
 * repository". Outside one, git is looked for first (`git version`), so a
 * machine with no git gets GIT_NOT_FOUND wherever it runs a git command (#68).
 */
export async function requireRepo(ctx: Ctx): Promise<GitContext> {
  const repo = ctx.repo();
  if (repo) return repo;
  await runGit(ctx, { subcommand: 'version' });
  throw new ToilError('INVALID_INPUT', 'Not a git repository', { fix: 'Run it inside a git clone, or point --workspace at one.' });
}

/** Runs git through core's runner. GIT_NOT_FOUND, a cancel and a timeout reject from here. */
export async function runGit(ctx: Ctx, call: GitCall): Promise<GitResult> {
  // The shipped CLI and MCP server always provide ctx.git; a test that runs git gives it one.
  if (!ctx.git) {
    throw new ToilError('INTERNAL', 'This command needs git, and no git runner was provided.', {
      fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues with the command you ran.',
    });
  }
  return ctx.git.run(call, ctx.signal);
}

/** A git that ran and failed, or printed more than execSync took: what the contract's exec threw. */
export class GitFailed extends ToilError {}

/** What the contract's execSync did with a finished git: throw on failure or overflow, else the trimmed stdout. */
export function execOutput(command: string, result: GitResult, maxBuffer = EXEC_MAX_BUFFER): string {
  if (Buffer.byteLength(result.stdout, 'utf8') > maxBuffer) {
    throw new GitFailed('INVALID_INPUT', `${command} printed more than ${maxBuffer / 1024 / 1024} MB, more than toil reads for it.`, {
      fix: 'Narrow the request, or run git directly for output this large.',
    });
  }
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new GitFailed('INVALID_INPUT', `Command failed: ${command}${stderr ? `\n${stderr}` : ''}`, {
      fix: "Check the repository and the values passed; the message above is git's own.",
    });
  }
  return result.stdout.trim();
}

/**
 * The contract's `try { ... } catch { return empty }`: a git that ran and
 * failed is an empty result. Anything else still surfaces, because it isn't
 * git's answer: no git to run (GIT_NOT_FOUND, decided on #68), a cancel or a
 * timeout, an argument core refused before running, or output past core's cap.
 */
export async function swallowGitFailure<T>(run: () => Promise<T>, empty: () => T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GitFailed) return empty();
    throw err;
  }
}
