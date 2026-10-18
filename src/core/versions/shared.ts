import type { Bound, Interval } from '../versions.js';

/**
 * Pieces the grammars share: ordering digit strings of any length, and
 * testing a version against an interval's bounds. A digit string compared by
 * length and then character by character orders correctly at any size, so
 * no identifier has to fit in a double to be compared as a number. Build
 * numbers grow faster than headcount, and someone has to keep up.
 */

/** Two digit strings without leading zeros, compared as numbers of any size. */
export function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordinal comparison by UTF-16 code unit, as Java's and .NET's ordinal string comparers do. */
export function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Whether `version` is inside the interval's bounds, by `compare` alone. */
export function withinBounds<V>(compare: (a: V, b: V) => number, interval: Interval<V>, version: V): boolean {
  const { lower, upper } = interval;
  if (lower) {
    const c = compare(version, lower.version);
    if (c < 0 || (c === 0 && !lower.inclusive)) return false;
  }
  if (upper) {
    const c = compare(version, upper.version);
    if (c > 0 || (c === 0 && !upper.inclusive)) return false;
  }
  return true;
}

/** The tighter of two bounds on one side: the higher lower bound, or the lower upper bound, and the exclusive one of two at the same version. */
export function tighten<V>(compare: (a: V, b: V) => number, current: Bound<V> | undefined, next: Bound<V>, side: 'lower' | 'upper'): Bound<V> {
  if (!current) return next;
  const c = compare(next.version, current.version);
  if (c === 0) return current.inclusive && !next.inclusive ? next : current;
  return (side === 'lower' ? c > 0 : c < 0) ? next : current;
}
