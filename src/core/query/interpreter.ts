import { QueryError } from './errors.js';
import type { Node } from './parser.js';

/**
 * Evaluates a parsed JMESPath expression against data. Adapted to strict
 * TypeScript from the Apache-2.0 jmespath.js reference implementation (see
 * NOTICE), with these changes, each one the language's compliance suite or
 * the data toil hands it requires:
 *
 * - only an object's own keys are fields, so `constructor` or `__proto__`
 *   never reaches into JavaScript, and objects are built so that a key named
 *   `__proto__` is just a key
 * - `<`, `<=`, `>` and `>=` compare numbers only; anything else gives null
 * - strings are measured, reversed and ordered by code point, not UTF-16 unit
 * - `contains` compares by value, `to_number` reads only JSON numbers, and
 *   `max_by` / `min_by` of an empty array is null
 *
 * The only side effect of evaluating is the answer. No expression can call
 * out, write, or loop forever: every construct walks data that is already
 * there, which is more than most reporting tools can say.
 */

type JsonType = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'null' | 'expref';
type ArgType = JsonType | 'any' | 'array-number' | 'array-string';

/** A `&expression` argument: evaluated by the function it's passed to, per element. */
export class ExpressionReference {
  constructor(readonly node: Node) {}

  /** Only a function can use one; anywhere else in a result it is null, never the parse tree. */
  toJSON(): null {
    return null;
  }
}

type Obj = Record<string, unknown>;

/**
 * How much JSON one evaluation may build (docs/bounds.md, `query.size`):
 * 16 MiB, plus four times the size of the data it was given, so selecting
 * from a large result works as well as from a small one. Every array, object
 * and string the interpreter makes is measured as it grows, as the JSON it
 * would serialize to, so an expression that doubles its input at each step
 * (`[@,@][]` repeated, or `[@,@]` piped into itself) stops with an error long
 * before the heap runs out. The structure built along the way, kept or thrown
 * away, counts against the same figure. Values the interpreter only passes
 * along (`@`, a field) aren't built, so they cost nothing.
 */
export const MAX_RESULT_BYTES = 16 * 1024 * 1024;
export const RESULT_INPUT_FACTOR = 4;

const tooLarge = (limit: number) =>
  new QueryError(
    'invalid-value',
    `The expression builds more than ${Math.round(limit / (1024 * 1024))} MiB of JSON, the most it may build from this data (16 MiB plus four times the data's own size). Select fewer fields or elements.`,
  );

/**
 * A leaf's size as JSON, near enough: a string's escapes aren't counted, and
 * every number counts as 8 characters, since printing each one to find out
 * would cost more than the bound saves.
 */
function leafSize(value: unknown): number {
  if (typeof value === 'string') return value.length + 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return value ? 4 : 5;
  return 4;
}

const isObject = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ExpressionReference);

function typeOf(value: unknown): JsonType {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value instanceof ExpressionReference) return 'expref';
  return 'object';
}

/** An own key's value, or null. A missing key and `undefined` both read as null. */
function field(value: unknown, name: string): unknown {
  if (!isObject(value) || !Object.hasOwn(value, name)) return null;
  return value[name] ?? null;
}

