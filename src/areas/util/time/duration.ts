import { ToilError } from '../../../core/errors.js';

/**
 * ISO 8601 durations: `P1Y2M3W4DT5H6M7.5S`, with an optional leading sign
 * (ISO 8601-2, as Temporal reads them). Years and months have no fixed length
 * and days are 23 or 25 hours across a DST change, so only hours, minutes and
 * seconds convert to seconds exactly; the rest is said, not assumed. A month,
 * for these purposes, is a unit of time the calendar declines to define.
 */

export interface DurationParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface Duration {
  negative: boolean;
  parts: DurationParts;
}

export const UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
const DESIGNATORS: Record<(typeof UNITS)[number], string> = { years: 'Y', months: 'M', weeks: 'W', days: 'D', hours: 'H', minutes: 'M', seconds: 'S' };
const MS: Record<(typeof UNITS)[number], number> = { years: NaN, months: NaN, weeks: 7 * 86_400_000, days: 86_400_000, hours: 3_600_000, minutes: 60_000, seconds: 1000 };

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const DURATION = new RegExp(String.raw`^([+-])?P(?:${NUM}Y)?(?:${NUM}M)?(?:${NUM}W)?(?:${NUM}D)?(?:T(?:${NUM}H)?(?:${NUM}M)?(?:${NUM}S)?)?$`, 'i');

const FIX = 'Use an ISO 8601 duration: P1D, PT1H30M, P1Y2M10DT2H30M, PT0.5S or -PT15M. Only the last part may have a fraction.';

/** Reads an ISO 8601 duration, or INVALID_INPUT saying what's wrong with it. */
export function parseDuration(text: string): Duration {
  const trimmed = text.trim();
  const m = DURATION.exec(trimmed);
  const bad = (why: string) => new ToilError('INVALID_INPUT', `Duration "${text}" ${why}.`, { fix: FIX });
  if (!m) throw bad('is not an ISO 8601 duration');
  const raw = m.slice(2) as Array<string | undefined>;
  if (raw.every((r) => r === undefined)) throw bad('has no parts');
  if (/T$/i.test(trimmed)) throw bad('has a T with no hours, minutes or seconds after it');
  const last = raw.reduce((at, r, i) => (r === undefined ? at : i), -1);
  const parts = {} as DurationParts;
  UNITS.forEach((unit, i) => {
    const r = raw[i];
    if (r !== undefined && /[.,]/.test(r) && i !== last) throw bad(`has a fraction in its ${unit}, but only the last part may have one`);
    const value = r === undefined ? 0 : Number(r.replace(',', '.'));
    if (!Number.isSafeInteger(Math.floor(value))) throw bad(`has ${unit} too large to work with`);
    parts[unit] = value;
  });
  return { negative: m[1] === '-' && UNITS.some((u) => parts[u] !== 0), parts };
}

/** The canonical text of a duration: zero parts left out, `PT0S` for nothing. */
export function formatDuration(d: Duration): string {
  const date = (['years', 'months', 'weeks', 'days'] as const).filter((u) => d.parts[u]).map((u) => `${d.parts[u]}${DESIGNATORS[u]}`).join('');
  const time = (['hours', 'minutes', 'seconds'] as const).filter((u) => d.parts[u]).map((u) => `${d.parts[u]}${DESIGNATORS[u]}`).join('');
  const body = date || time ? `${date}${time ? `T${time}` : ''}` : 'T0S';
  return `${d.negative ? '-' : ''}P${body}`;
}

/**
 * The duration in milliseconds, with a day as 24 hours and a week as 7 days,
 * or null when it has years or months. `subMs` says a fraction went below a
 * millisecond and was rounded.
 */
export function durationMs(d: Duration): { ms: number | null; nominalDays: boolean; subMs: boolean } {
  if (d.parts.years || d.parts.months) return { ms: null, nominalDays: false, subMs: false };
  let total = 0;
  let subMs = false;
  for (const unit of ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const) {
    const exact = d.parts[unit] * MS[unit];
    const rounded = Math.round(exact);
    if (Math.abs(exact - rounded) > 1e-6) subMs = true;
    total += rounded;
  }
  return { ms: d.negative ? -total : total, nominalDays: d.parts.weeks !== 0 || d.parts.days !== 0, subMs };
}

/**
 * A length of time as an exact duration: hours, minutes and seconds only, so
 * `PT26H` rather than `P1DT2H`, since a day isn't always 24 hours. Milliseconds
 * are the finest unit.
 */
export function durationFromMs(totalMs: number): Duration {
  const abs = Math.abs(totalMs);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor(abs / 60_000) % 60;
  const seconds = (abs % 60_000) / 1000;
  return { negative: totalMs < 0, parts: { years: 0, months: 0, weeks: 0, days: 0, hours, minutes, seconds } };
}

/** `1 day, 2 hours and 30 minutes`; `0 seconds` for nothing. */
export function describeDuration(d: Duration): string {
  const words = UNITS.filter((u) => d.parts[u]).map((u) => `${d.parts[u]} ${d.parts[u] === 1 ? u.slice(0, -1) : u}`);
  if (!words.length) return '0 seconds';
  const list = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return d.negative ? `minus ${list}` : list;
}
