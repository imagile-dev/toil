import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { ToilError } from './errors.js';

/**
 * The one program toil runs that the OS doesn't ship: git, and only for the
 * commands that are git (the `git` area, `deps diff`). Everything else that
 * needs repository facts (root, branch, remotes) reads `.git` in pure JS
 * (`git-repo.ts`), so area context works with no git installed. #68
 * decision 1 records the exception and CLAUDE.md, No Executables, the rule
 * it's an exception to.
 *
 * The safeguards are fixed here, not left to each command:
 *   - git's absolute path is found on PATH by toil itself, skipping relative
 *     entries and the working directory, so a `git.exe` planted in a checkout
 *     is never what runs
 *   - no shell, a fixed subcommand list, `--end-of-options` before revisions
 *     and `--` before paths, so a value can't become a flag
 *   - the repository-config features that run programs are off: the fsmonitor
 *     hook, external diff drivers, textconv filters, the pager
 *   - no prompts (GIT_TERMINAL_PROMPT=0, stdin closed), no optional index
 *     writes (GIT_OPTIONAL_LOCKS=0), and no TOIL_* variables in git's env
 *   - async, cancelled with the command's own signal
 *
 * One exception, approved in writing, reviewed annually, and scoped tighter
 * than the original request. That's how you know it's real.
 */

