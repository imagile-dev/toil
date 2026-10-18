import { Worker } from 'node:worker_threads';
import { ToilError, type ErrorCode } from '../../../core/errors.js';
import type { Schema, SchemaDraft, SchemaResult } from './json-schema.js';
import type { ComputedView } from '../c4/view.js';
import type { MdFormat } from '../md/core.js';
import type { OutlineLanguage } from '../size/outline.js';
import { WORKER_SOURCE } from './bounded-worker.generated.js';

/**
 * Work whose cost depends on what a document asks for, run where it can be
 * stopped: laying out a C4 view (superlinear in its boxes and arrows), JSON Schema validation (a validator tries every anyOf and oneOf
 * branch, so a schema can ask for 2^n checks) and a document's own regular
 * expressions (a backtracking engine can take exponential time on a short
 * string). Neither has a timeout in JavaScript, and guessing their cost from
 * their shape kept missing cases, so each runs in a worker thread with a
 * deadline and a memory limit, and is terminated when it passes either.
 * The same goes for a user's `util log --grep` pattern, and for the util
 * steps #200 measured past what a command should hold its thread for:
 * reading YAML for `util openapi`, outlining a file for `util size` and
 * converting a document for `util md`. Each records its measurements beside
 * its limits. JSON parsing (`util openapi`, `util report`'s SARIF) stays on
 * the command's thread: it's linear, and a fraction of a second at the input cap.
 *
 * One worker serves the process (runBounded, below). It evaluates a small script (kit/bounded-task.ts, bundled with the
 * validator by scripts/gen-worker.mjs into bounded-worker.generated.ts), not
 * the CLI. A worker thread is part of this process: nothing is spawned, and
 * No Executables holds. Import this module only with `await import()`
 * (docs/util.md, Lazy loading). Every failure is an outcome with a plain
 * reason, for the caller to report as unchecked or as boundedError's plain
 * error, never a crash. Measured on
 * a Windows laptop: a worker starts in about 20 ms and terminating a busy
 * one takes about 1 ms. A deadline is the only form of approval that never
 * needs chasing.
 */

/** How long one bounded task may run: 2 seconds. */
export const BOUNDED_TIMEOUT_MS = 2_000;
/** The heap one bounded task may use: 256 MB. */
export const BOUNDED_MEMORY_MB = 256;

/** A document's text as UTF-8 bytes, moved to the worker rather than copied (BoundedOptions.transfer), and the format to parse it as. */
export interface BoundedSource {
  bytes: Uint8Array;
  format: 'json' | 'yaml';
}

export type BoundedTask =
  /**
   * `key` names the schema: the worker builds it once and keeps it, so the schema is sent to each worker once. Leave it out for a schema used once.
   * `source` in place of `value`: the worker parses the document itself, so a large one is never structured-cloned (cloning a 60 MB document into the worker took the process down, where parsing its bytes there didn't).
   */
  | { kind: 'validate'; schema?: unknown; value?: unknown; source?: BoundedSource; draft?: SchemaDraft; references?: Array<{ schema: unknown; id?: string }>; key?: string }
  | { kind: 'match'; patterns: Array<{ pattern: string; candidates: string[] }> }
  /** One C4 view laid out, checked and drawn as SVG (c4/draw.ts): the layout's cost grows faster than the view. */
  | { kind: 'c4-draw'; view: ComputedView }
  /** A YAML document parsed through kit/yaml.ts (`label` names it in errors), its value sent back. */
  | { kind: 'parse'; source: BoundedSource; label: string }
  /** Which of `lines` the user's regular expression matches: a Uint8Array of 1s and 0s, one per line (util log --grep). */
  | { kind: 'grep'; pattern: string; lines: string[] }
  /** One file's outline for util size (size/outline.ts). */
  | { kind: 'outline'; language: OutlineLanguage; text: string }
  /** util md's reading and writing (md/core.ts): `convert` reads `text` and writes it in `to`; `read` reads the output back for the round trip. */
  | { kind: 'md-convert'; from: MdFormat; to: MdFormat; text: string; label: string }
  | { kind: 'md-read'; format: MdFormat; output: unknown };

