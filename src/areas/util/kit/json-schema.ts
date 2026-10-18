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
  /**
   * Set when validation wasn't run, or couldn't finish, and why: the schema
   * branches too much to validate in reasonable time, or the value or schema
   * nests too deep. `valid` is then false and `problems` empty, so a caller
   * that doesn't look here fails closed. Report it as unchecked, never as a
   * pass and never as a crash.
   */
  unchecked?: string;
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

/**
 * `#/a/b` (cfworker's form) -> `/a/b`. cfworker URI-encodes each token
 * (`/paths/~1pets~1%7Bid%7D`); a JSON pointer has no encoding, so it's
 * decoded back (`/paths/~1pets~1{id}`). decodeURI is the exact inverse of the
 * encodeURI it used.
 */
const pointer = (location: string) => {
  const raw = location.startsWith('#') ? location.slice(1) : location;
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
};

/**
 * Validates `value` against `schema`. `references` are further schemas a `$ref`
 * may point at, each under its `$id` (or the id given). The draft comes from
 * the schema's `$schema`, else `draft`.
 */
export function validateSchema(schema: Schema | boolean, value: unknown, options: { draft?: SchemaDraft; references?: Array<{ schema: Schema; id?: string }>; maxProblems?: number } = {}): SchemaResult {
  const fanOut = schemaFanOut(schema, options.references ?? []);
  if (fanOut > MAX_SCHEMA_FAN_OUT) {
    return {
      valid: false,
      problems: [],
      total: 0,
      unchecked: `the schema branches too much to validate: one value can be checked against more than ${MAX_SCHEMA_FAN_OUT} subschemas through $ref, allOf, anyOf and oneOf, and the validator tries every branch`,
    };
  }
  let result: ReturnType<Validator['validate']>;
  try {
    const validator = new Validator(schema, options.draft ?? schemaDraft(schema), false);
    for (const ref of options.references ?? []) validator.addSchema(ref.schema, ref.id);
    result = validator.validate(value);
  } catch (err) {
    // The validator recurses with the schema and the value; past the stack's depth that's a RangeError, which is a limit, not a bug.
    if (err instanceof RangeError) return { valid: false, problems: [], total: 0, unchecked: `validation ran out of room (${err.message}): the value or the schema nests too deep` };
    throw err;
  }
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

/** The most subschemas one value may be checked against before validation is refused as too costly. */
export const MAX_SCHEMA_FAN_OUT = 100_000;

/** Keywords whose subschemas apply to the same value, so a value is checked against all of them without descending. */
const SAME_VALUE = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'];

type Frame = { node: unknown; doc: unknown; kids?: Array<[unknown, unknown]>; i: number; sum: number };

/**
 * The most subschemas one value can be checked against: from any subschema,
 * following `$ref`s and the keywords that apply to the same value (allOf,
 * anyOf, oneOf, not, if/then/else), counting every path. Branches don't
 * short-circuit, so this is what a schema can cost per value; a diamond of
 * refs doubles it at every level. Memoised and iterative; a ref back to a
 * subschema still being counted counts 1 (a loop costs a visit, then has to
 * consume some of the value to go round again). Stops at
 * {@link MAX_SCHEMA_FAN_OUT} + 1. A `$ref` this can't resolve (another
 * document's id it wasn't given) counts 1. Branches all the way down: the
 * org chart of a schema that reports to everyone.
 */
export function schemaFanOut(schema: unknown, references: Array<{ schema: unknown; id?: string }> = []): number {
  const limit = MAX_SCHEMA_FAN_OUT + 1;
  const isNode = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const base = (id: string) => id.replace(/#.*$/, '');
  const idOf = (doc: unknown) => (isNode(doc) ? (typeof doc.$id === 'string' ? doc.$id : typeof doc.id === 'string' ? doc.id : undefined) : undefined);
  const docs = new Map<string, unknown>();
  for (const ref of references) {
    const id = ref.id ?? idOf(ref.schema);
    if (id !== undefined) docs.set(base(id), ref.schema);
  }
  const rootId = idOf(schema);
  if (rootId !== undefined) docs.set(base(rootId), schema);
  const at = (doc: unknown, fragment: string): unknown => {
    let text: string;
    try {
      text = decodeURIComponent(fragment);
    } catch {
      return undefined;
    }
    let node = doc;
    if (text === '' || text === '/') return node;
    for (const raw of text.slice(1).split('/')) {
      const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(node)) node = node[Number(token)];
      else if (isNode(node)) node = node[token];
      else return undefined;
    }
    return node;
  };
  /** The subschemas a node sends the same value to, each with the document it lives in. */
  const next = (node: Record<string, unknown>, doc: unknown): Array<[unknown, unknown]> => {
    const out: Array<[unknown, unknown]> = [];
    if (typeof node.$ref === 'string') {
      const hash = node.$ref.indexOf('#');
      const where = hash === -1 ? node.$ref : node.$ref.slice(0, hash);
      const targetDoc = where === '' ? doc : docs.get(base(where));
      const target = targetDoc === undefined ? undefined : at(targetDoc, hash === -1 ? '' : node.$ref.slice(hash + 1));
      if (target !== undefined) out.push([target, targetDoc]);
    }
    for (const key of SAME_VALUE) {
      const v = node[key];
      if (Array.isArray(v)) for (const branch of v) out.push([branch, doc]);
      else if (isNode(v)) out.push([v, doc]);
    }
    return out;
  };
  const memo = new Map<unknown, number>();
  const cost = (start: Record<string, unknown>, startDoc: unknown): number => {
    // Iterative post-order: a frame per subschema, its branches counted before it.
    const stack: Frame[] = [{ node: start, doc: startDoc, i: 0, sum: 1 }];
    const open = new Set<unknown>([start]);
    let result = 1;
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      frame.kids ??= next(frame.node as Record<string, unknown>, frame.doc);
      if (frame.i < frame.kids.length && frame.sum < limit) {
        const [kid, kidDoc] = frame.kids[frame.i++]!;
        const known = memo.get(kid);
        if (known !== undefined) frame.sum += known;
        else if (!isNode(kid) || open.has(kid)) frame.sum += 1;
        else {
          open.add(kid);
          stack.push({ node: kid, doc: kidDoc, i: 0, sum: 1 });
        }
        continue;
      }
      stack.pop();
      open.delete(frame.node);
      result = Math.min(frame.sum, limit);
      memo.set(frame.node, result);
      const parent = stack[stack.length - 1];
      if (parent) parent.sum += result;
    }
    return result;
  };
  // Every subschema anywhere in the schemas given, walked iteratively.
  let worst = 0;
  const seen = new Set<unknown>();
  const walk: Array<[unknown, unknown]> = [[schema, schema], ...references.map((r): [unknown, unknown] => [r.schema, r.schema])];
  while (walk.length) {
    const [node, doc] = walk.pop()!;
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    if (isNode(node)) {
      worst = Math.max(worst, memo.get(node) ?? cost(node, doc));
      if (worst >= limit) return limit;
    }
    for (const child of Object.values(node)) walk.push([child, doc]);
  }
  return worst;
}

