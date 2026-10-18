import { regexRisk } from '../kit/regex.js';
import type { Schema, SchemaDraft, SchemaProblem } from '../kit/json-schema.js';
import { atPointer, brief, collectRefs, DATA_KEYS, isObject, without, NAME_MAPS, refPointer, type Json, type JsonObject, type Spec } from './document.js';
import { follow, MAX_NESTING } from './operations.js';

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
  /** Values generated so far, against {@link MAX_NODES}. */
  nodes?: number;
  /** Characters the example holds so far, against {@link MAX_CHARS}: every value and the structure around it. */
  chars?: number;
  /** How deep generation is right now, against {@link MAX_NESTING}. */
  level?: number;
  /** Patterns not run while generating, because their shape can take exponential time, each with why. */
  skippedPatterns?: Map<string, string>;
  /** Set when the budget ran out. */
  truncated?: boolean;
}

/** The most values one example generates: required properties can fan out as fast as any schema. */
export const MAX_NODES = 250_000;
/** The longest string one example holds, and the most repeats a pattern's {n} is read with. A schema can ask for more; the example is then cut short and says so. */
export const MAX_STRING = 10_000;
/**
 * The most characters one example holds, serialised. The value and per-string
 * caps multiply (250,000 values of 10,000 characters is 2.5 billion, past what
 * V8 can serialize), and a document's own `const` or `enum` can be any size,
 * so the total is capped on its own, at {@link emit}.
 */
export const MAX_CHARS = 1_000_000;

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
    if (m) {
      i += m[0].length;
      // A repeat count past MAX_STRING would build a string no example should hold.
      return Number(m[1]) > MAX_STRING ? fail() : Number(m[1]);
    }
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
      if (out.length + one.length * times > MAX_STRING) fail();
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

/**
 * Charges `cost` characters to the example's budget. False, with the example
 * marked cut short, once the budget is spent.
 */
function charge(g: Generator, cost: number): boolean {
  if ((g.chars ?? 0) > MAX_CHARS) return false;
  g.chars = (g.chars ?? 0) + cost;
  if (g.chars <= MAX_CHARS) return true;
  g.truncated = true;
  return false;
}

/**
 * The one way a value gets into an example: every leaf the generator makes,
 * and every value it takes from the document (a `const`, an `enum` entry,
 * however large), is charged at its serialised length. Past the budget it's
 * null and the example is cut short. Per-keyword caps kept being outflanked
 * by the next keyword; a turnstile at the only door is harder to walk round.
 */
function emit(g: Generator, value: Json): Json {
  // The budget is checked before the value is serialised: once it's spent, a large const reached a million times costs nothing.
  if ((g.chars ?? 0) > MAX_CHARS) {
    g.truncated = true;
    return null;
  }
  return charge(g, JSON.stringify(value).length) ? value : null;
}

function stringValue(g: Generator, node: JsonObject): string {
  let min = typeof node.minLength === 'number' ? node.minLength : 0;
  if (min > MAX_STRING) {
    g.truncated = true;
    min = MAX_STRING;
  }
  const max = typeof node.maxLength === 'number' ? node.maxLength : Infinity;
  const fit = (value: string) => (value.length < min ? value + 'x'.repeat(min - value.length) : value.length > max ? value.slice(0, max) : value);
  const base = fit(typeof node.format === 'string' && FORMATS[node.format] !== undefined ? FORMATS[node.format]! : 'string');
  if (typeof node.pattern !== 'string') return base;
  const risk = regexRisk(node.pattern);
  if (risk) {
    (g.skippedPatterns ??= new Map()).set(node.pattern, risk);
    return base;
  }
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
  // A pathological pattern can overflow the regex engine's stack; that is the schema's problem, and validation will say so.
  const matches = (c: string) => {
    try {
      return pattern.test(c);
    } catch {
      return false;
    }
  };
  if (matches(base)) return base;
  // The pattern's own simplest match first, then the stock candidates; validation says so if none fits.
  const read = sampleOfPattern(node.pattern);
  return [...(read === undefined ? [] : [read, fit(read)]), ...PATTERN_CANDIDATES.map(fit)].find((c) => c.length >= min && c.length <= max && matches(c)) ?? base;
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
  // An example nested deeper than MAX_NESTING would overflow the stack here or when it's serialised.
  if ((g.level ?? 0) >= MAX_NESTING) {
    g.truncated = true;
    return null;
  }
  g.level = (g.level ?? 0) + 1;
  try {
    return generateNode(g, node, trail, outer);
  } finally {
    g.level--;
  }
}