/** A ToilError thrown inside the worker, carried back as data: the input was refused, and the error says why. */
export interface RefusedError {
  code: ErrorCode;
  message: string;
  fix?: string;
  details?: unknown;
}

export type BoundedOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; cause: 'timeout' | 'memory' | 'stack' | 'denied' | 'cancelled' | 'failed'; reason: string }
  | { ok: false; cause: 'refused'; reason: string; error: RefusedError };

/** Limits and cancellation for one bounded task. `signal` is the command's: aborting it terminates the worker at once. */
export interface BoundedOptions {
  timeoutMs?: number;
  maxMemoryMb?: number;
  signal?: AbortSignal | undefined;
  /** Buffers moved to the worker with the task instead of copied; they're unusable here afterwards. */
  transfer?: ArrayBuffer[];
}

const CANCELLED = { ok: false as const, cause: 'cancelled' as const, reason: 'the command was cancelled, so the worker was stopped' };

type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; stack: boolean; message: string; refused?: RefusedError };

interface Job {
  id: number;
  task: BoundedTask;
  timeoutMs: number;
  maxMemoryMb: number;
  signal: AbortSignal | undefined;
  transfer: ArrayBuffer[];
  resolve: (outcome: BoundedOutcome<unknown>) => void;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
}

/**
 * The one worker this process keeps, made on first use and reused for every
 * task after, so a run of validations pays for one start, and under `toil mcp`
 * it stays warm. Tasks queue and run one at a time, each with its own
 * deadline. A timeout, a memory limit, a crash or a cancel terminates this
 * worker and leaves the next task to start a fresh one. Unreferenced while
 * idle, so it never keeps the process alive, and closed when the process
 * exits.
 */
let current: { worker: Worker; maxMemoryMb: number; keys: Set<string> } | undefined;
const queue: Job[] = [];
let busy: Job | undefined;
let nextId = 1;
let exitHook = false;
let starts = 0;

/** How many workers this process has started: for tests, which count starts rather than time them. */
export function boundedWorkerStarts(): number {
  return starts;
}

function finish(job: Job, outcome: BoundedOutcome<unknown>): void {
  clearTimeout(job.timer);
  if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
  job.resolve(outcome);
}

/** Ends the running job with `outcome` and throws its worker away, so the next job starts a fresh one. */
function kill(outcome: BoundedOutcome<unknown>): void {
  const job = busy;
  busy = undefined;
  if (current) {
    const { worker } = current;
    current = undefined;
    worker.removeAllListeners();
    // A worker being torn down can still report an error (an out-of-memory racing the deadline); with no listener that would throw here.
    worker.on('error', () => {});
    void worker.terminate();
  }
  if (job) finish(job, outcome);
  pump();
}

/** The worker, made if there's none or it was made with a different memory limit. Throws when Node won't make one. */
function workerFor(maxMemoryMb: number): Worker {
  if (current && current.maxMemoryMb === maxMemoryMb) return current.worker;
  if (current) {
    const old = current.worker;
    current = undefined;
    old.removeAllListeners();
    // A worker being torn down can still report an error (an out-of-memory racing the deadline); with no listener that would throw here.
    old.on('error', () => {});
    void old.terminate();
  }
  const worker = new Worker(WORKER_SOURCE, { eval: true, resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb, maxYoungGenerationSizeMb: Math.min(64, maxMemoryMb) } });
  starts++;
  worker.unref();
  worker.on('message', (reply: Reply) => {
    const job = busy;
    if (!job || reply.id !== job.id) return;
    busy = undefined;
    worker.unref();
    if (reply.ok) finish(job, { ok: true, value: reply.value });
    else if (reply.refused) finish(job, { ok: false, cause: 'refused', reason: reply.refused.message, error: reply.refused });
    else if (reply.stack) finish(job, { ok: false, cause: 'stack', reason: `it nests too deep and ran out of stack (${reply.message})` });
    else finish(job, { ok: false, cause: 'failed', reason: `it failed: ${reply.message}` });
    pump();
  });
  worker.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') kill({ ok: false, cause: 'memory', reason: `it needed more than ${maxMemoryMb} MB of memory, the most one check may use, and was stopped` });
    else if (err instanceof RangeError) kill({ ok: false, cause: 'stack', reason: `it nests too deep and ran out of stack (${err.message})` });
    else kill({ ok: false, cause: 'failed', reason: `it failed: ${err.message}` });
  });
  worker.on('exit', (code) => {
    if (current?.worker === worker) kill({ ok: false, cause: 'failed', reason: `the worker stopped with exit code ${code} before answering` });
  });
  current = { worker, maxMemoryMb, keys: new Set() };
  if (!exitHook) {
    exitHook = true;
    process.once('exit', () => void current?.worker.terminate());
  }
  return worker;
}

