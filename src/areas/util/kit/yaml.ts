import { CORE_SCHEMA, load, YAMLException } from 'js-yaml';
import { ToilError } from '../../../core/errors.js';

/**
 * YAML for the `util` commands that read it (OpenAPI documents, outlines of
 * YAML files), through js-yaml, the one YAML parser toil bundles. Import
 * this module only with `await import()` from inside a command's run, never
 * statically, so the parser loads when a command needs it and not on every
 * start (ESLint enforces it; docs/util.md, Lazy loading).
 *
 * The settings are fixed here so every command reads YAML the same way:
 *   - YAML 1.2's core schema: null, booleans, numbers and strings, and no
 *     timestamps, so `2026-01-01` stays the string it was written as
 *   - a key given twice in one mapping is an error, never a silent overwrite
 *   - nesting is capped at js-yaml's default depth of 100
 *   - one document; a stream of several is an error naming the fix
 *   - at most MAX_YAML_NODES values counted as if every alias were expanded.
 *     js-yaml shares one object per anchor, so a few hundred bytes of nested
 *     aliases ("billion laughs") parse in milliseconds and then explode in
 *     whatever walks or serialises them. Aliases within the budget still work,
 *     since real documents use them (OpenAPI specs reuse anchors)
 *
 * An error says where (line and column) and what the parser objected to,
 * never the text around it: the file is its owner's business. Indentation
 * is significant, which is the one thing YAML and the org chart agree on.
 */

/** The most values a document may hold once its aliases are expanded. */
export const MAX_YAML_NODES = 1_000_000;

/** The value of one YAML document. `label` names the input in errors (`the file "api.yaml"`). */
export function parseYaml(text: string, label = 'the YAML'): unknown {
  let value: unknown;
  try {
    value = load(text, { schema: CORE_SCHEMA });
  } catch (err) {
    if (!(err instanceof YAMLException)) throw err;
    const where = err.mark ? ` at line ${err.mark.line + 1}, column ${err.mark.column + 1}` : '';
    throw new ToilError('INVALID_INPUT', `${label[0]!.toUpperCase()}${label.slice(1)} isn't valid YAML${where}: ${err.reason}.`, {
      fix: /more than one document|multi-document|expected a single document/i.test(err.reason) ? 'Pass a single YAML document.' : 'Fix the YAML at that position and run it again.',
      ...(err.mark ? { details: { line: err.mark.line + 1, column: err.mark.column + 1 } } : {}),
    });
  }
  if (expandedSize(value, MAX_YAML_NODES) > MAX_YAML_NODES) {
    throw new ToilError('INVALID_INPUT', `${label[0]!.toUpperCase()}${label.slice(1)} expands its aliases past ${MAX_YAML_NODES} values, the most toil reads from one YAML document.`, {
      fix: 'Pass a document without deeply nested aliases (*name), or with the aliased content written out.',
    });
  }
  return value;
}

/**
 * How many values `value` holds with every shared reference counted each
 * time it's reached, as serialising it would. Stops counting once past
 * `limit`, so a document built to explode costs no more than the limit to
 * measure. Iterative, so depth is no concern; a cycle counts until the limit.
 */
function expandedSize(value: unknown, limit: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const next = stack.pop();
    if (++count > limit) return count;
    if (next !== null && typeof next === 'object') for (const child of Object.values(next)) stack.push(child);
  }
  return count;
}
