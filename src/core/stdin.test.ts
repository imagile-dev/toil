import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { demoArea } from '../../test/fixtures/demo-commands.js';
import { testContext } from '../../test/harness/context.js';
import { nodeFiles } from './files.js';
import { execute } from './run.js';
import { readAll } from './stdin.js';

/**
 * `-` is read from stdin asynchronously, so a slow writer is waited for, and
 * the wait always ends at the command's time limit or on a cancel (Ctrl+C on
 * the CLI, a cancel over MCP), never blocking the thread (#617).
 */

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stdin whose writer takes its time: nothing at first, then each part, then end of file. */
function slowWriter(...parts: string[]) {
  const pipe = new PassThrough();
  void (async () => {
    for (const part of parts) {
      await later(30);
      pipe.write(part);
    }
    await later(30);
    pipe.end();
  })();
  return pipe;
}

describe('readAll', () => {
  it('waits for a slow writer and reads to end of file', async () => {
    expect((await readAll(slowWriter('[{"name":"left-pad",', '"version":"1.0.0"}]'))).toString()).toBe('[{"name":"left-pad","version":"1.0.0"}]');
  });

  it("ends the wait with the signal's reason, and leaves the stream paused with no listeners of its own", async () => {
    const pipe = new PassThrough();
    const controller = new AbortController();
    const reading = readAll(pipe, controller.signal);
    await later(20);
    const reason = new Error('the time limit');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(pipe.isPaused()).toBe(true);
    expect(pipe.listenerCount('data') + pipe.listenerCount('end')).toBe(0);
  });

  it('is empty for a stdin already read to the end, rather than waiting forever', async () => {
    const pipe = new PassThrough();
    pipe.end('once');
    expect((await readAll(pipe)).toString()).toBe('once');
    expect((await readAll(pipe)).toString()).toBe('');
  });

  it('passes a stream error on', async () => {
    const pipe = new PassThrough();
    const reading = readAll(pipe);
    pipe.destroy(new Error('EPIPE'));
    await expect(reading).rejects.toThrow('EPIPE');
  });
});

describe('"-" through the file service', () => {
  const files = (pipe: PassThrough) => nodeFiles({ cwd: tmpdir(), stdin: true, stdinStream: () => pipe });

  it('readText and readBytes wait for a slow writer', async () => {
    expect(await files(slowWriter('a', 'b')).readText('-')).toBe('ab');
    expect([...(await files(slowWriter('hi')).readBytes('-'))]).toEqual([104, 105]);
  });

  it('readStream yields stdin as it arrives, from the process stream, and ends with the pipe', async () => {
    const chunks: string[] = [];
    for await (const chunk of files(slowWriter('one', 'two')).readStream('-')) chunks.push(new TextDecoder().decode(chunk));
    expect(chunks.join('')).toBe('onetwo');
  });
});

describe('a command reading "-"', () => {
  const readIn = demoArea.command({
    path: ['demo', 'read-in'],
    description: 'Read stdin',
    input: z.object({}),
    writes: false,
    examples: [{}],
    run: async (_input, ctx) => ({ text: await ctx.files.readText('-') }),
  });
  const contextWith = (pipe: PassThrough, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) => {
    const { context } = testContext({ config: { demo: { token: 't' } } });
    return { ...context, ...extra, files: nodeFiles({ cwd: tmpdir(), stdin: true, stdinStream: () => pipe }) };
  };

  it('gets what a slow writer piped in', async () => {
    const envelope = await execute(readIn, {}, contextWith(slowWriter('piped')));
    expect(envelope).toMatchObject({ ok: true, data: { text: 'piped' } });
  });

  it('stops at the time limit with TIMEOUT when the writer never closes the pipe', async () => {
    const started = Date.now();
    const envelope = await execute(readIn, {}, contextWith(new PassThrough(), { timeoutMs: 200 }));
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('stops on a cancel (Ctrl+C, an MCP cancel) with CANCELLED while it waits', async () => {
    const controller = new AbortController();
    const running = execute(readIn, {}, contextWith(new PassThrough(), { signal: controller.signal }));
    await later(50);
    controller.abort();
    expect((await running).error).toMatchObject({ code: 'CANCELLED' });
  });
});
