import type { Difference, Interval, Parsed, RangeOptions, Release, VersionGrammar } from '../versions.js';
import { compareDigits, compareOrdinal, withinBounds } from './shared.js';

/**
 * Maven's versions and ranges, as Maven 3.9 reads them.
 *
 * - **Ordering** splits a version into numbers and qualifiers at `.`, `-` and
 *   every switch between digits and letters, then compares item by item:
 *   `alpha < beta < milestone < rc = cr < snapshot < "" = ga = final =
 *   release < sp`, then any other qualifier in alphabetical order, case
 *   ignored. `a1`, `b1` and `m1` are `alpha-1`, `beta-1` and `milestone-1`,
 *   and trailing zeros and release qualifiers drop out, so `1`, `1.0`,
 *   `1-ga` and `1.0.0.FINAL` are one version.
 * - **Ranges** are `[1.0,2.0)`, `[1.0]`, `(,1.0],[1.2,)` and the like. A bare
 *   version is a soft requirement, which Maven satisfies with any version.
 *
 * Maven will order any string at all. Here a version is one or
 * more letters, digits, `.`, `-`, `_` and `+`, with at least one digit;
 * anything else (a space, a bracket, an unresolved `${property}`) is reported
 * as not a version rather than ordered. Release, ga and final all mean the
 * same thing, which saves a meeting about which one to use.
 */

type Item = { kind: 'number'; value: string } | { kind: 'string'; value: string } | { kind: 'list'; items: Item[] };
type List = Extract<Item, { kind: 'list' }>;

export interface MavenVersion {
  /** The version as written. */
  raw: string;
  items: List;
}

export interface MavenRange {
  /** Each `[...]` or `(...)` set, or one open interval for a soft requirement. */
  restrictions: Interval<MavenVersion>[];
  /** The version a bare (soft) requirement recommends. */
  recommended?: MavenVersion;
}

const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const ALIASES: Record<string, string> = { ga: '', final: '', release: '', cr: 'rc' };
const RELEASE_INDEX = String(QUALIFIERS.indexOf(''));
const VALID = /^[A-Za-z0-9._+-]+$/;
/**
 * The longest version read, as for npm. The parse nests one list per switch
 * between letters and digits, and comparing walks that nesting recursively,
 * so a long 1a1a1a... would otherwise run out of stack.
 */
const MAX_LENGTH = 256;

const ZERO: Item = { kind: 'number', value: '0' };

function stringItem(value: string, followedByDigit: boolean): Item {
  let v = value;
  if (followedByDigit && v.length === 1) v = v === 'a' ? 'alpha' : v === 'b' ? 'beta' : v === 'm' ? 'milestone' : v;
  return { kind: 'string', value: ALIASES[v] ?? v };
}

function parseItem(isDigit: boolean, text: string): Item {
  if (!isDigit) return stringItem(text, false);
  const stripped = text.replace(/^0+/, '');
  return { kind: 'number', value: stripped === '' ? '0' : stripped };
}

const comparableQualifier = (q: string) => {
  const i = QUALIFIERS.indexOf(q);
  return i === -1 ? `${QUALIFIERS.length}-${q}` : String(i);
};

function isNull(item: Item): boolean {
  if (item.kind === 'number') return item.value === '0';
  if (item.kind === 'string') return comparableQualifier(item.value) === RELEASE_INDEX;
  return item.items.length === 0;
}

function normalize(list: List) {
  for (let i = list.items.length - 1; i >= 0; i--) {
    const last = list.items[i]!;
    if (isNull(last)) list.items.splice(i, 1);
    else if (last.kind !== 'list') break;
  }
}

/** Maven's version parse, step for step. */
export function itemsOf(version: string): List {
  const root: List = { kind: 'list', items: [] };
  const v = version.toLowerCase();
  let list = root;
  const stack: List[] = [list];
  const open = () => {
    const next: List = { kind: 'list', items: [] };
    list.items.push(next);
    list = next;
    stack.push(next);
  };
  let isDigit = false;
  let start = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === '.' || c === '-') {
      list.items.push(i === start ? ZERO : parseItem(isDigit, v.slice(start, i)));
      start = i + 1;
      if (c === '-') open();
    } else if (c >= '0' && c <= '9') {
      if (!isDigit && i > start) {
        if (list.items.length) open();
        list.items.push(stringItem(v.slice(start, i), true));
        start = i;
        open();
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        list.items.push(parseItem(true, v.slice(start, i)));
        start = i;
        open();
      }
      isDigit = false;
    }
  }
  if (v.length > start) {
    if (!isDigit && list.items.length) open();
    list.items.push(parseItem(isDigit, v.slice(start)));
  }
  while (stack.length) normalize(stack.pop()!);
  return root;
}

