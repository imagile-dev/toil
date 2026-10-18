import { Validator, type Schema, type SchemaDraft } from '@cfworker/json-schema';

/**
 * JSON Schema validation for the `util` commands that need it: ADF output
 * checked against the ADF schema, OpenAPI documents against the schema for
 * their version, and generated example bodies against their own schema. It
 * runs @cfworker/json-schema, which interprets a schema rather than
 * compiling it to code, and reads drafts 4, 7, 2019-09 and 2020-12, the
 * drafts those schemas are written in. Import this module only with
 * `await import()` from inside a command's run (docs/util.md, Lazy loading).
 *
 * Every problem is reported by JSON pointer into the value (`/paths/~1pets/get`),
 * with the keyword that failed and the schema location, so a caller can say
 * exactly where a document is wrong. A schema about schemas, consulted to
 * approve a schema: governance, all the way down.
 */

export type { Schema, SchemaDraft };

export interface SchemaProblem {
  /** JSON pointer into the validated value; `''` is the value itself. */
  pointer: string;
  /** The keyword that failed (`required`, `type`, `$ref`). */
  keyword: string;
  /** The path through the schema to the keyword, as JSON pointer, with any `$ref` followed shown as `$ref` (`/properties/content/items/$ref/required`). */
  schemaPointer: string;
  message: string;
}

export interface SchemaResult {
  valid: boolean;
  /** The failures at the deepest locations first, one per pointer and keyword, at most `maxProblems`. */
  problems: SchemaProblem[];
  /** How many problems there were before `maxProblems` cut them. */
  total: number;
}

/** Which draft a schema declares in `$schema`, defaulting to `fallback`. */
export function schemaDraft(schema: unknown, fallback: SchemaDraft = '2020-12'): SchemaDraft {
  const declared = typeof schema === 'object' && schema !== null ? (schema as { $schema?: unknown }).$schema : undefined;
  if (typeof declared !== 'string') return fallback;
  if (/draft-0?4\b/.test(declared)) return '4';
  if (/draft-0?[67]\b/.test(declared)) return '7';
  if (declared.includes('2019-09')) return '2019-09';
  if (declared.includes('2020-12')) return '2020-12';
  return fallback;
}

/** `#/a/b` (cfworker's form) -> `/a/b`. */
const pointer = (location: string) => (location.startsWith('#') ? location.slice(1) : location);

/**
 * Validates `value` against `schema`. `references` are further schemas a `$ref`
 * may point at, each under its `$id` (or the id given). The draft comes from
 * the schema's `$schema`, else `draft`.
 */
export function validateSchema(schema: Schema | boolean, value: unknown, options: { draft?: SchemaDraft; references?: Array<{ schema: Schema; id?: string }>; maxProblems?: number } = {}): SchemaResult {
  const validator = new Validator(schema, options.draft ?? schemaDraft(schema), false);
  for (const ref of options.references ?? []) validator.addSchema(ref.schema, ref.id);
  const result = validator.validate(value);
  if (result.valid) return { valid: true, problems: [], total: 0 };
  // cfworker reports each failure and every enclosing keyword that failed because of it; keep one per place.
  const seen = new Set<string>();
  const problems: SchemaProblem[] = [];
  for (const unit of result.errors) {
    const key = `${unit.instanceLocation}\u0000${unit.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ pointer: pointer(unit.instanceLocation), keyword: unit.keyword, schemaPointer: pointer(unit.keywordLocation), message: unit.error });
  }
  problems.sort((a, b) => b.pointer.split('/').length - a.pointer.split('/').length);
  const max = options.maxProblems ?? 50;
  return { valid: false, problems: problems.slice(0, max), total: problems.length };
}