/** The subcommands toil may run. Adding one is a core change, reviewed here. */
export const GIT_SUBCOMMANDS = ['version', 'status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'ls-tree', 'for-each-ref', 'merge-base', 'rev-list'] as const;
export type GitSubcommand = (typeof GIT_SUBCOMMANDS)[number];

/** Before every subcommand: no pager, and no fsmonitor hook from repository config. */
export const GIT_SAFE_GLOBALS: readonly string[] = ['--no-pager', '-c', 'core.fsmonitor='];
/** After every subcommand that can produce a diff: no external diff driver, no textconv filter. */
export const GIT_SAFE_DIFF: readonly string[] = ['--no-ext-diff', '--no-textconv'];
const PRODUCES_DIFFS = new Set<GitSubcommand>(['diff', 'log', 'show']);

/** Options that write a file or run a program. Commands have no reason to pass them. */
const FORBIDDEN_OPTION = /^--(output|ext-diff|textconv|exec|upload-pack|receive-pack|open-files-in-pager)\b|^-O/;

/** Output past this is refused rather than buffered. */
export const GIT_MAX_OUTPUT = 64 * 1024 * 1024;

export interface GitCall {
  subcommand: GitSubcommand;
  /** Flags, fixed by the command (`--porcelain`, `--format=%H`). Never user input. */
  options?: readonly string[];
  /** Revisions (`main`, `HEAD~3..HEAD`, `v1.2:package.json`); user input is fine here. */
  revisions?: readonly string[];
  /** Pathspecs, after `--`; user input is fine here too. */
  paths?: readonly string[];
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  /** Runs git in the workspace. Rejects with GIT_NOT_FOUND when there's no git to run. */
  run(call: GitCall, signal?: AbortSignal): Promise<GitResult>;
}

/**
 * The argv for a call: safeguards, subcommand, the command's options,
 * `--end-of-options` and revisions, then `--` and paths. A revision that
 * starts with `-` is refused, since some git versions predate
 * `--end-of-options` and a branch can't be named that way anyway.
 */
export function gitArgv(call: GitCall): string[] {
  if (!(GIT_SUBCOMMANDS as readonly string[]).includes(call.subcommand)) {
    throw new ToilError('INTERNAL', `git ${call.subcommand} isn't a subcommand toil runs.`, { fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues.' });
  }
  for (const option of call.options ?? []) {
    if (!option.startsWith('-') || FORBIDDEN_OPTION.test(option)) {
      throw new ToilError('INTERNAL', `git option ${JSON.stringify(option)} isn't allowed.`, { fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues.' });
    }
  }
  for (const rev of call.revisions ?? []) {
    if (rev === '' || rev.startsWith('-')) {
      throw new ToilError('INVALID_INPUT', `${JSON.stringify(rev)} isn't a revision.`, { fix: 'Pass a branch, tag or commit, such as main or HEAD~1.' });
    }
  }
  const argv = [...GIT_SAFE_GLOBALS, call.subcommand];
  if (PRODUCES_DIFFS.has(call.subcommand)) argv.push(...GIT_SAFE_DIFF);
  argv.push(...(call.options ?? []));
  if (call.revisions?.length) argv.push('--end-of-options', ...call.revisions);
  if (call.paths?.length) argv.push('--', ...call.paths);
  return argv;
}

/** git's environment: the caller's, minus every TOIL_* variable, with prompts and optional locks off. */
export function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) if (!/^TOIL_/i.test(key)) out[key] = value;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_OPTIONAL_LOCKS = '0';
  return out;
}

/** An env lookup that ignores case on Windows, where `Path` and `PATH` are the same variable. */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export interface GitSearch {
  /** The absolute path that will run, when one was found. */
  found?: string;
  /** PATH's entries, in order, as searched. */
  searched: string[];
  /** Entries passed over and why, for the error's fix. */
  skipped: Array<{ entry: string; why: string }>;
}

/**
 * Finds git on PATH the way a careful shell would, minus the shell. Relative
 * entries (`.`, `bin`, an empty one) are skipped, as are entries that are the
 * working directory or the workspace, because on Windows the current folder
 * comes first in the default search order and a checkout can carry a
 * `git.exe`. On Windows only `.exe` and `.com` from PATHEXT count, since
 * `.bat` and `.cmd` need a shell to run.
 */
export function findGit(options: { env: NodeJS.ProcessEnv; platform?: NodeJS.Platform; exclude?: readonly string[] }): GitSearch {
  const platform = options.platform ?? process.platform;
  const fold = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
  const realish = (p: string) => {
    try {
      return fold(realpathSync.native(p));
    } catch {
      return fold(p);
    }
  };
  const excluded = new Set((options.exclude ?? []).map(realish));
  const raw = envValue(options.env, 'PATH', platform) ?? '';
  const searched = raw === '' ? [] : raw.split(platform === 'win32' ? ';' : delimiter);
  const skipped: GitSearch['skipped'] = [];
  const names =
    platform === 'win32'
      ? (envValue(options.env, 'PATHEXT', platform) ?? '.COM;.EXE')
          .split(';')
          .filter((ext) => /^\.(exe|com)$/i.test(ext))
          .map((ext) => `git${ext.toLowerCase()}`)
      : ['git'];
  for (const entry of searched) {
    const dir = entry.replace(/^"(.*)"$/, '$1');
    if (dir === '' || !isAbsolute(dir)) {
      skipped.push({ entry, why: 'relative' });
      continue;
    }
    if (excluded.has(realish(dir))) {
      skipped.push({ entry, why: 'the working directory' });
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (runnable(candidate, platform)) return { found: candidate, searched, skipped };
    }
  }
  return { searched, skipped };
}

function runnable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const INSTALL = 'Install git (https://git-scm.com/downloads), or add the folder that holds it to PATH, then run the command again.';

/** The error for no usable git on PATH, naming the PATH that was searched. */
export function gitNotFound(command: string, search: GitSearch): ToilError {
  const path = search.searched.length > 0 ? search.searched.join(process.platform === 'win32' ? ';' : delimiter) : '(empty)';
  const skipped = search.skipped.length > 0 ? ` Skipped: ${search.skipped.map((s) => `${s.entry || '(empty entry)'} (${s.why})`).join(', ')}.` : '';
  return new ToilError('GIT_NOT_FOUND', `git isn't on PATH, and toil ${command} needs it. Only commands that run git need it installed.`, {
    fix: `${INSTALL} PATH searched: ${path}.${skipped}`,
  });
}

/** The error for a git that's there but won't start. */
function gitNotRunnable(command: string, path: string, err: NodeJS.ErrnoException): ToilError {
  return new ToilError('GIT_NOT_FOUND', `git at ${path.replace(/\\/g, '/')} could not be run (${err.code ?? err.message}), and toil ${command} needs it.`, {
    fix: `Reinstall git, or put a working git earlier on PATH. ${INSTALL}`,
  });
}

/**
 * A runner for one command. `workspace` is called on each run, so a command
 * with no workspace fails only if it actually runs git. git is looked up on
 * first use and the answer kept for the rest of the command.
 */
export function createGitRunner(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  /** The folder git runs in; throws when there's no workspace. */
  workspace: () => string;
  /** Folders never searched for git: the working directory and the workspace. */
  exclude: readonly string[];
  platform?: NodeJS.Platform;
}): GitRunner {
  let search: GitSearch | undefined;
  return {
    run: async (call, signal) => {
      const argv = gitArgv(call);
      const cwd = options.workspace();
      search ??= findGit({ env: options.env, exclude: [...options.exclude, cwd], ...(options.platform ? { platform: options.platform } : {}) });
      if (!search.found) throw gitNotFound(options.command, search);
      return spawnGit(search.found, argv, cwd, gitEnv(options.env), options.command, signal);
    },
  };
}

function spawnGit(path: string, argv: string[], cwd: string, env: NodeJS.ProcessEnv, command: string, signal: AbortSignal | undefined): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let child;
    try {
      // shell: false is the default; it's spelled out because it's the point.
      child = spawn(path, argv, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      // Windows refuses a file that isn't a program here, synchronously, rather than with an 'error' event.
      reject(gitNotRunnable(command, path, e as NodeJS.ErrnoException));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let overflow = false;
    const take = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > GIT_MAX_OUTPUT) {
        overflow = true;
        child.kill();
        return;
      }
      into.push(chunk);
    };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (e: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.aborted ? signal.reason : gitNotRunnable(command, path, e));
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(signal.reason);
      if (overflow) {
        return reject(new ToilError('INVALID_INPUT', `git printed more than ${GIT_MAX_OUTPUT / 1024 / 1024} MB, so toil stopped it.`, { fix: 'Narrow the request: fewer commits, a shorter range, or specific paths.' }));
      }
      resolvePromise({ exitCode: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}