/** Item.compareTo, with `null` for an item one side has run out of. */
function compareItem(a: Item, b: Item | null): number {
  switch (a.kind) {
    case 'number':
      if (b === null) return a.value === '0' ? 0 : 1;
      return b.kind === 'number' ? compareDigits(a.value, b.value) : 1;
    case 'string':
      if (b === null) return compareOrdinal(comparableQualifier(a.value), RELEASE_INDEX);
      return b.kind === 'string' ? compareOrdinal(comparableQualifier(a.value), comparableQualifier(b.value)) : -1;
    case 'list': {
      if (b === null) {
        for (const item of a.items) {
          const r = compareItem(item, null);
          if (r !== 0) return r;
        }
        return 0;
      }
      if (b.kind === 'number') return -1;
      if (b.kind === 'string') return 1;
      for (let i = 0; i < Math.max(a.items.length, b.items.length); i++) {
        const l = a.items[i] ?? null;
        const r = b.items[i] ?? null;
        const result = l === null ? (r === null ? 0 : -1 * compareItem(r, null)) : compareItem(l, r);
        if (result !== 0) return result;
      }
      return 0;
    }
  }
}

export const compareMaven = (a: MavenVersion, b: MavenVersion) => Math.sign(compareItem(a.items, b.items));

/** The canonical form: what Maven reduces the version to. */
export function canonical(list: List): string {
  let out = '';
  for (const item of list.items) {
    if (out.length > 0) out += item.kind === 'list' ? '-' : '.';
    out += item.kind === 'list' ? canonical(item) : item.value;
  }
  return out;
}

function parseVersion(text: string): Parsed<MavenVersion> {
  if (text === '') return { ok: false, reason: 'empty' };
  if (text.length > MAX_LENGTH) return { ok: false, reason: `longer than ${MAX_LENGTH} characters` };
  if (!VALID.test(text)) return { ok: false, reason: 'only letters, digits, ".", "-", "_" and "+" make a Maven version; spaces, brackets, commas and ${...} placeholders do not' };
  if (!/\d/.test(text)) return { ok: false, reason: 'no digit in it, so it names no version' };
  return { ok: true, value: { raw: text, items: itemsOf(text) } };
}

/** Maven's range parse, with its own error messages. */
function parseRange(text: string): Parsed<MavenRange> {
  let process = text.trim();
  if (!process) return { ok: false, reason: 'empty' };
  const version = (s: string): Parsed<MavenVersion> => {
    const parsed = parseVersion(s);
    return parsed.ok ? parsed : { ok: false, reason: `"${s}" is not a Maven version: ${parsed.reason}` };
  };
  const restrictions: Interval<MavenVersion>[] = [];
  let upperBound: MavenVersion | undefined;
  while (process.startsWith('[') || process.startsWith('(')) {
    const close1 = process.indexOf(')');
    const close2 = process.indexOf(']');
    let index = close2;
    if ((close2 < 0 || close1 < close2) && close1 >= 0) index = close1;
    if (index < 0) return { ok: false, reason: `unbounded range: ${text.trim()}` };
    const spec = process.slice(0, index + 1);
    const lowerInclusive = spec.startsWith('[');
    const upperInclusive = spec.endsWith(']');
    const inner = spec.slice(1, -1).trim();
    const comma = inner.indexOf(',');
    let restriction: Interval<MavenVersion>;
    if (comma < 0) {
      if (!lowerInclusive || !upperInclusive) return { ok: false, reason: `a single version must be surrounded by [], as [1.0]: ${spec}` };
      const only = version(inner);
      if (!only.ok) return only;
      restriction = { lower: { version: only.value, inclusive: true }, upper: { version: only.value, inclusive: true } };
    } else {
      const lowerText = inner.slice(0, comma).trim();
      const upperText = inner.slice(comma + 1).trim();
      const lower = lowerText ? version(lowerText) : undefined;
      const upper = upperText ? version(upperText) : undefined;
      if (lower && !lower.ok) return lower;
      if (upper && !upper.ok) return upper;
      if (lower?.ok && upper?.ok) {
        const c = compareMaven(upper.value, lower.value);
        if (c < 0 || (c === 0 && (!lowerInclusive || !upperInclusive))) return { ok: false, reason: `range defies version ordering: ${spec}` };
      }
      restriction = {
        ...(lower?.ok ? { lower: { version: lower.value, inclusive: lowerInclusive } } : {}),
        ...(upper?.ok ? { upper: { version: upper.value, inclusive: upperInclusive } } : {}),
      };
    }
    // As Maven checks it: only against a previous set that had an upper bound.
    if (upperBound !== undefined && (!restriction.lower || compareMaven(restriction.lower.version, upperBound) < 0)) {
      return { ok: false, reason: `ranges overlap: ${text.trim()}` };
    }
    restrictions.push(restriction);
    upperBound = restriction.upper?.version;
    process = process.slice(index + 1).trim();
    if (process.startsWith(',')) process = process.slice(1).trim();
  }
  if (process.length > 0) {
    if (restrictions.length > 0) return { ok: false, reason: `only fully-qualified sets are allowed with more than one set: ${text.trim()}` };
    const soft = version(process);
    if (!soft.ok) return soft;
    return { ok: true, value: { restrictions: [{}], recommended: soft.value } };
  }
  return { ok: true, value: { restrictions } };
}

