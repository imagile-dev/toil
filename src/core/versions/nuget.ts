import type { Difference, Interval, Parsed, RangeOptions, Release, VersionGrammar } from '../versions.js';
import { compareOrdinal, withinBounds } from './shared.js';

/**
 * NuGet's versions and ranges, as NuGet reads them:
 *
 * - **Versions** have one to four numeric parts (`1`, `1.0`, `1.0.0`,
 *   `1.0.0.0` are one version), each up to 2,147,483,647, then an optional
 *   `-prerelease` and `+metadata`. Leading zeros in the numbers are read as
 *   NuGet reads them (`1.01` is `1.1`); a numeric prerelease label can't
 *   have one. Prerelease labels compare case-insensitively, numbers by
 *   value and below text; metadata never counts.
 * - **Ranges** are interval notation: `1.0` (at least 1.0), `[1.0]`,
 *   `[1.0,2.0)`, `(,1.0]` and the rest of NuGet's table. A prerelease inside
 *   the bounds satisfies a range, as NuGet has it.
 *
 * Floating versions (`1.*`, `1.0.0-*`) are refused: what one means depends on
 * the versions a feed holds at restore time, which is a question for the
 * feed. Four parts, because three were apparently felt to be insufficiently
 * official.
 */

export interface NuGetVersion {
  /** Major, minor, patch, revision. */
  parts: [number, number, number, number];
  labels: string[];
  metadata: string;
}

export interface NuGetRange {
  lower?: { version: NuGetVersion; inclusive: boolean };
  upper?: { version: NuGetVersion; inclusive: boolean };
}

const INT_MAX = 2147483647;
/** The longest version read, as for npm and Maven: no real one comes near it. */
const MAX_LENGTH = 256;
const LABEL = /^[0-9A-Za-z-]+$/;
const DIGITS = /^\d+$/;

/** A label or metadata part: letters, digits and hyphens, and (unless `leadingZeros`) no numeric one with a leading zero. */
function validPart(part: string, leadingZeros: boolean): boolean {
  if (!LABEL.test(part)) return false;
  return leadingZeros || !(part.length > 1 && part[0] === '0' && DIGITS.test(part));
}

function parseVersion(text: string): Parsed<NuGetVersion> {
  if (text.length > MAX_LENGTH) return { ok: false, reason: `longer than ${MAX_LENGTH} characters` };
  const value = text.trim();
  if (!value) return { ok: false, reason: 'empty' };
  const dash = value.indexOf('-');
  const plus = value.indexOf('+');
  const numEnd = Math.min(dash < 0 ? Infinity : dash, plus < 0 ? Infinity : plus);
  const numeric = numEnd === Infinity ? value : value.slice(0, numEnd);
  const sections = numeric.split('.').map((s) => s.trim());
  if (sections.length > 4) return { ok: false, reason: 'more than four numeric parts' };
  const parts: number[] = [];
  for (const s of sections) {
    if (!DIGITS.test(s)) return { ok: false, reason: `"${numeric}" is not one to four dot-separated numbers` };
    const n = Number(s);
    if (n > INT_MAX) return { ok: false, reason: `${s} is larger than ${INT_MAX}` };
    parts.push(n);
  }
  let labels: string[] = [];
  let metadata = '';
  if (numEnd !== Infinity) {
    const rest = value.slice(numEnd);
    const metaAt = rest.indexOf('+');
    const labelText = rest[0] === '-' ? rest.slice(1, metaAt < 0 ? undefined : metaAt) : undefined;
    if (labelText !== undefined) {
      labels = labelText.split('.');
      if (!labels.every((l) => validPart(l, false))) return { ok: false, reason: `"-${labelText}" is not a prerelease label: dot-separated letters, digits and hyphens, no empty part, no leading zero in a number` };
    }
    if (metaAt >= 0) {
      metadata = rest.slice(metaAt + 1);
      if (!metadata.split('.').every((p) => validPart(p, true))) return { ok: false, reason: `"+${metadata}" is not build metadata: dot-separated letters, digits and hyphens, no empty part` };
    }
  }
  const [major = 0, minor = 0, patch = 0, revision = 0] = parts;
  return { ok: true, value: { parts: [major, minor, patch, revision], labels, metadata } };
}

/** NuGet's normalized form: three parts, a fourth only when it isn't 0, the labels, and no metadata. */
function format(v: NuGetVersion): string {
  const [major, minor, patch, revision] = v.parts;
  return `${major}.${minor}.${patch}${revision > 0 ? `.${revision}` : ''}${v.labels.length ? `-${v.labels.join('.')}` : ''}`;
}

/** .NET's int.TryParse on a label: an optional minus sign and digits, inside a 32-bit int. */
function labelNumber(label: string): number | undefined {
  if (!/^-?\d+$/.test(label)) return undefined;
  const n = Number(label);
  return n >= -2147483648 && n <= INT_MAX ? n : undefined;
}

function compareLabel(a: string, b: string): number {
  const an = labelNumber(a);
  const bn = labelNumber(b);
  if (an !== undefined && bn !== undefined) return Math.sign(an - bn);
  if (an !== undefined) return -1;
  if (bn !== undefined) return 1;
  return compareOrdinal(a.toUpperCase(), b.toUpperCase());
}