/** Starts the next queued job, if nothing is running. */
function pump(): void {
  while (!busy && queue.length) {
    const job = queue.shift()!;
    if (job.signal?.aborted) {
      finish(job, CANCELLED);
      continue;
    }
    let worker: Worker;
    try {
      worker = workerFor(job.maxMemoryMb);
    } catch (err) {
      const code = (err as { code?: string }).code;
      finish(
        job,
        code === 'ERR_ACCESS_DENIED'
          ? { ok: false, cause: 'denied', reason: "it needs a worker thread, and Node's permission model doesn't allow one here (run Node with --allow-worker)" }
          : { ok: false, cause: 'failed', reason: `a worker thread couldn't start (${(err as Error).message})` },
      );
      continue;
    }
    busy = job;
    // Referenced while it works, so a command waits for its answer; unreferenced again when idle.
    worker.ref();
    job.timer = setTimeout(() => {
      if (busy === job) kill({ ok: false, cause: 'timeout', reason: `it took longer than ${job.timeoutMs / 1000} s, the most one check may run, and was stopped` });
    }, job.timeoutMs);
    // A keyed schema the worker already holds isn't sent again.
    let task = job.task;
    if (task.kind === 'validate' && task.key !== undefined) {
      if (current!.keys.has(task.key)) task = { kind: 'validate', value: task.value, ...(task.source ? { source: task.source } : {}), key: task.key };
      else current!.keys.add(task.key);
    }
    worker.postMessage({ id: job.id, task }, job.transfer);
  }
}

/**
 * Runs `task` in the bounded worker, and resolves with its result, or with
 * why it has none: it passed the deadline (and its worker was terminated),
 * ran out of memory or stack, was cancelled, worker threads aren't allowed
 * (Node's permission model without --allow-worker), or it failed.
 */
export function runBounded<T>(task: BoundedTask, options: BoundedOptions = {}): Promise<BoundedOutcome<T>> {
  const { signal } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(CANCELLED);
      return;
    }
    const job: Job = {
      id: nextId++,
      task,
      timeoutMs: options.timeoutMs ?? BOUNDED_TIMEOUT_MS,
      maxMemoryMb: options.maxMemoryMb ?? BOUNDED_MEMORY_MB,
      signal,
      transfer: options.transfer ?? [],
      resolve: resolve as (outcome: BoundedOutcome<unknown>) => void,
    };
    if (signal) {
      // A cancel kills only this job: the worker if it's running it, else just its place in the queue.
      job.onAbort = () => {
        if (busy === job) kill(CANCELLED);
        else {
          const at = queue.indexOf(job);
          if (at >= 0) queue.splice(at, 1);
          finish(job, CANCELLED);
        }
      };
      signal.addEventListener('abort', job.onAbort, { once: true });
    }
    queue.push(job);
    pump();
  });
}

/**
 * `source` with bytes that own their whole buffer, so moving the buffer to
 * the worker takes nothing else with it: a view into a shared or pooled
 * buffer (a small Node Buffer) is copied first.
 */
export function movable(source: BoundedSource): BoundedSource {
  const { bytes } = source;
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return source;
  return { ...source, bytes: bytes.slice() };
}

/**
 * Validates `value` against `schema` in a bounded worker: the kit's
 * validateSchema, every problem returned (cap them with leafProblems and a
 * slice), or `unchecked` with the reason when the worker couldn't finish.
 */
