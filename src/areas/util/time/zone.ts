import { ToilError } from '../../../core/errors.js';

/**
 * Time zones from the runtime's own Intl data, with no zone database bundled:
 * Node ships the IANA data in ICU, and `Intl.DateTimeFormat` reads it. Two
 * operations underpin everything in `util time`: the wall clock a zone shows
 * at an instant, and the instants at which a zone shows a given wall clock.
 * The second has zero answers in a spring-forward gap and two in a fall-back
 * overlap, and this module says so rather than picking one quietly. A clock
 * that goes back an hour is, administratively, an hour that happened twice
 * and was minuted once.
 *
 * Every function takes the instant it works on; nothing here reads the clock.
 */

export const MS_PER_DAY = 86_400_000;

/** A wall-clock reading: what a zone's clocks show. Months 1 to 12. */
export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** How a wall clock maps onto instants in a zone. */
export type Resolution =
  /** Exactly one instant shows it. */
  | { kind: 'unique'; instant: number }
  /** None does: the clocks skipped it. `instant` is where the clocks were after the jump (the time moved forward by `gapSeconds`), as most schedulers and Temporal's "compatible" choose. */
  | { kind: 'gap'; instant: number; gapSeconds: number; offsetBefore: number; offsetAfter: number }
  /** Two do: the clocks showed it twice. `instant` is the earlier one, `later` the second. */
  | { kind: 'overlap'; instant: number; later: number; offsetEarlier: number; offsetLater: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, found);
  }
  return found;
}

/**
 * The zone's canonical name as the runtime knows it (`utc` becomes `UTC`,
 * `US/Eastern` stays the alias ICU reports), or INVALID_INPUT naming it.
 */
export function checkZone(zone: string, field = 'zone'): string {
  try {
    return formatter(zone).resolvedOptions().timeZone;
  } catch {
    throw new ToilError('INVALID_INPUT', `Unknown time zone for ${field}: "${zone}".`, {
      fix: 'Use an IANA zone name such as America/New_York, Europe/London or UTC. The names come from the time zone data Node ships.',
    });
  }
}

/** The instant a wall clock would be if it were UTC. Handles years below 100, which Date.UTC maps into the 1900s. */
export function utcOf(wall: Wall): number {
  const d = new Date(0);
  d.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  d.setUTCHours(wall.hour, wall.minute, wall.second, wall.ms);
  return d.getTime();
}

/** The UTC wall clock of an instant. */
export function utcWall(instant: number): Wall {
  const d = new Date(instant);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), ms: d.getUTCMilliseconds() };
}

/** What the zone's clocks show at `instant`. */
export function wallAt(instant: number, zone: string): Wall {
  const ms = ((instant % 1000) + 1000) % 1000;
  const parts = formatter(zone).formatToParts(new Date(instant - ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second'), ms };
}

/** The zone's offset from UTC at `instant`, in seconds (east positive). */
export function offsetAt(instant: number, zone: string): number {
  return Math.round((utcOf(wallAt(instant, zone)) - instant) / 1000);
}

export function sameWall(a: Wall, b: Wall): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second && a.ms === b.ms;
}

/**
 * The instants at which `zone` shows `wall`. The candidates are the wall
 * clock taken at each offset the zone has within a day either side; a
 * candidate counts only if the zone really shows that wall clock then. Zones
 * that change offset twice inside two days don't exist in the data Node ships.
 */
export function resolveWall(wall: Wall, zone: string): Resolution {
  const local = utcOf(wall);
  const before = offsetAt(local - MS_PER_DAY, zone);
  const after = offsetAt(local + MS_PER_DAY, zone);
  const offsets = new Set([before, offsetAt(local, zone), after]);
  const hits = [...new Set([...offsets].map((o) => local - o * 1000))].filter((t) => sameWall(wallAt(t, zone), wall)).sort((a, b) => a - b);
  if (hits.length === 1) return { kind: 'unique', instant: hits[0]! };
  if (hits.length >= 2) return { kind: 'overlap', instant: hits[0]!, later: hits[hits.length - 1]!, offsetEarlier: offsetAt(hits[0]!, zone), offsetLater: offsetAt(hits[hits.length - 1]!, zone) };
  return { kind: 'gap', instant: local - before * 1000, gapSeconds: after - before, offsetBefore: before, offsetAfter: after };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `+05:30`, `-04:00`, `+00:00`; `-04:56:02` for an offset with seconds (local mean time before 1900). */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const s = abs % 60;
  return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor(abs / 60) % 60)}${s ? `:${pad(s)}` : ''}`;
}

/** `2026-03-08T02:30:00`, with `.250` when there are milliseconds. */
export function formatWall(wall: Wall): string {
  const ms = wall.ms ? `.${pad(wall.ms, 3)}` : '';
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${ms}`;
}

export function formatDate(wall: Pick<Wall, 'year' | 'month' | 'day'>): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** An instant in UTC, `Z` form. */
export function formatInstant(instant: number): string {
  return `${formatWall(utcWall(instant))}Z`;
}

