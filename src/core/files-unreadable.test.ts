import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardSlashes, nodeFiles } from './files.js';

/**
 * An ignore file that exists but can't be read (#264). A permission or a lock
 * can't be set up the same way on every OS (Windows CI runs as an
 * administrator, and chmod there does nothing), so those reads fail through a
 * stand-in for `readFileSync` that throws the error Node would. A folder named
 * `.gitignore` and a file that isn't UTF-8 are real on every OS, so they are
 * made for real.
 */
const failing = vi.hoisted(() => new Map<string, NodeJS.ErrnoException>());

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
    const name = String(path).replace(/\\/g, '/');
    for (const [suffix, err] of failing) if (name.endsWith(suffix)) throw err;
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

const errno = (code: string, message: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: ${message}`), { code });

const dirs: string[] = [];
afterEach(() => {
  failing.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Warning = { code: string; message: string };

/** A repository (a bare `.git` with HEAD is enough for the listing) holding `files`. */
function repo(files: Record<string, string | Uint8Array>): { root: string; real: string } {
  const root = mkdtempSync(join(tmpdir(), 'toil-unreadable-'));
  dirs.push(root);
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // The listing names files by their real path (/private/var on macOS, a long name for a short one on Windows).
  return { root, real: forwardSlashes(realpathSync.native(root)) };
}

function list(root: string, dir = '.'): { listed: string[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const listed = nodeFiles({ cwd: root, stdin: false, home: root }).list(dir, { warn: (w) => warnings.push(w) });
  return { listed, warnings };
}

describe('an ignore file that exists but cannot be read (#264)', () => {
  it('says so when permission is denied, naming the file, the error and the fix, and lists what it would have excluded', () => {
    const { root, real } = repo({ '.gitignore': '*.log\n', 'a.log': 'x', 'b.txt': 'x' });
    failing.set(`${basename(root)}/.gitignore`, errno('EACCES', "permission denied, open '.gitignore'"));
    const { listed, warnings } = list(root);
    expect(listed).toEqual(['.gitignore', 'a.log', 'b.txt']);
    expect(warnings).toEqual([
      {
        code: 'GITIGNORE_UNREADABLE',
        message: `${real}/.gitignore could not be read (EACCES: permission denied, open '.gitignore'), so none of its rules were applied and files it excludes may be listed. Give your account permission to read it, or delete it if its rules aren't needed.`,
      },
    ]);
  });

  it('drops only the locked file\'s rules: the others still apply, and the lock gets its own fix', () => {
    const { root, real } = repo({ '.gitignore': '*.log\n', 'src/.gitignore': 'secret.*\n', 'a.log': 'x', 'src/secret.json': 'x', 'src/index.ts': 'x' });
    failing.set(`${basename(root)}/src/.gitignore`, errno('EBUSY', "resource busy or locked, open 'src/.gitignore'"));
    const { listed, warnings } = list(root);
    expect(listed).toEqual(['.gitignore', 'src/.gitignore', 'src/index.ts', 'src/secret.json']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('GITIGNORE_UNREADABLE');
    expect(warnings[0]!.message).toContain(`${real}/src/.gitignore could not be read (EBUSY: resource busy or locked`);
    expect(warnings[0]!.message).toMatch(/Close the program holding it locked, then run the command again\.$/);
  });

  it('says so for a .gitignore above the listing root, which is read to decide what to skip', () => {
    const { root, real } = repo({ '.gitignore': '*.log\n', 'src/a.log': 'x', 'src/b.txt': 'x' });
    failing.set(`${basename(root)}/.gitignore`, errno('EPERM', "operation not permitted, open '.gitignore'"));
    const { listed, warnings } = list(root, 'src');
    expect(listed).toEqual(['a.log', 'b.txt']);
    expect(warnings.map((w) => w.message.slice(0, w.message.indexOf(' could not')))).toEqual([`${real}/.gitignore`]);
  });

  it('says so for info/exclude too, with the generic fix for an error it has no special words for', () => {
    const { root, real } = repo({ '.git/info/exclude': '*.log\n', 'a.log': 'x' });
    failing.set(`${basename(root)}/.git/info/exclude`, errno('EIO', 'i/o error, read'));
    const { listed, warnings } = list(root);
    expect(listed).toEqual(['a.log']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('GITIGNORE_UNREADABLE');
    expect(warnings[0]!.message).toContain(`${real}/.git/info/exclude could not be read (EIO: i/o error, read)`);
    expect(warnings[0]!.message).toMatch(/Make it readable, or delete it if its rules aren't needed\.$/);
  });

  it('says so for a folder named .gitignore, a real failure on every OS', () => {
    const { root, real } = repo({ 'a.log': 'x', 'src/.gitignore/keep.txt': 'x' });
    const { listed, warnings } = list(root);
    expect(listed).toEqual(['a.log', 'src/.gitignore/keep.txt']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(`${real}/src/.gitignore could not be read (EISDIR`);
    expect(warnings[0]!.message).toMatch(/It is a folder, not a file: rename or remove that folder, and put the rules in a file of that name\.$/);
  });

  it('applies a file that is not UTF-8, with its bad bytes replaced, and says so', () => {
    const { root, real } = repo({ '.gitignore': Uint8Array.from([...Buffer.from('*.log\ncaf'), 0xe9, ...Buffer.from('.txt\n')]), 'a.log': 'x', 'b.txt': 'x' });
    const { listed, warnings } = list(root);
    expect(listed).toEqual(['.gitignore', 'b.txt']);
    expect(warnings).toEqual([
      {
        code: 'GITIGNORE_UNREADABLE',
        message: `${real}/.gitignore is not valid UTF-8. Its rules were read with the bytes that don't decode replaced, so a pattern holding them may not match the files it names, and those files may be listed. Save the file as UTF-8.`,
      },
    ]);
  });

  it('says nothing when there is no ignore file at all: a missing file is no rules', () => {
    const { root } = repo({ 'a.log': 'x', 'src/b.txt': 'x' });
    expect(list(root)).toEqual({ listed: ['a.log', 'src/b.txt'], warnings: [] });
    expect(list(root, 'src')).toEqual({ listed: ['b.txt'], warnings: [] });
  });

  it('reads no ignore file, and so says nothing about one, with .gitignore off', () => {
    const { root } = repo({ '.gitignore': '*.log\n', 'a.log': 'x' });
    failing.set(`${basename(root)}/.gitignore`, errno('EACCES', 'permission denied'));
    const warnings: Warning[] = [];
    expect(nodeFiles({ cwd: root, stdin: false, home: root }).list('.', { gitignore: false, warn: (w) => warnings.push(w) })).toEqual(['.gitignore', 'a.log']);
    expect(warnings).toEqual([]);
  });
});
