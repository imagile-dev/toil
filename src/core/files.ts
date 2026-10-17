import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { ToilError } from './errors.js';

/**
 * The local files a command may read or write: an `--input-file`, a file to
 * upload, a directory to save a download into. Commands go through this rather
 * than `node:fs` so that both front doors resolve paths the same way, tests
 * run against an in-memory copy, and `-` (stdin) means something only where
 * stdin is actually free. Over MCP, stdin is the protocol, so it isn't.
 *
 * Paths a command returns use forward slashes on every platform (CLAUDE.md,
 * Cross-Platform). The filing system accepts either slash; the filing
 * cabinet, historically, only one.
 */
export interface FileAccess {
  /** Absolute path on disk for `path`, resolved against the working directory. */
  resolve(path: string): string;
  /** A file's text, as UTF-8. `-` reads stdin where the front door allows it. */
  readText(path: string): string;
  /** A file's bytes. */
  readBytes(path: string): Uint8Array;
  /** Writes `data`, creating parent directories and replacing any file there. Returns the absolute path written, with forward slashes. */
  writeBytes(path: string, data: Uint8Array): string;
}

/** `C:\work\a.txt` -> `C:/work/a.txt`, for JSON output. */
export function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/** The error for a file that couldn't be read, shared by every FileAccess. */
export function readFailed(path: string, err: unknown): ToilError {
  const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'it does not exist' : (err as Error).message;
  return new ToilError('INVALID_INPUT', `Cannot read ${path === '-' ? 'stdin' : `file "${path}"`}: ${reason}.`, {
    fix: path === '-' ? 'Pipe the content into toil, or pass a file path instead of "-".' : 'Check the path. Relative paths resolve against the working directory.',
  });
}

/** Where `-` can't mean stdin. */
export const STDIN_OVER_MCP = new ToilError('INVALID_INPUT', '"-" (stdin) is not available over MCP: stdin carries the protocol.', {
  fix: 'Pass the content inline, or write it to a file and pass the file path.',
});

/** The error for a write that would replace a file already there. */
export function alreadyExists(path: string): ToilError {
  return new ToilError('INVALID_INPUT', `"${forwardSlashes(path)}" already exists.`, {
    fix: 'Delete it or pass a different --dir. toil never overwrites a file.',
  });
}

/** The error for a path inside toil's own config. It names the path, never what is in it. */
export function protectedPath(path: string): ToilError {
  return new ToilError('INVALID_INPUT', `"${forwardSlashes(path)}" is toil's own configuration, which commands may not read or write.`, {
    fix: 'Pass a file outside ~/.toil and the --config file. Credentials reach a command only through its connection.',
  });
}

/** The error for a path under /proc or /sys. */
export function systemPath(path: string): ToilError {
  return new ToilError('INVALID_INPUT', `"${forwardSlashes(path)}" is under /proc or /sys, which commands may not read.`, {
    fix: 'Pass an ordinary file. Process and kernel files can hold the environment, and with it credentials.',
  });
}

/**
 * `path` with every symlink, junction and `..` resolved, as far as it exists:
 * the longest existing ancestor goes through realpath and the rest is appended.
 * A path that doesn't exist yet (a download target) is judged by where it
 * would land.
 */
function realish(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = realpathSync.native(existing);
  } catch {
    // keep the resolved form
  }
  return join(real, ...rest);
}

/**
 * Kernel views of running processes. `/proc/self/environ` holds every env var,
 * and env vars are where toil's tokens live, so a command reading files could
 * otherwise read the credentials it was never given. No toil command has a
 * reason to read anything under either, so both are refused whole. The
 * check takes the path after realpath, so a symlink to them is refused too.
 */
export function isSystemPath(realPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') return false;
  return /^\/(proc|sys)(\/|$)/.test(realPath);
}

/** Windows paths compare case-insensitively; macOS and Linux paths as written. */
const comparable = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

/**
 * Real files, relative to `cwd`. `stdin: false` for MCP, where `-` can't mean
 * stdin. `protect` lists toil's own config: the config home (`~/.toil`) and
 * the `--config` file. Nothing at or under them is read or written, however
 * the path is spelt, because a command handed a path by an agent (a prompt in
 * an issue description, say) would otherwise send other connections' tokens to
 * its own host. The keys to the filing cabinet are not themselves on file.
 */
export function nodeFiles(options: { cwd: string; stdin: boolean; protect?: string[] }): FileAccess {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(options.cwd, path));
  const guarded = (options.protect ?? []).map((p) => comparable(realish(p)));
  const check = (target: string) => {
    const resolved = realish(target);
    if (isSystemPath(resolved)) throw systemPath(target);
    const real = comparable(resolved);
    if (guarded.some((g) => real === g || real.startsWith(g.endsWith(sep) ? g : g + sep))) throw protectedPath(target);
  };
  const read = (path: string): Buffer => {
    if (path === '-' && !options.stdin) throw STDIN_OVER_MCP;
    if (path !== '-') check(at(path));
    try {
      return readFileSync(path === '-' ? 0 : at(path));
    } catch (err) {
      throw readFailed(path, err);
    }
  };
  return {
    resolve: at,
    readText: (path) => read(path).toString('utf8'),
    readBytes: (path) => new Uint8Array(read(path)),
    writeBytes: (path, data) => {
      const target = at(path);
      check(target);
      try {
        mkdirSync(dirname(target), { recursive: true });
        // wx: fail rather than replace. A download names its own file, and a
        // read-only command must not change what's already on disk (principle 2).
        writeFileSync(target, data, { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw alreadyExists(target);
        throw new ToilError('INVALID_INPUT', `Cannot write "${forwardSlashes(target)}": ${(err as Error).message}.`, {
          fix: 'Choose a directory you can write to.',
        });
      }
      return forwardSlashes(target);
    },
  };
}
