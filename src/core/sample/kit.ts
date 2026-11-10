/**
 * What every part of the sample team shares: a seeded generator of random
 * numbers, and the calendar. Both are pure. There is no clock in this folder,
 * so every date is an offset from the day the caller names, and the same day
 * in gives the same bytes out. Randomness is permitted here in the sense that
 * the committee that approves randomness has approved exactly one seed.
 *
 * The calendar counts working days from a virtual Tuesday, the day the
 * sample's current sprint is on its seventh working day of ten. A working day
 * is mapped to a calendar offset by skipping a virtual weekend, which is
 * exact when the day asked for is a Tuesday and shifts weekend work onto
 * another weekday when it is not. Dates move together: asking for a day a
 * whole number of weeks later moves every date by exactly those days.
 */

/** The only seed. A sample that changes between runs would make every screenshot of it a different team. */
export const SEED = 0x5a3c1e;

/** A small generator (mulberry32): the same seed gives the same sequence on every Node. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for one thing, by number, so adding an item never changes the dice of another. */
export const rngFor = (n: number, salt = 0): (() => number) => rng((SEED ^ Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);

/** A whole number from `low` to `high`, both included. */
export const between = (next: () => number, low: number, high: number): number => low + Math.floor(next() * (high - low + 1));

/** One of the choices. */
export const pick = <T>(next: () => number, choices: readonly T[]): T => choices[Math.floor(next() * choices.length)]!;

/** Milliseconds in a day. */
export const DAYS = 86_400_000;
const DAY = DAYS;

/** The UTC midnight that starts the day of `asOf`, in milliseconds. */
export function dayStart(asOf: string): number {
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) throw new RangeError(`"${asOf}" isn't a date-time.`);
  return Math.floor(ms / DAY) * DAY;
}

/**
 * Calendar days from the sample's today to working day `n`, where 0 is today
 * and, from a Tuesday, -1 is Monday, -2 the Friday before and +1 Wednesday.
 */
export function offsetOf(n: number): number {
  const position = 1 + n;
  const weeks = Math.floor(position / 5);
  return weeks * 7 + (position - weeks * 5) - 1;
}

/** A moment on working day `n` at `hour` and `minute`, UTC, as an ISO string. Today's moments stop at 07:59: the sample's now is 08:00. */
export function at(base: number, n: number, hour = 9, minute = 0): string {
  const h = n === 0 ? Math.min(hour, 7) : hour;
  return new Date(base + offsetOf(n) * DAY + h * 3_600_000 + minute * 60_000).toISOString();
}

/** A calendar date, YYYY-MM-DD, a number of calendar days from today. */
export const dayAt = (base: number, calendarDays: number): string => new Date(base + calendarDays * DAY).toISOString().slice(0, 10);

/** Jira's date-time: `2026-11-02T10:15:00.000+0000`. */
export const jiraTime = (iso: string): string => iso.replace('Z', '+0000');
