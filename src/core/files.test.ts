import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryFiles } from '../../test/harness/files.js';
import { forwardSlashes, nodeFiles } from './files.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('nodeFiles', () => {
  it('resolves relative paths against its working directory, and writes with parents created', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'toil-files-'));
    dirs.push(cwd);
    const files = nodeFiles({ cwd, stdin: true });
    const saved = files.writeBytes('out/deep/a.txt', new TextEncoder().encode('hi'));
    expect(saved).toBe(forwardSlashes(join(cwd, 'out', 'deep', 'a.txt')));
    expect(saved).not.toContain('\\');
    expect(readFileSync(join(cwd, 'out', 'deep', 'a.txt'), 'utf8')).toBe('hi');
    expect(files.readText('out/deep/a.txt')).toBe('hi');
    expect([...files.readBytes(join(cwd, 'out', 'deep', 'a.txt'))]).toEqual([104, 105]);
  });

  it('turns a missing file into INVALID_INPUT with a fix', () => {
    const files = nodeFiles({ cwd: tmpdir(), stdin: true });
    expect(() => files.readText('no-such-file-for-toil.json')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('does not exist') }));
  });

  it('refuses "-" when stdin carries the MCP protocol', () => {
    const files = nodeFiles({ cwd: tmpdir(), stdin: false });
    expect(() => files.readText('-')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('not available over MCP') }));
  });
});

describe('nodeFiles never touches toil\'s own config', () => {
  /** A home with ~/.toil/config.json and a dossier, a separate --config file, and a working directory. */
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'toil-guard-'));
    dirs.push(root);
    const home = join(root, 'home');
    const cwd = join(root, 'work');
    mkdirSync(join(home, '.toil', 'dossiers'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(home, '.toil', 'config.json'), '{"jira":{"apiToken":"SECRET-TOKEN"}}');
    writeFileSync(join(home, '.toil', 'dossiers', 'team.json'), '{}');
    const custom = join(root, 'elsewhere', 'toil.json');
    mkdirSync(dirname(custom), { recursive: true });
    writeFileSync(custom, '{"jira":{"apiToken":"OTHER-SECRET"}}');
    writeFileSync(join(cwd, 'ok.txt'), 'fine');
    const files = nodeFiles({ cwd, stdin: false, protect: [join(home, '.toil'), custom] });
    return { root, home, cwd, custom, files };
  }

  const refused = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining("toil's own configuration") });
      expect(JSON.stringify({ message: (err as Error).message, fix: (err as { fix?: string }).fix })).not.toMatch(/SECRET/);
      return;
    }
    throw new Error('expected a refusal');
  };

  it('refuses the config file, anything else under ~/.toil, and the --config file', () => {
    const { home, custom, files } = setup();
    refused(() => files.readText(join(home, '.toil', 'config.json')));
    refused(() => files.readBytes(join(home, '.toil', 'dossiers', 'team.json')));
    refused(() => files.readText(join(home, '.toil')));
    refused(() => files.readText(custom));
    refused(() => files.writeBytes(join(home, '.toil', 'new.json'), new Uint8Array([1])));
    refused(() => files.writeBytes(custom, new Uint8Array([1])));
    expect(files.readText('ok.txt')).toBe('fine');
  });

  it('refuses a .. traversal, and a differently cased path on Windows', () => {
    const { home, cwd, files } = setup();
    const rel = relative(cwd, join(home, '.toil', 'config.json'));
    refused(() => files.readText(rel));
    refused(() => files.readText(join(cwd, '..', 'home', 'x', '..', '.toil', 'config.json')));
    if (process.platform === 'win32') refused(() => files.readText(join(home, '.TOIL', 'CONFIG.JSON')));
  });

  it('refuses a symlink or junction into ~/.toil', () => {
    const { home, cwd, files } = setup();
    try {
      // A junction needs no privilege on Windows; elsewhere this is a plain directory symlink.
      symlinkSync(join(home, '.toil'), join(cwd, 'innocent'), 'junction');
    } catch {
      return; // the platform refused to make one, so there's nothing to get around
    }
    refused(() => files.readText(join('innocent', 'config.json')));
    refused(() => files.writeBytes(join('innocent', 'planted.json'), new Uint8Array([1])));
  });

  it('never overwrites a file', () => {
    const { cwd, files } = setup();
    expect(() => files.writeBytes('ok.txt', new TextEncoder().encode('replaced'))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists'), fix: expect.stringContaining('--dir') }),
    );
    expect(readFileSync(join(cwd, 'ok.txt'), 'utf8')).toBe('fine');
  });
});

describe('memoryFiles', () => {
  it('never overwrites a file either', () => {
    const files = memoryFiles({ 'a.png': 'x' });
    expect(() => files.writeBytes('a.png', new Uint8Array([1]))).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists') }));
  });

  it('reads seeded files relative to /work, records writes, and serves stdin when given one', () => {
    const files = memoryFiles({ 'a.json': '{}' }, { stdin: 'piped' });
    expect(files.readText('./a.json')).toBe('{}');
    expect(files.readText('/work/a.json')).toBe('{}');
    expect(files.readText('-')).toBe('piped');
    expect(files.writeBytes('x/../b.bin', new Uint8Array([1]))).toBe('/work/b.bin');
    expect(Object.keys(files.written)).toEqual(['/work/b.bin']);
    expect(() => memoryFiles().readText('-')).toThrow(/not available over MCP/);
  });
});
