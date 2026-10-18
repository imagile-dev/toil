import type { Schema, SchemaDraft, SchemaProblem } from '../kit/json-schema.js';
import { atPointer, collectRefs, DATA_KEYS, isObject, without, NAME_MAPS, refPointer, type Json, type JsonObject, type Spec } from './document.js';
import { follow } from './operations.js';

/**
 * The smallest body a schema accepts: required properties only, the first
 * enum value, the lowest number in range, a string of the minimum length in
 * the right format, the first branch of a oneOf. Read-only properties are
 * left out of a request and write-only ones out of a response, as the spec
 * says. The result is then validated against the schema it came from, `$ref`s
 * and all, before it's returned, because a generator that is merely
 * confident is how most forms come back marked "incomplete".
 */

export type Direction = 'request' | 'response';

interface Generator {
  doc: Json;
  spec: Spec;
  direction: Direction;
}

/** Placeholder values for the formats JSON Schema and OpenAPI name; hosts and addresses are placeholders that never resolve. */
const FORMATS: Record<string, string> = {
  'date-time': '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  time: '00:00:00Z',
  duration: 'P1D',
  email: 'you@example.com',
  'idn-email': 'you@example.com',
  hostname: 'api.imagile.dev',
  'idn-hostname': 'api.imagile.dev',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  uri: 'https://api.imagile.dev',
  url: 'https://api.imagile.dev',
  'uri-reference': 'https://api.imagile.dev',
  iri: 'https://api.imagile.dev',
  'iri-reference': 'https://api.imagile.dev',
  'uri-template': 'https://api.imagile.dev/{id}',
  uuid: 'abc12345-0000-0000-0000-000000000000',
  byte: 'c3RyaW5n',
  'json-pointer': '/a',
  'relative-json-pointer': '0',
  regex: '.*',
};

/** Strings tried, in order, against a `pattern`. Most patterns in real specs are a name, a key or an id. */
const PATTERN_CANDIDATES = ['string', 'abc12345', 'ABC-123', 'abc', 'ABC', 'a', 'A', '0', '1', '123', 'a-b', 'a_b', 'a.b', 'abc12345-0000-0000-0000-000000000000', '2026-01-01', '2026-01-01T00:00:00Z', 'you@example.com', 'https://api.imagile.dev', '#000000', 'v1.0.0', '1.0.0'];

const isNullable = (node: JsonObject) => node.nullable === true || node['x-nullable'] === true;

/** The type to generate: the declared one (the first that isn't null, for a list), else what the keywords imply. */
function typeOf(node: JsonObject): string | undefined {
  const declared = node.type;
  if (typeof declared === 'string') return declared;
  if (Array.isArray(declared)) {
    const types = declared.filter((t): t is string => typeof t === 'string');
    return types.find((t) => t !== 'null') ?? types[0];
  }
  if (isObject(node.properties) || Array.isArray(node.required) || node.additionalProperties !== undefined) return 'object';
  if (node.items !== undefined) return 'array';
  return undefined;
}

/** Characters tried, in order, for a character class or an escape. */
const CLASS_CANDIDATES = ['a', '0', 'A', 'x', '_', '-', '.', ' ', '/', ':', '@'];

/**
 * A string a regular expression matches, read off its simplest path: the
 * first alternative, the fewest repetitions a quantifier allows, the first
 * candidate character a class accepts. Undefined for what it doesn't read
 * (lookaround, backreferences); the caller tests the result either way.
 */