/** An instant as the zone shows it, with its offset: `2026-03-08T03:30:00-04:00`. */
export function formatLocal(instant: number, zone: string): { local: string; wall: Wall; offset: string; offsetSeconds: number } {
  const wall = wallAt(instant, zone);
  const offsetSeconds = Math.round((utcOf(wall) - instant) / 1000);
  const offset = formatOffset(offsetSeconds);
  return { local: `${formatWall(wall)}${offset}`, wall, offset, offsetSeconds };
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return utcWall(utcOf({ year, month: month + 1, day: 0, hour: 0, minute: 0, second: 0, ms: 0 })).day;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days since 1970-01-01 of a calendar date, proleptic Gregorian. */
export function dayNumber(date: Pick<Wall, 'year' | 'month' | 'day'>): number {
  return Math.round(utcOf({ ...date, hour: 0, minute: 0, second: 0, ms: 0 }) / MS_PER_DAY);
}

export function dateOfDay(day: number): { year: number; month: number; day: number } {
  const w = utcWall(day * MS_PER_DAY);
  return { year: w.year, month: w.month, day: w.day };
}

/** 0 for Sunday to 6 for Saturday. 1970-01-01 was a Thursday. */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** What a time argument said. */
export type TimeValue =
  /** An instant: `Z`, an offset, `@<epoch seconds>` or `now`. */
  | { kind: 'instant'; instant: number; offsetSeconds?: number }
  /** A wall clock with no offset, which needs a zone to mean an instant. */
  | { kind: 'wall'; wall: Wall }
  /** A calendar date alone. */
  | { kind: 'date'; wall: Wall };

const TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?)?$/;
const EPOCH = /^@(-?\d{1,14})(?:\.(\d{1,3}))?$/;

const TIME_FIX = 'Use ISO 8601: 2026-03-08, 2026-03-08T02:30, 2026-03-08T02:30:00Z or 2026-03-08T02:30:00-05:00. @1760000000 is epoch seconds, and now is the current time.';

/** Whether a time had digits below a millisecond, which were dropped. */
export interface Parsed {
  value: TimeValue;
  truncated: boolean;
}

/**
 * Reads one time argument. `now` is the caller's clock reading, taken once
 * per call, so every use of `now` in one call is the same instant. Fields out
 * of range (Feb 30, 24:00, a leap second) are INVALID_INPUT, never rolled over.
 */
export function parseTime(text: string, now: number, field: string): Parsed {
  const bad = (why: string) => new ToilError('INVALID_INPUT', `${field} "${text}" ${why}.`, { fix: TIME_FIX });
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === 'now') return { value: { kind: 'instant', instant: now }, truncated: false };
  const epoch = EPOCH.exec(trimmed);
  if (epoch) {
    const seconds = Number(epoch[1]);
    const ms = Number((epoch[2] ?? '').padEnd(3, '0'));
    const instant = seconds * 1000 + (trimmed.startsWith('@-') ? -ms : ms);
    const year = utcWall(instant).year;
    if (!(year >= 1 && year <= 9999)) throw bad('is outside the years 0001 to 9999');
    return { value: { kind: 'instant', instant }, truncated: false };
  }
  const m = TIME.exec(trimmed);
  if (!m) throw bad('is not a time toil can read');
  const [, y, mo, d, h, mi, s, frac, off] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1) throw bad('has year 0000; the earliest year is 0001');
  if (month < 1 || month > 12) throw bad(`has month ${mo}`);
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) throw bad(`has day ${d}, but ${formatDate({ year, month, day: 1 }).slice(0, 7)} has ${dim} days`);
  const wall: Wall = { year, month, day, hour: 0, minute: 0, second: 0, ms: 0 };
  if (h === undefined) return { value: { kind: 'date', wall }, truncated: false };
  wall.hour = Number(h);
  wall.minute = Number(mi);
  wall.second = Number(s ?? 0);
  if (wall.hour > 23) throw bad(`has hour ${h}; hours run 00 to 23`);
  if (wall.minute > 59) throw bad(`has minute ${mi}`);
  if (wall.second > 59) throw bad(`has second ${s}; leap seconds can't be represented, since JavaScript time has none`);
  const digits = frac ?? '';
  wall.ms = Number(digits.slice(0, 3).padEnd(3, '0'));
  const truncated = /[1-9]/.test(digits.slice(3));
  if (off === undefined) return { value: { kind: 'wall', wall }, truncated };
  let offsetSeconds = 0;
  if (off !== 'Z' && off !== 'z') {
    const digitsOnly = off.slice(1).replace(/:/g, '');
    const oh = Number(digitsOnly.slice(0, 2));
    const om = Number(digitsOnly.slice(2, 4) || 0);
    const os = Number(digitsOnly.slice(4, 6) || 0);
    if (oh > 23 || om > 59 || os > 59) throw bad(`has offset ${off}`);
    offsetSeconds = (off.startsWith('-') ? -1 : 1) * (oh * 3600 + om * 60 + os);
  }
  return { value: { kind: 'instant', instant: utcOf(wall) - offsetSeconds * 1000, offsetSeconds }, truncated };
}
