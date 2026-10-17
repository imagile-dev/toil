import { ToilError } from './errors.js';
import { sleep } from './rest.js';

/**
 * Waiting on work the server does in the background (a Sauce Labs job, a
 * Dynatrace query, a Sonatype IQ evaluation): ask, wait a little longer each
 * time, and stop at a deadline or the moment the command is cancelled.
 * Checking on progress at a growing interval is the one status meeting
 * everyone agrees should be shorter.
 */

export interface PollOptions {
  /** What is being waited on, for the message: "Sonatype IQ evaluation abc12345". */
  what: string;
  /** Give up after this long, as TIMEOUT. */
  deadlineMs: number;
  /** First wait between checks. Default 1 s. */
  intervalMs?: number;
  /** Longest wait between checks. Default 10 s. */
  maxIntervalMs?: number;
  /** Each wait is the last one times this. Default 2. */
  factor?: number;
  /** The command's signal: cancelling it stops the wait at once. */
  signal: AbortSignal;
}

/**
 * Calls `check` until it returns something other than undefined, and returns
 * that. A check that throws ends the wait with its error. Past the deadline
 * it's TIMEOUT; an abort rejects with the signal's reason, so execute()
 * reports TIMEOUT or CANCELLED as usual.
 */
export async function poll<T>(check: (attempt: number) => Promise<T | undefined>, options: PollOptions): Promise<T> {
  const started = Date.now();
  let wait = options.intervalMs ?? 1000;
  const max = options.maxIntervalMs ?? 10_000;
  const factor = options.factor ?? 2;
  for (let attempt = 1; ; attempt++) {
    if (options.signal.aborted) throw options.signal.reason;
    const result = await check(attempt);
    if (result !== undefined) return result;
    const left = options.deadlineMs - (Date.now() - started);
    if (left <= 0) {
      throw new ToilError('TIMEOUT', `${options.what} wasn't finished after ${Math.round(options.deadlineMs / 1000)}s; toil stopped waiting.`, {
        fix: 'It may still finish on the server. Check it there, or run the command again later.',
        details: { attempts: attempt, deadlineMs: options.deadlineMs },
      });
    }
    await sleep(Math.min(wait, left), options.signal);
    wait = Math.min(wait * factor, max);
  }
}
