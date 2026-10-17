import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToilError } from './errors.js';
import { poll } from './poll.js';

afterEach(() => vi.useRealTimers());

describe('poll', () => {
  it('checks until there is an answer, waiting longer each time up to the cap', async () => {
    vi.useFakeTimers();
    const waits: number[] = [];
    let last = Date.now();
    const done = poll(
      async (attempt) => {
        waits.push(Date.now() - last);
        last = Date.now();
        return attempt === 5 ? 'finished' : undefined;
      },
      { what: 'Report abc12345', deadlineMs: 60_000, intervalMs: 100, maxIntervalMs: 300, signal: new AbortController().signal },
    );
    await vi.runAllTimersAsync();
    expect(await done).toBe('finished');
    expect(waits).toEqual([0, 100, 200, 300, 300]);
  });

  it('backs off linearly when asked: the interval times the attempt, up to the cap', async () => {
    vi.useFakeTimers();
    const waits: number[] = [];
    let last = Date.now();
    const done = poll(
      async (attempt) => {
        waits.push(Date.now() - last);
        last = Date.now();
        return attempt === 6 ? 'finished' : undefined;
      },
      { what: 'Evaluation abc12345', deadlineMs: 60_000, intervalMs: 2_000, maxIntervalMs: 7_000, backoff: 'linear', factor: 10, signal: new AbortController().signal },
    );
    await vi.runAllTimersAsync();
    expect(await done).toBe('finished');
    expect(waits).toEqual([0, 2_000, 4_000, 6_000, 7_000, 7_000]);
  });

  it('gives up at the deadline with TIMEOUT, naming what it waited on', async () => {
    vi.useFakeTimers();
    const done = poll(async () => undefined, { what: 'Report abc12345', deadlineMs: 5_000, intervalMs: 1_000, signal: new AbortController().signal });
    const result = done.catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = (await result) as ToilError;
    expect(err).toBeInstanceOf(ToilError);
    expect(err).toMatchObject({ code: 'TIMEOUT', message: "Report abc12345 wasn't finished after 5s; toil stopped waiting." });
  });

  it('stops the moment the signal aborts, with its reason', async () => {
    const controller = new AbortController();
    const reason = new ToilError('CANCELLED', 'cancelled');
    const done = poll(async () => undefined, { what: 'x', deadlineMs: 60_000, intervalMs: 50_000, signal: controller.signal });
    setTimeout(() => controller.abort(reason), 10);
    await expect(done).rejects.toBe(reason);
  });

  it('a check that throws ends the wait with its error', async () => {
    const boom = new ToilError('HTTP', 'job failed');
    await expect(poll(async () => Promise.reject(boom), { what: 'x', deadlineMs: 1_000, signal: new AbortController().signal })).rejects.toBe(boom);
  });
});