/** False is `false`, null, and an empty string, array or object; everything else, 0 included, is true. */
export function isFalse(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const type = typeOf(a);
  if (type !== typeOf(b)) return false;
  if (type === 'null') return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** Builds an object whose keys are only data: `__proto__` included, none of them touch the prototype. */
const objectOf = (entries: Iterable<readonly [string, unknown]>): Obj => Object.fromEntries(entries) as Obj;

/** Code point order, which is what the language means by string order; UTF-16 order differs past U+FFFF. */
function compareStrings(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function compare(a: unknown, b: unknown): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : compareStrings(a as string, b as string);
}

interface FunctionSpec {
  args: ArgType[][];
  /** The last argument may repeat; at least `args.length` are needed. */
  variadic?: boolean;
  run(args: unknown[], interpreter: Interpreter): unknown;
}

const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

const FUNCTIONS: Record<string, FunctionSpec> = {
  abs: { args: [['number']], run: ([n]) => Math.abs(n as number) },
  avg: {
    args: [['array-number']],
    run: ([list]) => {
      const numbers = list as number[];
      return numbers.length === 0 ? null : numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    },
  },
  ceil: { args: [['number']], run: ([n]) => Math.ceil(n as number) },
  contains: {
    args: [['array', 'string'], ['any']],
    run: ([subject, search]) => (typeof subject === 'string' ? typeof search === 'string' && subject.includes(search) : (subject as unknown[]).some((item) => deepEqual(item, search))),
  },
  ends_with: { args: [['string'], ['string']], run: ([s, suffix]) => (s as string).endsWith(suffix as string) },
  floor: { args: [['number']], run: ([n]) => Math.floor(n as number) },
  join: { args: [['string'], ['array-string']], run: ([glue, list]) => (list as string[]).join(glue as string) },
  keys: { args: [['object']], run: ([o]) => Object.keys(o as Obj) },
  length: {
    args: [['string', 'array', 'object']],
    run: ([v]) => (typeof v === 'string' ? Array.from(v).length : Array.isArray(v) ? v.length : Object.keys(v as Obj).length),
  },
  map: {
    args: [['expref'], ['array']],
    run: ([ref, list], interpreter) => (list as unknown[]).map((item) => interpreter.visit((ref as ExpressionReference).node, item)),
  },
  max: { args: [['array-number', 'array-string']], run: ([list]) => extreme(list as unknown[], 1) },
  max_by: { args: [['array'], ['expref']], run: ([list, ref], interpreter) => extremeBy(list as unknown[], ref as ExpressionReference, interpreter, 1, 'max_by') },
  merge: { args: [['object']], variadic: true, run: (objects) => objectOf(objects.flatMap((o) => Object.entries(o as Obj))) },
  min: { args: [['array-number', 'array-string']], run: ([list]) => extreme(list as unknown[], -1) },
  min_by: { args: [['array'], ['expref']], run: ([list, ref], interpreter) => extremeBy(list as unknown[], ref as ExpressionReference, interpreter, -1, 'min_by') },
  not_null: { args: [['any']], variadic: true, run: (values) => values.find((v) => typeOf(v) !== 'null') ?? null },
  reverse: { args: [['string', 'array']], run: ([v]) => (typeof v === 'string' ? Array.from(v).reverse().join('') : [...(v as unknown[])].reverse()) },
  sort: { args: [['array-number', 'array-string']], run: ([list]) => [...(list as unknown[])].sort(compare) },
  sort_by: { args: [['array'], ['expref']], run: ([list, ref], interpreter) => sortBy(list as unknown[], ref as ExpressionReference, interpreter) },
  starts_with: { args: [['string'], ['string']], run: ([s, prefix]) => (s as string).startsWith(prefix as string) },
  sum: { args: [['array-number']], run: ([list]) => (list as number[]).reduce((sum, n) => sum + n, 0) },
  to_array: { args: [['any']], run: ([v]) => (Array.isArray(v) ? v : [v ?? null]) },
  to_number: {
    args: [['any']],
    run: ([v]) => (typeof v === 'number' ? v : typeof v === 'string' && JSON_NUMBER.test(v) ? Number(v) : null),
  },
  to_string: { args: [['any']], run: ([v]) => (typeof v === 'string' ? v : JSON.stringify(v ?? null)) },
  type: { args: [['any']], run: ([v]) => typeOf(v) },
  values: { args: [['object']], run: ([o]) => Object.values(o as Obj) },
};

function extreme(list: unknown[], sign: 1 | -1): unknown {
  if (list.length === 0) return null;
  return list.reduce((best, item) => (sign * compare(item, best) > 0 ? item : best));
}

/** The keys an `&expression` gives each element: all numbers or all strings, or the call is an invalid-type error. */
function keysBy(list: unknown[], ref: ExpressionReference, interpreter: Interpreter, name: string): unknown[] {
  const keys = list.map((item) => interpreter.visit(ref.node, item));
  const first = typeOf(keys[0]);
  for (const key of keys) {
    const type = typeOf(key);
    if ((type !== 'number' && type !== 'string') || type !== first) {
      throw new QueryError('invalid-type', `${name}() needs its expression to give every element a number, or every element a string; one gave ${type}.`);
    }
  }
  return keys;
}

function extremeBy(list: unknown[], ref: ExpressionReference, interpreter: Interpreter, sign: 1 | -1, name: string): unknown {
  if (list.length === 0) return null;
  const keys = keysBy(list, ref, interpreter, name);
  let best = 0;
  for (let i = 1; i < list.length; i++) if (sign * compare(keys[i], keys[best]) > 0) best = i;
  return list[best];
}

function sortBy(list: unknown[], ref: ExpressionReference, interpreter: Interpreter): unknown[] {
  if (list.length === 0) return [];
  const keys = keysBy(list, ref, interpreter, 'sort_by');
  // Array.prototype.sort is stable, so equal keys keep their order.
  return list.map((item, i) => ({ item, key: keys[i] })).sort((a, b) => compare(a.key, b.key)).map((pair) => pair.item);
}

function matches(value: unknown, type: ArgType): boolean {
  if (type === 'any') return true;
  const actual = typeOf(value);
  if (type === 'array-number' || type === 'array-string') {
    const element = type === 'array-number' ? 'number' : 'string';
    return actual === 'array' && (value as unknown[]).every((item) => typeOf(item) === element);
  }
  return actual === type;
}

/** Arity is known from the expression alone, so it's checked when compiling, before anything runs. */
export function checkFunctions(node: Node): void {
  for (const child of children(node)) checkFunctions(child);
  if (node.type !== 'Function') return;
  const spec = FUNCTIONS[node.name];
  if (!spec || !Object.hasOwn(FUNCTIONS, node.name)) throw new QueryError('unknown-function', `There is no function ${node.name}().`, node.position);
  const count = node.args.length;
  const ok = spec.variadic ? count >= spec.args.length : count === spec.args.length;
  if (!ok) {
    const wanted = `${spec.variadic ? 'at least ' : ''}${spec.args.length} argument${spec.args.length === 1 ? '' : 's'}`;
    throw new QueryError('invalid-arity', `${node.name}() takes ${wanted}, and was given ${count}.`, node.position);
  }
}

/**
 * Refuses a tree deeper than `max`, walked with a list rather than recursion,
 * so the check itself can't overflow. The parser bounds its own recursion; this
 * bounds what it built, since `a.b.c...` nests one level per operator without
 * recursing in the parser at all.
 */
export function checkDepth(root: Node, max: number): void {
  const stack: Array<[Node, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (depth > max) throw new QueryError('syntax', `The expression nests more than ${max} levels deep.`);
    for (const child of children(node)) stack.push([child, depth + 1]);
  }
}

function children(node: Node): Node[] {
  switch (node.type) {
    case 'Subexpression':
    case 'IndexExpression':
    case 'Projection':
    case 'ValueProjection':
    case 'Comparator':
    case 'Or':
    case 'And':
    case 'Pipe':
      return [node.left, node.right];
    case 'FilterProjection':
      return [node.left, node.right, node.condition];
    case 'Flatten':
    case 'Not':
    case 'ExpressionReference':
      return [node.child];
    case 'MultiSelectList':
      return node.children;
    case 'MultiSelectHash':
      return node.pairs.map((pair) => pair.value);
    case 'Function':
      return node.args;
    default:
      return [];
  }
}

export class Interpreter {
  /**
   * Each built value's size as JSON, and each input value's once it has been
   * measured; -1 while one is being measured. A Map rather than a WeakMap,
   * which is several times slower to fill; what it holds is bounded by
   * `spent`, and it's dropped when `run` ends.
   */
  private sizes = new Map<object, number>();
  /** The structure built so far in this run: brackets, commas and keys, never the values they hold. */
  private spent = 0;
  private input: unknown = null;
  /** The limit in force: `limit` until something passes it, then `limit` plus four times the input's size. */
  private cap = 0;
  private raised = false;

  constructor(private readonly limit = MAX_RESULT_BYTES) {}

  /** Evaluates one expression against one piece of data, with a fresh budget. */
  run(node: Node, value: unknown): unknown {
    this.sizes = new Map();
    this.spent = 0;
    this.input = value;
    this.cap = this.limit;
    this.raised = false;
    try {
      return this.visit(node, value);
    } finally {
      this.sizes = new Map();
      this.input = null;
    }
  }

  /**
   * Throws once `bytes` passes the limit. The input is measured only the
   * first time something passes the fixed part, so a small result from large
   * data never pays for walking all of it.
   */
  private check(bytes: number): void {
    if (bytes <= this.cap) return;
    if (!this.raised) {
      this.raised = true;
      this.cap = this.limit + RESULT_INPUT_FACTOR * this.size(this.input);
      if (bytes <= this.cap) return;
    }
    throw tooLarge(this.cap);
  }

  /** The running size of a value being built, after adding `item`; throws past the limit, before anything more is added. */
  private grow(total: number, item: unknown, extra = 0): number {
    const next = total + this.size(item) + 1 + extra;
    this.spent += 1 + extra;
    this.check(Math.max(next, this.spent));
    return next;
  }

  /** Records a value's size once it's built, so whatever is built from it next can add it in one step. */
  private built<T>(value: T, total: number): T {
    this.spent += 2;
    if (typeof value === 'object' && value !== null) this.sizes.set(value, total);
    return value;
  }

  /**
   * A value a function or a slice returned, measured whole. Each of those
   * returns at most a constant times what it was given, which was measured
   * already, so measuring afterwards can't come too late.
   */
  private measured<T>(value: T): T {
    if (typeof value === 'string') {
      this.spent += value.length;
      this.check(Math.max(value.length + 2, this.spent));
      return value;
    }
    if (typeof value !== 'object' || value === null || value instanceof ExpressionReference || this.sizes.has(value)) return value;
    let total = 2;
    if (Array.isArray(value)) for (const item of value) total = this.grow(total, item);
    else for (const [key, item] of Object.entries(value)) total = this.grow(total, item, key.length + 3);
    return this.built(value, total);
  }

  /**
   * A value's size as JSON. Data the expression was given is walked once,
   * depth first with a list of frames rather than recursion, so nesting
   * thousands deep can't overflow the stack, and remembered, so a value used
   * twice costs nothing the second time. The frames are exactly the path from
   * the value down, so meeting one of them again means data that refers to
   * itself, which has no JSON form, and says so.
   */
  private size(value: unknown): number {
    if (typeof value !== 'object' || value === null) return leafSize(value);
    if (value instanceof ExpressionReference) return 4;
    const known = this.sizes.get(value);
    if (known !== undefined && known >= 0) return known;
    const frames: Array<{ node: object; keys: string[] | undefined; i: number; total: number }> = [];
    const open = (node: object) => {
      this.sizes.set(node, -1);
      frames.push({ node, keys: Array.isArray(node) ? undefined : Object.keys(node), i: 0, total: 2 });
    };
    open(value);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const array = frame.keys === undefined ? (frame.node as unknown[]) : undefined;
      const count = array ? array.length : frame.keys!.length;
      let descended = false;
      while (frame.i < count) {
        const key = array ? undefined : frame.keys![frame.i]!;
        const item = array ? array[frame.i] : (frame.node as Obj)[key!];
        if (typeof item === 'object' && item !== null && !(item instanceof ExpressionReference)) {
          const child = this.sizes.get(item);
          if (child === -1) throw new QueryError('invalid-value', 'The data refers to itself, so it has no JSON form to select from.');
          if (child === undefined) {
            // Measure the child first; this element is added when the frame resumes.
            open(item);
            descended = true;
            break;
          }
          frame.total += child;
        } else {
          frame.total += item instanceof ExpressionReference ? 4 : leafSize(item);
        }
        frame.total += key === undefined ? 1 : key.length + 4;
        frame.i++;
      }
      if (!descended) {
        frames.pop();
        this.sizes.set(frame.node, frame.total);
      }
    }
    return this.sizes.get(value)!;
  }

  visit(node: Node, value: unknown): unknown {
    switch (node.type) {
      case 'Field':
        return field(value, node.name);
      case 'Subexpression': {
        const left = this.visit(node.left, value);
        return left === null ? null : this.visit(node.right, left);
      }
      case 'IndexExpression':
        return this.visit(node.right, this.visit(node.left, value));
      case 'Index': {
        if (!Array.isArray(value)) return null;
        const index = node.value < 0 ? value.length + node.value : node.value;
        return value[index] ?? null;
      }
      case 'Slice':
        return Array.isArray(value) ? this.measured(slice(value, node.start, node.stop, node.step)) : null;
      case 'Projection': {
        const base = this.visit(node.left, value);
        if (!Array.isArray(base)) return null;
        return this.project(base, node.right);
      }
      case 'ValueProjection': {
        const base = this.visit(node.left, value);
        if (!isObject(base)) return null;
        return this.project(Object.values(base), node.right);
      }
      case 'FilterProjection': {
        const base = this.visit(node.left, value);
        if (!Array.isArray(base)) return null;
        return this.project(
          base.filter((item) => !isFalse(this.visit(node.condition, item))),
          node.right,
        );
      }
      case 'Flatten': {
        const base = this.visit(node.child, value);
        if (!Array.isArray(base)) return null;
        const out: unknown[] = [];
        let total = 2;
        for (const item of base) {
          if (!Array.isArray(item)) {
            total = this.grow(total, item);
            out.push(item);
            continue;
          }
          // An inner array's elements cost what the array did, less its brackets:
          // added up before any is copied, so a doubling stops before the copy.
          total += this.size(item) - 2;
          this.spent += item.length;
          this.check(Math.max(total, this.spent));
          for (const element of item) out.push(element);
        }
        return this.built(out, total);
      }
      case 'Identity':
        return value ?? null;
      case 'Literal':
        return node.value;
      case 'MultiSelectList': {
        if (value === null || value === undefined) return null;
        const out: unknown[] = [];
        let total = 2;
        for (const child of node.children) {
          const item = this.visit(child, value);
          total = this.grow(total, item);
          out.push(item);
        }
        return this.built(out, total);
      }
      case 'MultiSelectHash': {
        if (value === null || value === undefined) return null;
        const entries: Array<readonly [string, unknown]> = [];
        let total = 2;
        for (const pair of node.pairs) {
          const item = this.visit(pair.value, value);
          total = this.grow(total, item, pair.key.length + 3);
          entries.push([pair.key, item]);
        }
        return this.built(objectOf(entries), total);
      }
      case 'Comparator':
        return comparison(node.op, this.visit(node.left, value), this.visit(node.right, value));
      case 'Or': {
        const left = this.visit(node.left, value);
        return isFalse(left) ? this.visit(node.right, value) : left;
      }
      case 'And': {
        const left = this.visit(node.left, value);
        return isFalse(left) ? left : this.visit(node.right, value);
      }
      case 'Not':
        return isFalse(this.visit(node.child, value));
      case 'Pipe':
        return this.visit(node.right, this.visit(node.left, value));
      case 'Function':
        return this.call(node.name, node.args.map((arg) => this.visit(arg, value)));
      case 'ExpressionReference':
        return new ExpressionReference(node.child);
    }
  }

  /** A projection keeps each element's result, dropping the nulls. */
  private project(base: unknown[], right: Node): unknown[] {
    const out: unknown[] = [];
    let total = 2;
    for (const item of base) {
      const result = this.visit(right, item);
      if (result === null || result === undefined) continue;
      total = this.grow(total, result);
      out.push(result);
    }
    return this.built(out, total);
  }

  private call(name: string, args: unknown[]): unknown {
    // checkFunctions ran at compile time, so the name and the count are known good.
    const spec = FUNCTIONS[name]!;
    args.forEach((arg, i) => {
      const accepted = spec.args[Math.min(i, spec.args.length - 1)]!;
      if (!accepted.some((type) => matches(arg, type))) {
        throw new QueryError('invalid-type', `${name}() expected argument ${i + 1} to be ${accepted.join(' or ')}, and got ${typeOf(arg)}.`);
      }
    });
    return this.measured(spec.run(args, this));
  }
}

