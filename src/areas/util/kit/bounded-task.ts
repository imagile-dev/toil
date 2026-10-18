import { parentPort } from 'node:worker_threads';
import { compileSchema, validateWith, type Validator } from './json-schema.js';
import type { BoundedTask } from './bounded.js';

/**
 * The code a bounded worker runs (kit/bounded.ts): JSON Schema validation, and
 * matching a document's own regular expressions against candidate strings.
 * scripts/gen-worker.mjs bundles this file, the validator and nothing else
 * into one string, which runBounded evaluates in a worker thread with a
 * deadline and a memory limit. Nothing here is imported by the CLI itself.
 * The work that might never finish is done in a room with a clock on the wall.
 */

/** Validators built in this worker, by the key their schema was sent under: a schema is sent and built once, then reused. */
const compiled = new Map<string, Validator>();

function run(task: BoundedTask): unknown {
  if (task.kind === 'validate') {
    let validator = task.key === undefined ? undefined : compiled.get(task.key);
    if (!validator) {
      if (task.schema === undefined) throw new Error(`no schema was sent for key ${task.key}`);
      try {
        validator = compileSchema(task.schema as never, { ...(task.draft ? { draft: task.draft } : {}), ...(task.references ? { references: task.references as never } : {}) });
      } catch (err) {
        if (err instanceof RangeError) return { valid: false, problems: [], total: 0, unchecked: `validation ran out of room (${err.message}): the value or the schema nests too deep` };
        throw err;
      }
      if (task.key !== undefined) compiled.set(task.key, validator);
    }
    return validateWith(validator, task.value, { maxProblems: Infinity });
  }
  // match: the index of the first candidate each pattern accepts, -1 for none, -2 for a pattern that doesn't compile.
  return task.patterns.map(({ pattern, candidates }) => {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'u');
    } catch {
      try {
        re = new RegExp(pattern);
      } catch {
        return -2;
      }
    }
    return candidates.findIndex((c) => re.test(c));
  });
}

// One worker serves many tasks: each arrives with an id, and its answer goes back with it.
parentPort!.on('message', ({ id, task }: { id: number; task: BoundedTask }) => {
  try {
    parentPort!.postMessage({ id, ok: true, value: run(task) });
  } catch (err) {
    parentPort!.postMessage({ id, ok: false, stack: err instanceof RangeError, message: err instanceof Error ? err.message : String(err) });
  }
});