export function sampleOfPattern(source: string): string | undefined {
  let i = 0;
  const fail = (): never => {
    throw new Error('unsupported');
  };
  const pickChar = (classSource: string) => {
    const re = new RegExp(classSource, 'u');
    return CLASS_CANDIDATES.find((c) => re.test(c)) ?? fail();
  };
  const quantity = (): number => {
    const c = source[i];
    if (c === '*' || c === '?') return i++, 0;
    if (c === '+') return i++, 1;
    const m = /^\{(\d+)(,\d*)?\}/.exec(source.slice(i));
    if (m) return (i += m[0].length), Number(m[1]);
    return 1;
  };
  const atom = (): string => {
    const c = source[i]!;
    if (c === '^' || c === '$') return i++, '';
    if (c === '(') {
      i++;
      if (source.startsWith('?:', i)) i += 2;
      else if (source[i] === '?') fail();
      const inner = alternatives();
      if (source[i] !== ')') fail();
      i++;
      return inner;
    }
    if (c === '[') {
      let j = i + 1;
      if (source[j] === '^') j++;
      if (source[j] === ']') j++;
      while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1;
      if (j >= source.length) fail();
      const cls = source.slice(i, j + 1);
      i = j + 1;
      return pickChar(cls);
    }
    if (c === '\\') {
      const e = source[i + 1] ?? fail();
      if (/[1-9kbB]/.test(e)) fail();
      if (/[dDwWsS]/.test(e)) return (i += 2), pickChar(`\\${e}`);
      const hex = /^\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/.exec(source.slice(i));
      if (hex) return (i += hex[0].length), String.fromCharCode(parseInt(hex[1]!.slice(1), 16));
      return (i += 2), e;
    }
    if (c === '.') return i++, 'a';
    return i++, c;
  };
  const sequence = (): string => {
    let out = '';
    while (i < source.length && source[i] !== '|' && source[i] !== ')') {
      const one = atom();
      const times = quantity();
      if (source[i] === '?') i++; // lazy
      out += one.repeat(times);
    }
    return out;
  };
  function alternatives(): string {
    const first = sequence();
    while (source[i] === '|') {
      i++;
      sequence();
    }
    return first;
  }
  try {
    const out = alternatives();
    return i === source.length ? out : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(node: JsonObject): string {
  const min = typeof node.minLength === 'number' ? node.minLength : 0;
  const max = typeof node.maxLength === 'number' ? node.maxLength : Infinity;
  const fit = (value: string) => (value.length < min ? value + 'x'.repeat(min - value.length) : value.length > max ? value.slice(0, max) : value);
  const base = fit(typeof node.format === 'string' && FORMATS[node.format] !== undefined ? FORMATS[node.format]! : 'string');
  if (typeof node.pattern !== 'string') return base;
  let pattern: RegExp;
  try {
    pattern = new RegExp(node.pattern, 'u');
  } catch {
    try {
      pattern = new RegExp(node.pattern);
    } catch {
      return base;
    }
  }
  if (pattern.test(base)) return base;
  // The pattern's own simplest match first, then the stock candidates; validation says so if none fits.
  const read = sampleOfPattern(node.pattern);
  return [...(read === undefined ? [] : [read, fit(read)]), ...PATTERN_CANDIDATES.map(fit)].find((c) => c.length >= min && c.length <= max && pattern.test(c)) ?? base;
}

function numberValue(node: JsonObject, integer: boolean): number {
  const step = typeof node.multipleOf === 'number' && node.multipleOf > 0 ? node.multipleOf : integer ? 1 : undefined;
  let low: number | undefined;
  let lowExclusive = false;
  if (typeof node.exclusiveMinimum === 'number') [low, lowExclusive] = [node.exclusiveMinimum, true];
  else if (typeof node.minimum === 'number') [low, lowExclusive] = [node.minimum, node.exclusiveMinimum === true];
  let high: number | undefined;
  let highExclusive = false;
  if (typeof node.exclusiveMaximum === 'number') [high, highExclusive] = [node.exclusiveMaximum, true];
  else if (typeof node.maximum === 'number') [high, highExclusive] = [node.maximum, node.exclusiveMaximum === true];
  let value = 0;
  if (low !== undefined && (value < low || (lowExclusive && value === low))) value = lowExclusive ? low + (step ?? (high !== undefined ? (high - low) / 2 : 1)) : low;
  else if (high !== undefined && (value > high || (highExclusive && value === high))) value = highExclusive ? high - (step ?? 1) : high;
  if (step !== undefined) value = Math.ceil(value / step) * step;
  return integer ? Math.ceil(value) : value;
}

/** Whether a property's schema is read-only (for a request) or write-only (for a response), and so left out. */
function leftOut(g: Generator, prop: Json | undefined): boolean {
  const found = follow(g.doc, prop, '');
  if (!found || !isObject(found.node)) return false;
  return g.direction === 'request' ? found.node.readOnly === true : found.node.writeOnly === true;
}

function merge(a: Json, b: Json): Json {
  if (isObject(a) && isObject(b)) {
    const out: JsonObject = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k]!, v) : v;
    return out;
  }
  return b === undefined ? a : b;
}