function compareLabels(a: string[], b: string[]): number {
  if (a.length && !b.length) return -1;
  if (!a.length && b.length) return 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const c = compareLabel(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return 0;
}

export function compareNuGet(a: NuGetVersion, b: NuGetVersion): number {
  for (let i = 0; i < 4; i++) {
    const c = Math.sign(a.parts[i]! - b.parts[i]!);
    if (c !== 0) return c;
  }
  return compareLabels(a.labels, b.labels);
}

const FLOATING = 'floating versions (with *) are resolved against what a feed holds at restore time and aren\'t a range on their own; write the range in interval notation, such as [1.0,2.0)';

/** NuGet's range parse, floating versions refused. */
function parseRange(text: string): Parsed<NuGetRange> {
  const value = text.trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.includes('*')) return { ok: false, reason: FLOATING };
  const version = (s: string, which: string): Parsed<NuGetVersion> => {
    const parsed = parseVersion(s);
    return parsed.ok ? parsed : { ok: false, reason: `the ${which} version "${s.trim()}" is not a NuGet version: ${parsed.reason}` };
  };
  const first = value[0];
  if (first !== '[' && first !== '(') {
    const min = version(value, 'minimum');
    return min.ok ? { ok: true, value: { lower: { version: min.value, inclusive: true } } } : min;
  }
  const last = value[value.length - 1];
  if (last !== ']' && last !== ')') return { ok: false, reason: 'a range that opens with [ or ( closes with ] or )' };
  const lowerInclusive = first === '[';
  const upperInclusive = last === ']';
  const parts = value.slice(1, -1).split(',');
  if (parts.length > 2) return { ok: false, reason: 'more than one comma: NuGet ranges have one lower and one upper bound' };
  if (parts.every((p) => p === '')) return { ok: false, reason: 'no version on either side' };
  if (parts.length === 1 && !(lowerInclusive && upperInclusive)) return { ok: false, reason: 'a single version must be in square brackets, as [1.0]' };
  const minText = parts[0]!;
  const maxText = parts.length === 2 ? parts[1]! : parts[0]!;
  const range: NuGetRange = {};
  if (minText.trim()) {
    const min = version(minText, 'minimum');
    if (!min.ok) return min;
    range.lower = { version: min.value, inclusive: lowerInclusive };
  }
  if (maxText.trim()) {
    const max = version(maxText, 'maximum');
    if (!max.ok) return max;
    range.upper = { version: max.value, inclusive: upperInclusive };
  }
  if (range.lower && range.upper) {
    const c = compareNuGet(range.lower.version, range.upper.version);
    if (c > 0) return { ok: false, reason: 'the minimum is above the maximum' };
    if (c === 0 && lowerInclusive !== upperInclusive) return { ok: false, reason: 'the minimum equals the maximum, so both ends must be inclusive, as [1.0]' };
  }
  return { ok: true, value: range };
}

/** NuGet's normalized range: `[1.0.0]` for one version, else `[min, max)` with an empty side open. */
function formatRange(range: NuGetRange): string {
  const { lower, upper } = range;
  if (lower && upper && lower.inclusive && upper.inclusive && compareNuGet(lower.version, upper.version) === 0) return `[${format(lower.version)}]`;
  return `${lower?.inclusive ? '[' : '('}${lower ? format(lower.version) : ''}, ${upper ? format(upper.version) : ''}${upper?.inclusive ? ']' : ')'}`;
}

function satisfies(range: NuGetRange, v: NuGetVersion): boolean {
  if (range.lower) {
    const c = compareNuGet(range.lower.version, v);
    if (range.lower.inclusive ? c > 0 : c >= 0) return false;
  }
  if (range.upper) {
    const c = compareNuGet(range.upper.version, v);
    if (range.upper.inclusive ? c < 0 : c <= 0) return false;
  }
  return true;
}

const intervals = (range: NuGetRange): Interval<NuGetVersion>[] => [{ ...(range.lower ? { lower: range.lower } : {}), ...(range.upper ? { upper: range.upper } : {}) }];

const inInterval = (interval: Interval<NuGetVersion>, v: NuGetVersion, _options: RangeOptions) => withinBounds(compareNuGet, interval, v);

const RELEASES: readonly Release[] = ['major', 'minor', 'patch'];

/** The next major, minor or patch: three parts, the revision and labels dropped. */
function bump(v: NuGetVersion, release: Release): Parsed<NuGetVersion> {
  const [major, minor, patch] = v.parts;
  const next: [number, number, number] = release === 'major' ? [major + 1, 0, 0] : release === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];
  if (next.some((n) => n > INT_MAX)) return { ok: false, reason: `the result is larger than ${INT_MAX}` };
  return { ok: true, value: { parts: [...next, 0], labels: [], metadata: '' } };
}

function diff(a: NuGetVersion, b: NuGetVersion): Difference | null {
  const names = ['major', 'minor', 'patch', 'revision'] as const;
  for (let i = 0; i < 4; i++) if (a.parts[i] !== b.parts[i]) return names[i]!;
  return compareLabels(a.labels, b.labels) === 0 ? null : 'prerelease';
}

export const nugetGrammar: VersionGrammar<NuGetVersion, NuGetRange> = {
  ecosystem: 'nuget',
  parse: parseVersion,
  format,
  compare: compareNuGet,
  parseRange,
  formatRange,
  satisfies,
  intervals,
  inInterval,
  releases: RELEASES,
  bump,
  diff,
};
