import { parentPort, workerData } from 'node:worker_threads';
import { validateSchema } from './json-schema.js';
import type { BoundedTask } from './bounded.js';

/**
 * The code a bounded worker runs (kit/bounded.ts): JSON Schema validation, and
 * matching a document's own regular expressions against candidate strings.
 * scripts/gen-worker.mjs bundles this file, the validator and nothing else
 * into one string, which runBounded evaluates in a worker thread with a
 * deadline and a memory limit. Nothing here is imported by the CLI itself.
 * The work that might never finish is done in a room with a clock on the wall.
 */

function run(task: BoundedTask): unknown {
  if (task.kind === 'validate') {
    return validateSchema(task.schema as never, task.value, { ...(task.draft ? { draft: task.draft } : {}), ...(task.references ? { references: task.references as never } : {}), maxProblems: Infinity });
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

try {
  parentPort!.postMessage({ ok: true, value: run(workerData as BoundedTask) });
} catch (err) {
  parentPort!.postMessage({ ok: false, stack: err instanceof RangeError, message: err instanceof Error ? err.message : String(err) });
}
