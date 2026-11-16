import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAllSync } from './stdin.js';

describe('readAllSync', () => {
  it('waits out EAGAIN and reads until end of file', () => {
    const steps: Array<string | 'EAGAIN'> = ['EAGAIN', 'EAGAIN', 'ab', 'EAGAIN', 'cd', ''];
    const sleeps: number[] = [];
    const out = readAllSync(0, {
      read: (_fd, buffer) => {
        const step = steps.shift()!;
        if (step === 'EAGAIN') throw Object.assign(new Error('EAGAIN: resource temporarily unavailable, read'), { code: 'EAGAIN' });
        return buffer.write(step);
      },
      sleep: (ms) => sleeps.push(ms),
    });
    expect(out.toString()).toBe('abcd');
    expect(sleeps).toEqual([10, 10, 10]);
  });

  it('passes any other read error on', () => {
    const fail = () => {
      throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
    };
    expect(() => readAllSync(0, { read: fail })).toThrow('EBADF');
  });

  // The bug as users met it: `toil deps scan | toil osv vulns`. The child
  // touches process.stdin first, as the CLI does, which makes the pipe
  // non-blocking, and the writer is slow, so the first read finds nothing.
  it('reads a slow-writing pipe after process.stdin made it non-blocking', async () => {
    const module = pathToFileURL(fileURLToPath(new URL('./stdin.ts', import.meta.url))).href;
    const script = `void process.stdin.isTTY; const { readAllSync } = await import(${JSON.stringify(module)}); process.stdout.write(readAllSync(0).toString());`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const done = new Promise<number | null>((resolve) => child.on('close', resolve));
    await new Promise((r) => setTimeout(r, 300));
    child.stdin.write('[{"name":"left-pad",');
    await new Promise((r) => setTimeout(r, 200));
    child.stdin.end('"version":"1.0.0"}]');
    const code = await done;
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toBe('[{"name":"left-pad","version":"1.0.0"}]');
  }, 20_000);
});