function formatRestriction(r: Interval<MavenVersion>): string {
  if (r.lower && r.upper && r.lower.version === r.upper.version) return `[${r.lower.version.raw}]`;
  return `${r.lower?.inclusive ? '[' : '('}${r.lower?.version.raw ?? ''},${r.upper?.version.raw ?? ''}${r.upper?.inclusive ? ']' : ')'}`;
}

/** The range as written back: the recommended version for a soft requirement, else the sets. */
const formatRange = (range: MavenRange) => (range.recommended ? range.recommended.raw : range.restrictions.map(formatRestriction).join(','));

const satisfies = (range: MavenRange, v: MavenVersion) => range.restrictions.some((r) => withinBounds(compareMaven, r, v));

const inInterval = (interval: Interval<MavenVersion>, v: MavenVersion, _options: RangeOptions) => withinBounds(compareMaven, interval, v);

/** The leading numbers of a version as written (`1.2.3` of `1.2.3-SNAPSHOT`), or undefined when it doesn't start with one. */
function leadingNumbers(raw: string): string[] | undefined {
  const m = /^\d+(?:\.\d+)*/.exec(raw);
  return m ? m[0].split('.') : undefined;
}

const RELEASES: readonly Release[] = ['major', 'minor', 'patch'];

/** The next major, minor or patch: the leading numbers bumped (as many as there were, at least up to the one bumped), and the qualifier dropped. */
function bump(v: MavenVersion, release: Release): Parsed<MavenVersion> {
  const numbers = leadingNumbers(v.raw);
  if (!numbers) return { ok: false, reason: `${v.raw} doesn't start with a number to bump` };
  const at = release === 'major' ? 0 : release === 'minor' ? 1 : 2;
  const next = numbers.map((n) => BigInt(n));
  while (next.length <= at) next.push(0n);
  next[at] = next[at]! + 1n;
  for (let i = at + 1; i < next.length; i++) next[i] = 0n;
  return parseVersion(next.join('.'));
}

/** The numbers before the first qualifier, as Maven reduced them. */
function numbersOf(v: MavenVersion): string[] {
  const out: string[] = [];
  for (const item of v.items.items) {
    if (item.kind !== 'number') break;
    out.push(item.value);
  }
  return out;
}

function diff(a: MavenVersion, b: MavenVersion): Difference | null {
  if (compareMaven(a, b) === 0) return null;
  const an = numbersOf(a);
  const bn = numbersOf(b);
  const names = ['major', 'minor', 'patch'] as const;
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    if ((an[i] ?? '0') !== (bn[i] ?? '0')) return names[i] ?? 'revision';
  }
  return 'qualifier';
}

export const mavenGrammar: VersionGrammar<MavenVersion, MavenRange> = {
  ecosystem: 'maven',
  parse: parseVersion,
  format: (v) => canonical(v.items),
  compare: compareMaven,
  parseRange,
  formatRange,
  satisfies,
  intervals: (range) => range.restrictions,
  inInterval,
  releases: RELEASES,
  bump,
  diff,
};
