import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The operations log: what an area did that wasn't HTTP. fakeFetch records
 * every request, which is how the parity suite proves the CLI and MCP asked a
 * REST API for the same things. An area that talks to a database file (or,
 * later, runs git) sends no requests, so without this the suite could only
 * compare envelopes, and two doors that reached the same answer by different
 * routes would pass.
 *
 * A fixture names the objects to trace (the db fixture traces the SQLite
 * provider). Each traced method call is logged with its arguments, and the log
 * it lands in is whichever `recordOperations` call it happened under, followed
 * through async work by AsyncLocalStorage, so the CLI run and the MCP run each
 * get their own. Nothing in src/ knows it's being watched, which is the usual
 * arrangement with auditors.
 */
export interface Operation {
  /** `<label>.<method>`, e.g. `sqlite.query`. */
  op: string;
  /** The arguments, with functions and abort signals left out: they differ per call and carry nothing to compare. */
  args: unknown[];
}

const current = new AsyncLocalStorage<Operation[]>();
const traced = new WeakSet<object>();

/** Copies a value for the log, dropping what can't be compared between two runs. */
function plain(value: unknown, depth = 0): unknown {
  if (typeof value === 'function' || value instanceof AbortSignal) return undefined;
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const copy = plain(v, depth + 1);
    if (copy !== undefined) out[key] = copy;
  }
  return out;
}

/**
 * Wraps every method of `target` so each call is logged as `<label>.<method>`.
 * Idempotent: tracing an object twice logs each call once. Calls made outside
 * `recordOperations` go through untouched.
 */
export function traceOperations(target: object, label: string): void {
  if (traced.has(target)) return;
  traced.add(target);
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const original = record[key];
    if (typeof original !== 'function') continue;
    record[key] = function (this: unknown, ...args: unknown[]) {
      current.getStore()?.push({ op: `${label}.${key}`, args: args.map((a) => plain(a)) });
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}

/** Runs `fn` and returns what it produced alongside every traced operation it caused. */
export async function recordOperations<T>(fn: () => Promise<T>): Promise<{ result: T; operations: Operation[] }> {
  const operations: Operation[] = [];
  const result = await current.run(operations, fn);
  return { result, operations };
}
