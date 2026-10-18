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
        return Array.isArray(value) ? slice(value, node.start, node.stop, node.step) : null;
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
        return base.flatMap((item) => (Array.isArray(item) ? item : [item]));
      }
      case 'Identity':
        return value ?? null;
      case 'Literal':
        return node.value;
      case 'MultiSelectList':
        return value === null || value === undefined ? null : node.children.map((child) => this.visit(child, value));
      case 'MultiSelectHash':
        return value === null || value === undefined ? null : objectOf(node.pairs.map((pair) => [pair.key, this.visit(pair.value, value)] as const));
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
    for (const item of base) {
      const result = this.visit(right, item);
      if (result !== null && result !== undefined) out.push(result);
    }
    return out;
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
    return spec.run(args, this);
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
