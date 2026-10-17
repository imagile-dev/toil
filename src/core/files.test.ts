import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('memoryFiles', () => {
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