/**
 * `outer` is the property schemas of the schemas enclosing this one through
 * allOf, oneOf or anyOf: a branch may require a property only its parent
 * describes (`required: [conclusion]` beside the parent's `properties`).
 */
function generate(g: Generator, node: Json | undefined, trail: string[], outer: JsonObject = {}): Json {
  if (node === undefined || node === true) return {};
  if (!isObject(node)) return null;
  if (typeof node.$ref === 'string') {
    const target = refPointer(node.$ref);
    // A ref that loops, required all the way round, has no finite example; null lets validation say so.
    if (target === undefined || trail.filter((t) => t === target).length >= 2) return null;
    const value = atPointer(g.doc, target);
    if (value === undefined) return null;
    const siblings = without(node, '$ref');
    const own = generate(g, value, [...trail, target], outer);
    return (g.spec === 'openapi-3.1' || g.spec === 'openapi-3.2') && Object.keys(siblings).length ? merge(own, generate(g, siblings, trail, outer)) : own;
  }
  if (node.const !== undefined) return node.const;
  if (Array.isArray(node.enum) && node.enum.length) return node.enum.find((v) => v !== null) ?? node.enum[0]!;
  const type = typeOf(node);
  let value: Json | undefined;
  if (type === 'null') value = null;
  else if (type === 'object') {
    const props = { ...outer, ...(isObject(node.properties) ? node.properties : {}) };
    const required = Array.isArray(node.required) ? node.required.filter((r): r is string => typeof r === 'string') : [];
    const out: JsonObject = {};
    for (const name of required) {
      if (leftOut(g, props[name])) continue;
      out[name] = generate(g, props[name] ?? (isObject(node.additionalProperties) ? node.additionalProperties : true), trail);
    }
    const minProps = typeof node.minProperties === 'number' ? node.minProperties : 0;
    for (const name of Object.keys(props)) {
      if (Object.keys(out).length >= minProps) break;
      if (!(name in out) && !leftOut(g, props[name])) out[name] = generate(g, props[name], trail);
    }
    value = out;
  } else if (type === 'array') {
    const count = typeof node.minItems === 'number' ? node.minItems : 0;
    const tuple = Array.isArray(node.items) ? node.items : undefined;
    value = Array.from({ length: count }, (_, i) => {
      const one = generate(g, tuple ? tuple[i] : (node.items as Json | undefined), trail);
      // Unique items: vary the primitives so two placeholders don't collide.
      return node.uniqueItems === true && i > 0 ? (typeof one === 'string' ? `${one}${i}` : typeof one === 'number' ? one + i : one) : one;
    });
  } else if (type === 'string') value = stringValue(node);
  else if (type === 'integer' || type === 'number') value = numberValue(node, type === 'integer');
  else if (type === 'boolean') value = true;
  else if (type === 'file') value = 'string';
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = node[key];
    if (!Array.isArray(branches) || !branches.length) continue;
    // allOf: every branch, merged. oneOf and anyOf: the first branch that isn't just null.
    const chosen = key === 'allOf' ? branches : [branches.find((b) => !(isObject(b) && b.type === 'null')) ?? branches[0]!];
    const known = { ...outer, ...(isObject(node.properties) ? node.properties : {}) };
    for (const branch of chosen) value = value === undefined ? generate(g, branch, trail, known) : merge(value, generate(g, branch, trail, known));
  }
  if (value === undefined) value = isNullable(node) ? null : {};
  return value;
}

/** The smallest example of a schema, generated by the rules above. */
export function generateExample(doc: Json, spec: Spec, schema: Json, direction: Direction): Json {
  return generate({ doc, spec, direction }, schema, []);
}

