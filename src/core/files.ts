import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
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
  /** Writes `data`, creating parent directories. Returns the absolute path written, with forward slashes. */
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

/** Real files, relative to `cwd`. `stdin: false` for MCP, where `-` can't mean stdin. */
export function nodeFiles(options: { cwd: string; stdin: boolean }): FileAccess {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(options.cwd, path));
  const read = (path: string): Buffer => {
    if (path === '-' && !options.stdin) throw STDIN_OVER_MCP;
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
      try {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
      } catch (err) {
        throw new ToilError('INVALID_INPUT', `Cannot write "${forwardSlashes(target)}": ${(err as Error).message}.`, {
          fix: 'Choose a directory you can write to.',
        });
      }
      return forwardSlashes(target);
    },
  };
}
