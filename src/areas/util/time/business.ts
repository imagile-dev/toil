import { ToilError } from '../../../core/errors.js';
import { dateOfDay, dayNumber, formatDate, parseTime, weekdayOfDay } from './zone.js';

/**
 * Business days: Monday to Friday, less the holidays the caller lists. No
 * country's holidays are built in, and none are guessed: the list is the
 * dates given, which are the dates the office is shut (an observed Monday,
 * not the Sunday it stands in for). Whether the office agrees is between
 * the office and its calendar committee.
 */

/** Holidays by day number, with the name the list gave, if any. */
export type Holidays = Map<number, string | undefined>;

const LINE = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/;

/**
 * A holiday list: one `YYYY-MM-DD` per line, optionally followed by a name.
 * Blank lines and lines starting with `#` are skipped; any other line is
 * INVALID_INPUT naming it, never skipped quietly.
 */
export function addHolidayLine(holidays: Holidays, text: string, where: string): void {
  const line = text.trim();
  if (line === '' || line.startsWith('#')) return;
  const m = LINE.exec(line);
  const fix = 'Write one date per line as YYYY-MM-DD, optionally followed by a name: 2026-12-25 Christmas Day. Lines starting with # are comments.';
  if (!m) throw new ToilError('INVALID_INPUT', `${where} is not a holiday date: "${line.slice(0, 80)}".`, { fix });
  const parsed = parseTime(m[1]!, 0, where).value;
  // The pattern admits only a bare date, which always parses as one.
  if (parsed.kind !== 'date') throw new ToilError('INVALID_INPUT', `${where} is not a holiday date: "${line.slice(0, 80)}".`, { fix });
  holidays.set(dayNumber(parsed.wall), m[2]?.trim() || undefined);
}

export function isWeekend(day: number): boolean {
  const wd = weekdayOfDay(day);
  return wd === 0 || wd === 6;
}

export function isBusinessDay(day: number, holidays: Holidays): boolean {
  return !isWeekend(day) && !holidays.has(day);
}

/** The most business days one call moves: about 400 years. */
export const MAX_BUSINESS_DAYS = 100_000;

export interface Added {
  day: number;
  weekendDays: number;
  /** The holidays stepped over, in the order met. */
  holidays: number[];
}

/**
 * `start` plus `n` business days, as a spreadsheet's WORKDAY counts them: the
 * start itself never counts, each step lands on the next business day, and 0
 * returns the start as it is, business day or not.
 */
export function addBusinessDays(start: number, n: number, holidays: Holidays): Added {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let day = start;
  const out: Added = { day, weekendDays: 0, holidays: [] };
  const lastDay = dayNumber({ year: 9999, month: 12, day: 31 });
  const firstDay = dayNumber({ year: 1, month: 1, day: 1 });
  while (remaining > 0) {
    day += step;
    if (day > lastDay || day < firstDay) {
      throw new ToilError('INVALID_INPUT', `Adding ${n} business days goes past the years 0001 to 9999.`, { fix: 'Use a smaller number of days.' });
    }
    if (isWeekend(day)) out.weekendDays++;
    else if (holidays.has(day)) out.holidays.push(day);
    else remaining--;
  }
  out.day = day;
  return out;
}

/**
 * The business days a walk from `from` to `to` steps onto, counted afresh
 * day by day: after `from` up to and including `to` going forward, and from
 * `to` up to but not including `from` going back, as {@link addBusinessDays}
 * steps.
 */
export function countBusinessDays(from: number, to: number, holidays: Holidays): number {
  const [first, last] = from <= to ? [from + 1, to] : [to, from - 1];
  let count = 0;
  for (let day = first; day <= last; day++) if (isBusinessDay(day, holidays)) count++;
  return count;
}

export const showDay = (day: number) => formatDate(dateOfDay(day));