/** A JSON pointer as cfworker indexes it: each token escaped, then URI-encoded. */
const asFragment = (pointer: string) => pointer.split('/').map((t, i) => (i === 0 ? t : encodeURI(t))).join('/');

/**
 * The schema as JSON Schema the validator reads: OpenAPI 3.0 and Swagger
 * 2.0 schemas are draft-04 plus `nullable` (Swagger's `x-nullable`), which
 * becomes a `null` type; a read-only property is not required in a request,
 * nor a write-only one in a response. 3.1 and 3.2 schemas are 2020-12 as
 * written.
 */
function asJsonSchema(g: Generator, node: Json, names = false): Json {
  if (Array.isArray(node)) return node.map((child) => asJsonSchema(g, child));
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(node)) {
    const data = !names && (DATA_KEYS.has(key) || key === 'examples' || key.startsWith('x-'));
    out[key] = data ? child : asJsonSchema(g, child, !names && NAME_MAPS.has(key));
  }
  if (names) return out;
  if ((g.spec === 'openapi-3.0' || g.spec === 'swagger-2.0') && isNullable(node)) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  if (out.type === 'file') delete out.type;
  if (Array.isArray(out.required) && isObject(node.properties)) {
    const props = node.properties;
    out.required = out.required.filter((name) => typeof name !== 'string' || !leftOut(g, props[name]));
  }
  return out;
}

const BASE = 'urn:toil:openapi';

export interface ExampleCheck {
  /** Undefined when the schema reaches outside the document, so it can't be checked; the reason is given. */
  result?: { valid: boolean; problems: SchemaProblem[]; total: number };
  unchecked?: string;
}

/**
 * Validates `example` against the schema at `pointer` in the document (or
 * against `inline`, a schema built from Swagger form parameters). Only what
 * the schema reaches is copied, at the same pointers, so its `$ref`s resolve
 * as they do in the document.
 */
export async function checkExample(doc: Json, spec: Spec, direction: Direction, example: Json, at: { pointer: string } | { inline: JsonObject }): Promise<ExampleCheck> {
  const g: Generator = { doc, spec, direction };
  const rootPointer = 'pointer' in at ? at.pointer : '/x-toil-inline';
  const root = 'pointer' in at ? atPointer(doc, at.pointer) : at.inline;
  if (root === undefined) return { unchecked: `nothing is at ${rootPointer}` };
  const mini: JsonObject = {};
  const place = (pointer: string, value: Json) => {
    const tokens = pointer.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node = mini;
    for (const token of tokens.slice(0, -1)) {
      if (!isObject(node[token])) node[token] = {};
      node = node[token] as JsonObject;
    }
    node[tokens[tokens.length - 1]!] = asJsonSchema(g, value);
  };
  // Every target the schema reaches, breadth first; each placed once.
  const seen = new Set<string>();
  const queue: Json[] = [root];
  while (queue.length) {
    for (const { ref } of collectRefs(queue.shift()!, spec)) {
      const target = refPointer(ref);
      if (target === undefined) return { unchecked: `its schema refers to ${ref}, outside this document` };
      if (seen.has(target)) continue;
      const value = atPointer(doc, target);
      if (value === undefined) return { unchecked: `its schema refers to ${ref}, which points at nothing` };
      seen.add(target);
      queue.push(value);
    }
  }
  // Outer targets first, so an inner one placed later overwrites its own copy with the same thing.
  for (const target of [...seen].sort((a, b) => a.length - b.length)) if (target !== '') place(target, atPointer(doc, target)!);
  if (seen.has('')) return { unchecked: 'its schema refers to the whole document (#)' };
  place(rootPointer, root);
  const { leafProblems, validateSchema } = await import('../kit/json-schema.js');
  const draft: SchemaDraft = spec === 'openapi-3.0' || spec === 'swagger-2.0' ? '4' : '2020-12';
  const result = validateSchema({ $ref: `${BASE}#${asFragment(rootPointer)}` } as Schema, example, { draft, references: [{ schema: mini as Schema, id: BASE }], maxProblems: Infinity });
  const problems = leafProblems(result.problems);
  return { result: { valid: result.valid, problems: problems.slice(0, 50), total: problems.length } };
}
