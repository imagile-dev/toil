import { parentPort } from 'node:worker_threads';
import { compileSchema, validateWith, type Validator } from './json-schema.js';
import type { BoundedSource, BoundedTask, RefusedError } from './bounded.js';
import { parseYaml } from './yaml.js';
import { drawView } from '../c4/draw.js';
import { convertText, readBack } from '../md/core.js';
import { outlineText } from '../size/outline.js';

/**
 * The code a bounded worker runs (kit/bounded.ts): JSON Schema validation,
 * matching a document's own regular expressions against candidate strings,
 * laying out a C4 view (c4/draw.ts), parsing a YAML document, testing a
 * user's `--grep` pattern against lines of a log, outlining a file for
 * `util size` and converting a document for `util md`.
 * scripts/gen-worker.mjs bundles this file and what it imports, and nothing else,
 * into one string, which runBounded evaluates in a worker thread with a
 * deadline and a memory limit. Nothing here is imported by the CLI itself.
 * The work that might never finish is done in a room with a clock on the wall.
 */

/** Validators built in this worker, by the key their schema was sent under: a schema is sent and built once, then reused. */
const compiled = new Map<string, Validator>();

/** The last few `--grep` patterns compiled, so a log sent in batches compiles its pattern once. */
const patterns = new Map<string, RegExp>();

/** A document's value from its bytes: JSON.parse, or the kit's YAML reader. */
function parseSource(source: BoundedSource, label: string): unknown {
  const text = new TextDecoder('utf-8').decode(source.bytes);
  return source.format === 'json' ? JSON.parse(text) : parseYaml(text, label);
}

function run(task: BoundedTask): unknown {
  if (task.kind === 'c4-draw') return drawView(task.view);
  if (task.kind === 'parse') return parseSource(task.source, task.label);
  if (task.kind === 'outline') return outlineText(task.language, task.text, parseYaml);
  if (task.kind === 'md-convert') return convertText(task.from, task.to, task.text, task.label);
  if (task.kind === 'md-read') return readBack(task.format, task.output);
  if (task.kind === 'grep') {
    let re = patterns.get(task.pattern);
    if (!re) {
      // The same flags util log checked the pattern with: none.
      re = new RegExp(task.pattern);
      if (patterns.size >= 8) patterns.clear();
      patterns.set(task.pattern, re);
    }
    const hits = new Uint8Array(task.lines.length);
    for (let k = 0; k < task.lines.length; k++) if (re.test(task.lines[k]!)) hits[k] = 1;
    return hits;
  }
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
    return validateWith(validator, task.source ? parseSource(task.source, 'the document') : task.value, { maxProblems: Infinity });
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

/** A ToilError (the input refused, with its code and fix) as data that crosses back to the command. */
function refusal(err: unknown): RefusedError | undefined {
  if (!(err instanceof Error) || err.name !== 'ToilError') return undefined;
  const { code, fix, details } = err as Error & { code: RefusedError['code']; fix?: string; details?: unknown };
  return { code, message: err.message, ...(fix === undefined ? {} : { fix }), ...(details === undefined ? {} : { details }) };
}

// One worker serves many tasks: each arrives with an id, and its answer goes back with it.
parentPort!.on('message', ({ id, task }: { id: number; task: BoundedTask }) => {
  try {
    parentPort!.postMessage({ id, ok: true, value: run(task) });
  } catch (err) {
    const refused = refusal(err);
    parentPort!.postMessage({ id, ok: false, stack: err instanceof RangeError, message: err instanceof Error ? err.message : String(err), ...(refused ? { refused } : {}) });
  }
});