/** Keywords that fail only because something inside them did. */
const APPLICATORS = new Set(['$ref', '$dynamicRef', 'properties', 'additionalProperties', 'patternProperties', 'items', 'prefixItems', 'additionalItems', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas', 'contains', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames']);

/**
 * The problems that say what is actually wrong: a validator also reports
 * every enclosing keyword that failed because of a deeper one ("A subschema
 * had errors" at the root). This drops an applicator (`$ref`, `properties`,
 * `allOf`) or a `false` schema when something deeper failed, or when a
 * keyword that checks the value itself (`type`, `required`) failed at the
 * same pointer. A keyword that checks the value itself is always kept, even
 * when its children fail too: a missing property and a wrong-typed one are
 * two problems.
 * Pass every problem (`maxProblems: Infinity`), then cap what this returns.
 */
export function leafProblems(problems: SchemaProblem[]): SchemaProblem[] {
  // Every pointer that has a failing pointer below it.
  const enclosing = new Set<string>();
  for (const { pointer } of problems) {
    const tokens = pointer.split('/');
    for (let n = 1; n < tokens.length; n++) enclosing.add(tokens.slice(0, n).join('/'));
  }
  const secondary = (p: SchemaProblem) => APPLICATORS.has(p.keyword) || p.keyword === 'false';
  const direct = new Set(problems.filter((p) => !secondary(p)).map((p) => p.pointer));
  return problems.filter((p) => !secondary(p) || (!enclosing.has(p.pointer) && !direct.has(p.pointer)));
}
