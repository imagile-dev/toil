import { Worker } from 'node:worker_threads';
import type { Schema, SchemaDraft, SchemaResult } from './json-schema.js';
import { WORKER_SOURCE } from './bounded-worker.generated.js';

/**
 * Work whose cost depends on what a document asks for, run where it can be
 * stopped: JSON Schema validation (a validator tries every anyOf and oneOf
 * branch, so a schema can ask for 2^n checks) and a document's own regular
 * expressions (a backtracking engine can take exponential time on a short
 * string). Neither has a timeout in JavaScript, and guessing their cost from
 * their shape kept missing cases, so each runs in a worker thread with a
 * deadline and a memory limit, and is terminated when it passes either.
 *
 * The worker evaluates a small script (kit/bounded-task.ts, bundled with the
 * validator by scripts/gen-worker.mjs into bounded-worker.generated.ts), not
 * the CLI. A worker thread is part of this process: nothing is spawned, and
 * No Executables holds. Import this module only with `await import()`
 * (docs/util.md, Lazy loading). Every failure is an outcome with a plain
 * reason, for the caller to report as unchecked, never a crash. Measured on
 * a Windows laptop: a worker starts in about 20 ms and terminating a busy
 * one takes about 1 ms. A deadline is the only form of approval that never
 * needs chasing.
 */

/** How long one bounded task may run: 2 seconds. */
export const BOUNDED_TIMEOUT_MS = 2_000;
/** The heap one bounded task may use: 256 MB. */
export const BOUNDED_MEMORY_MB = 256;

export type BoundedTask =
  | { kind: 'validate'; schema: unknown; value: unknown; draft?: SchemaDraft; references?: Array<{ schema: unknown; id?: string }> }
  | { kind: 'match'; patterns: Array<{ pattern: string; candidates: string[] }> };

export type BoundedOutcome<T> = { ok: true; value: T } | { ok: false; cause: 'timeout' | 'memory' | 'stack' | 'denied' | 'cancelled' | 'failed'; reason: string };

/** Limits and cancellation for one bounded task. `signal` is the command's: aborting it terminates the worker at once. */
export interface BoundedOptions {
  timeoutMs?: number;
  maxMemoryMb?: number;
  signal?: AbortSignal | undefined;
}

const CANCELLED = { ok: false as const, cause: 'cancelled' as const, reason: 'the command was cancelled, so the worker was stopped' };

/**
 * Runs `task` in a worker thread, and resolves with its result, or with why
 * it has none: it passed the deadline (and was terminated), ran out of
 * memory or stack, worker threads aren't allowed (Node's permission model
 * without --allow-worker), or it failed.
 */
export function runBounded<T>(task: BoundedTask, options: BoundedOptions = {}): Promise<BoundedOutcome<T>> {
  const timeoutMs = options.timeoutMs ?? BOUNDED_TIMEOUT_MS;
  const maxMemoryMb = options.maxMemoryMb ?? BOUNDED_MEMORY_MB;
  const { signal } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(CANCELLED);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: task, resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb, maxYoungGenerationSizeMb: Math.min(64, maxMemoryMb) } });
    } catch (err) {
      const code = (err as { code?: string }).code;
      resolve(
        code === 'ERR_ACCESS_DENIED'
          ? { ok: false, cause: 'denied', reason: "it needs a worker thread, and Node's permission model doesn't allow one here (run Node with --allow-worker)" }
          : { ok: false, cause: 'failed', reason: `a worker thread couldn't start (${(err as Error).message})` },
      );
      return;
    }
    let settled = false;
    const onAbort = () => settle(CANCELLED);
    const settle = (outcome: BoundedOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      resolve(outcome);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => settle({ ok: false, cause: 'timeout', reason: `it took longer than ${timeoutMs / 1000} s, the most one check may run, and was stopped` }), timeoutMs);
    worker.once('message', (message: { ok: true; value: T } | { ok: false; stack: boolean; message: string }) => {
      if (message.ok) settle({ ok: true, value: message.value });
      else if (message.stack) settle({ ok: false, cause: 'stack', reason: `it nests too deep and ran out of stack (${message.message})` });
      else settle({ ok: false, cause: 'failed', reason: `it failed: ${message.message}` });
    });
    worker.once('error', (err: Error & { code?: string }) => {
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') settle({ ok: false, cause: 'memory', reason: `it needed more than ${maxMemoryMb} MB of memory, the most one check may use, and was stopped` });
      else if (err instanceof RangeError) settle({ ok: false, cause: 'stack', reason: `it nests too deep and ran out of stack (${err.message})` });
      else settle({ ok: false, cause: 'failed', reason: `it failed: ${err.message}` });
    });
    worker.once('exit', (code) => settle({ ok: false, cause: 'failed', reason: `the worker stopped with exit code ${code} before answering` }));
  });
}

/**
 * Validates `value` against `schema` in a bounded worker: the kit's
 * validateSchema, every problem returned (cap them with leafProblems and a
 * slice), or `unchecked` with the reason when the worker couldn't finish.
 */
export async function validateBounded(schema: Schema | boolean, value: unknown, options: BoundedOptions & { draft?: SchemaDraft; references?: Array<{ schema: Schema; id?: string }> } = {}): Promise<SchemaResult> {
  const { draft, references, ...limits } = options;
  const outcome = await runBounded<SchemaResult>({ kind: 'validate', schema, value, ...(draft ? { draft } : {}), ...(references ? { references } : {}) }, limits);
  if (outcome.ok) return outcome.value;
  return { valid: false, problems: [], total: 0, unchecked: `validation was not finished: ${outcome.reason}` };
}

/**
 * For each pattern, the index of the first candidate it matches (-1 for
 * none, -2 for a pattern that doesn't compile), run in a bounded worker; or
 * why there's no answer.
 */
export async function matchBounded(patterns: Array<{ pattern: string; candidates: string[] }>, options: BoundedOptions = {}): Promise<BoundedOutcome<number[]>> {
  if (!patterns.length) return { ok: true, value: [] };
  return runBounded<number[]>({ kind: 'match', patterns }, options);
}