export async function validateBounded(
  schema: Schema | boolean,
  value: unknown,
  options: BoundedOptions & { draft?: SchemaDraft; references?: Array<{ schema: Schema; id?: string }>; key?: string; source?: BoundedSource } = {},
): Promise<SchemaResult> {
  const { draft, references, key, source, ...limits } = options;
  // With a source, the worker parses the document's bytes itself, and they're moved there rather than copied.
  const moved = source ? movable(source) : undefined;
  const task: BoundedTask = { kind: 'validate', schema, ...(moved ? { source: moved } : { value }), ...(draft ? { draft } : {}), ...(references ? { references } : {}), ...(key === undefined ? {} : { key }) };
  const outcome = await runBounded<SchemaResult>(task, moved ? { ...limits, transfer: [...(limits.transfer ?? []), moved.bytes.buffer as ArrayBuffer] } : limits);
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

/** The limits a step ran under, as its error names them. */
export interface BoundedLimits {
  timeoutMs?: number;
  maxMemoryMb?: number;
}

const BUG_FIX = 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues with the command you ran.';

/**
 * Why a bounded step has no result, as the error its command fails with:
 * the step named (`Outlining the file "a.ts"`), the limit it passed and
 * `fix`, what the user can do about it. A timeout is TIMEOUT, a memory or
 * stack limit INVALID_INPUT (the input asked for more than one step may
 * use), a cancel CANCELLED, and Node's permission model denying workers
 * NOT_CONFIGURED. A refusal is the input's own error from inside the worker,
 * returned as it was thrown. Only a failure nobody planned for is INTERNAL.
 */
export function boundedError(step: string, outcome: Exclude<BoundedOutcome<unknown>, { ok: true }>, limits: BoundedLimits, fix: string): ToilError {
  const timeout = (limits.timeoutMs ?? BOUNDED_TIMEOUT_MS) / 1000;
  const memory = limits.maxMemoryMb ?? BOUNDED_MEMORY_MB;
  switch (outcome.cause) {
    case 'refused':
      return new ToilError(outcome.error.code, outcome.error.message, { ...(outcome.error.fix === undefined ? {} : { fix: outcome.error.fix }), ...(outcome.error.details === undefined ? {} : { details: outcome.error.details }) });
    case 'cancelled':
      return new ToilError('CANCELLED', `${step} was cancelled.`);
    case 'timeout':
      return new ToilError('TIMEOUT', `${step} took longer than the ${timeout} s it may run, so it was stopped.`, { fix });
    case 'memory':
      return new ToilError('INVALID_INPUT', `${step} needed more than the ${memory} MB of memory it may use, so it was stopped.`, { fix });
    case 'stack':
      return new ToilError('INVALID_INPUT', `${step} nests too deep: it ran out of stack and was stopped.`, { fix });
    case 'denied':
      return new ToilError('NOT_CONFIGURED', `${step} needs a worker thread, and Node's permission model doesn't allow one here.`, { fix: 'Run Node with --allow-worker, or without the permission model.' });
    default:
      return new ToilError('INTERNAL', `${step} failed: ${outcome.reason}.`, { fix: BUG_FIX });
  }
}

/** Runs `task` and returns its value, or throws {@link boundedError} for `step`. */
export async function boundedStep<T>(step: string, task: BoundedTask, options: BoundedOptions, fix: string): Promise<T> {
  const outcome = await runBounded<T>(task, options);
  if (outcome.ok) return outcome.value;
  throw boundedError(step, outcome, options, fix);
}

/**
 * Which of `lines` a user's regular expression matches, decided in the
 * bounded worker: a backtracking pattern stops at the deadline instead of
 * holding the process. One element per line, 1 for a match.
 */
export async function grepBounded(pattern: string, lines: string[], options: BoundedOptions = {}): Promise<BoundedOutcome<Uint8Array>> {
  if (!lines.length) return { ok: true, value: new Uint8Array(0) };
  return runBounded<Uint8Array>({ kind: 'grep', pattern, lines }, options);
}