function comparison(op: string, left: unknown, right: unknown): boolean | null {
  if (op === 'EQ') return deepEqual(left, right);
  if (op === 'NE') return !deepEqual(left, right);
  if (typeof left !== 'number' || typeof right !== 'number') return null;
  if (op === 'LT') return left < right;
  if (op === 'LTE') return left <= right;
  if (op === 'GT') return left > right;
  return left >= right;
}

/** Python-style slicing, which the language specifies: negative indices count from the end, and out-of-range bounds clamp. */
function slice(list: unknown[], start: number | null, stop: number | null, step: number | null): unknown[] {
  const by = step ?? 1;
  if (by === 0) throw new QueryError('invalid-value', 'A slice step can\'t be 0.');
  const length = list.length;
  const clamp = (value: number) => {
    if (value < 0) {
      const from = value + length;
      return from < 0 ? (by < 0 ? -1 : 0) : from;
    }
    return value >= length ? (by < 0 ? length - 1 : length) : value;
  };
  const from = start === null ? (by < 0 ? length - 1 : 0) : clamp(start);
  const to = stop === null ? (by < 0 ? -1 : length) : clamp(stop);
  const out: unknown[] = [];
  if (by > 0) for (let i = from; i < to; i += by) out.push(list[i]);
  else for (let i = from; i > to; i += by) out.push(list[i]);
  return out;
}
