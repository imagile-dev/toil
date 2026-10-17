import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testContext } from '../../test/harness/context.js';
import { defineArea } from './area.js';
import { execute } from './run.js';

/**
 * A command that declares a time limit above the 120 s default gets it, and
 * still ends with TIMEOUT at that limit or CANCELLED when the caller gives up.
 */

const slow = defineArea({ name: 'slow', description: 'A test-only area', connection: z.object({ baseUrl: z.url() }) });

const scan = slow.command({
  path: ['slow', 'scan'],
  description: 'Waits until aborted',
  input: z.object({}),
  writes: false,
  timeLimitMs: 600_000,
  examples: [{}],
  run: (_input, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true })),
});

const config = { slow: { baseUrl: 'https://slow.imagile.dev' } };

afterEach(() => vi.useRealTimers());

describe('a declared time limit', () => {
  it('outlasts the default, then times out at its own limit', async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = execute(scan, {}, testContext({ config }).context).then((envelope) => {
      settled = true;
      return envelope;
    });
    await vi.advanceTimersByTimeAsync(130_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(470_000);
    expect((await result).error).toMatchObject({ code: 'TIMEOUT', message: 'slow scan took longer than 600s; toil stopped waiting.' });
  });

  it('gives way to TOIL_TIMEOUT_MS, which the environment sets', async () => {
    vi.useFakeTimers();
    const { context } = testContext({ config });
    const result = execute(scan, {}, { ...context, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).error).toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('1s') });
  });

  it('is still cancelled by the caller', async () => {
    const controller = new AbortController();
    const { context } = testContext({ config });
    const result = execute(scan, {}, { ...context, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    expect((await result).error).toMatchObject({ code: 'CANCELLED' });
  });
});