function generateNode(g: Generator, node: Json | undefined, trail: string[], outer: JsonObject): Json {
  g.nodes = (g.nodes ?? 0) + 1;
  if (g.nodes > MAX_NODES) {
    g.truncated = true;
    return null;
  }
  if (node === undefined || node === true) return emit(g, {});
  if (!isObject(node)) return emit(g, null);
  if (typeof node.$ref === 'string') {
    const target = refPointer(node.$ref);
    // A ref that loops, required all the way round, has no finite example; null lets validation say so.
    if (target === undefined || trail.filter((t) => t === target).length >= 2) return emit(g, null);
    const value = atPointer(g.doc, target);
    if (value === undefined) return emit(g, null);
    const siblings = without(node, '$ref');
    const own = generate(g, value, [...trail, target], outer);
    return (g.spec === 'openapi-3.1' || g.spec === 'openapi-3.2') && Object.keys(siblings).length ? merge(own, generate(g, siblings, trail, outer)) : own;
  }
  if (node.const !== undefined) return emit(g, node.const);
  if (Array.isArray(node.enum) && node.enum.length) return emit(g, node.enum.find((v) => v !== null) ?? node.enum[0]!);
  const type = typeOf(node);
  let value: Json | undefined;
  if (type === 'null') value = emit(g, null);
  else if (type === 'object') {
    // Looked up, not merged: copying a wide schema's properties for every object generated is where the time went.
    const own = isObject(node.properties) ? node.properties : {};
    const prop = (name: string) => (Object.hasOwn(own, name) ? own[name] : outer[name]);
    const required = Array.isArray(node.required) ? node.required.filter((r): r is string => typeof r === 'string') : [];
    const out: JsonObject = {};
    // An object costs its braces, and each property its quoted name, colon and comma.
    if (!charge(g, 2)) return null;
    for (const name of required) {
      if (leftOut(g, prop(name))) continue;
      if (!charge(g, JSON.stringify(name).length + 2)) break;
      out[name] = generate(g, prop(name) ?? (isObject(node.additionalProperties) ? node.additionalProperties : true), trail);
    }
    const minProps = typeof node.minProperties === 'number' ? node.minProperties : 0;
    if (Object.keys(out).length < minProps) {
      for (const name of new Set([...Object.keys(outer), ...Object.keys(own)])) {
        if (Object.keys(out).length >= minProps) break;
        if (name in out || leftOut(g, prop(name))) continue;
        if (!charge(g, JSON.stringify(name).length + 2)) break;
        out[name] = generate(g, prop(name), trail);
      }
    }
    value = out;
  } else if (type === 'array') {
    const wanted = typeof node.minItems === 'number' ? node.minItems : 0;
    // Never more items than the budget has left: a minItems of a billion would otherwise allocate a billion.
    const count = Math.min(wanted, Math.max(0, MAX_NODES - (g.nodes ?? 0)));
    const tuple = Array.isArray(node.items) ? node.items : undefined;
    const items: Json[] = [];
    if (!charge(g, 2)) return null;
    for (let i = 0; i < count && !g.truncated; i++) {
      let one = generate(g, tuple ? tuple[i] : (node.items as Json | undefined), trail);
      // Unique items: vary the primitives so two placeholders don't collide, and pay for the suffix.
      if (node.uniqueItems === true && i > 0 && (typeof one === 'string' || typeof one === 'number')) {
        if (!charge(g, String(i).length)) break;
        one = typeof one === 'string' ? `${one}${i}` : one + i;
      }
      if (!charge(g, 1)) break;
      items.push(one);
    }
    if (items.length < wanted) g.truncated = true;
    value = items;
  } else if (type === 'string') value = emit(g, stringValue(g, node));
  else if (type === 'integer' || type === 'number') value = emit(g, numberValue(node, type === 'integer'));
  else if (type === 'boolean') value = emit(g, true);
  else if (type === 'file') value = emit(g, 'string');
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = node[key];
    if (!Array.isArray(branches) || !branches.length) continue;
    // allOf: every branch, merged. oneOf and anyOf: the first branch that isn't just null.
    const chosen = key === 'allOf' ? branches : [branches.find((b) => !(isObject(b) && b.type === 'null')) ?? branches[0]!];
    const known = { ...outer, ...(isObject(node.properties) ? node.properties : {}) };
    for (const branch of chosen) value = value === undefined ? generate(g, branch, trail, known) : merge(value, generate(g, branch, trail, known));
  }
  if (value === undefined) value = emit(g, isNullable(node) ? null : {});
  return value;
}

/** The smallest example of a schema, generated by the rules above. */
export function generateExample(doc: Json, spec: Spec, schema: Json, direction: Direction): { example: Json; truncated: boolean; skippedPatterns: Array<{ pattern: string; reason: string }> } {
  const g: Generator = { doc, spec, direction };
  const example = generate(g, schema, []);
  return { example, truncated: g.truncated === true, skippedPatterns: [...(g.skippedPatterns ?? [])].map(([pattern, reason]) => ({ pattern, reason })) };
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
  /** Undefined when the example couldn't be checked (its schema reaches outside the document, branches too much, or nests too deep); the reason is given. */
  result?: { valid: boolean; problems: SchemaProblem[]; total: number };
  unchecked?: string;
  /** Patterns validation didn't run, each with why. */
  skippedPatterns?: Array<{ pattern: string; reason: string }>;
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
  const problems = leafProblems(result.problems).map((p) => ({ ...p, message: brief(p.message) }));
  if (result.unchecked !== undefined) return { unchecked: result.unchecked };
  return { result: { valid: result.valid, problems: problems.slice(0, 50), total: problems.length }, skippedPatterns: result.skippedPatterns ?? [] };
}
