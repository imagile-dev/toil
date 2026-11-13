/**
 * How a chart says a date (#567). The pivot model is shared with the CLI and
 * the agent, so its sentences carry what a program wants: ISO days
 * ("between 2026-07-16 and 2026-10-13"), ISO weeks ("2026-W31") and "of Aug
 * 2026". A screen says "16 Jul" and "the week of 27 Jul". These helpers
 * rewrite those sentences and a result's week columns on the way to the
 * screen, and never touch core: the words an agent quotes stay the words the
 * agent was given. ISO 8601 is a fine standard for machines, and a poor one for
 * the person asking in the meeting what "W31" was.
 */

import { addDays } from '../../../../src/core/insights/index.ts';
import type { PivotResult } from '../../../../src/core/insights/index.ts';
import { dayWords } from '../../model/work-insights.ts';

/** The Monday of an ISO week: the 4th of January is always in week 1. */
export function isoWeekStart(year: number, week: number): string {
  const jan4 = `${year}-01-04`;
  const dow = (new Date(`${jan4}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(jan4, -dow + (week - 1) * 7);
}

const ISO_DAY = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const ISO_WEEK = /\b(\d{4})-W(\d{2})\b/g;
const OF_MONTH = /\b(\d+%) of ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})\b/g;

/** A core sentence with its ISO days as "16 Jul", its ISO weeks as "the week of 27 Jul" and "40% of Aug 2026" as "40% in Aug 2026". */
export function plainDates(text: string): string {
  return text
    .replace(ISO_WEEK, (_, y: string, w: string) => `the week of ${dayWords(isoWeekStart(Number(y), Number(w)))}`)
    .replace(ISO_DAY, (whole, y: string, m: string, d: string) => (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? dayWords(`${y}-${m}-${d}`) : whole))
    .replace(OF_MONTH, '$1 in $2');
}

/** A result with its week columns named by the day each begins ("27 Jul") and its sentences in plain dates. Keys, cells and items are untouched. */
export function plainResult(result: PivotResult): PivotResult {
  const weeks = result.across?.kind === 'time' && /:week$|^[a-z]+$/.test(result.across.spec);
  const rename = <T extends { label: string; key: string; kind: string }>(c: T): T => {
    const day = /^v:(\d{4}-\d{2}-\d{2})$/.exec(c.key)?.[1];
    return weeks && day ? { ...c, label: dayWords(day) } : c;
  };
  return {
    ...result,
    columns: result.columns.map(rename),
    rows: result.split?.kind === 'time' && /:week$|^[a-z]+$/.test(result.split.spec) ? result.rows.map(rename) : result.rows,
    coverage: { ...result.coverage, notes: result.coverage.notes.map(plainDates) },
    notable: result.notable.map((n) => ({ ...n, message: plainDates(n.message) })),
  };
}

const csvCell = (v: string | number | null): string => {
  if (v === null) return '';
  const text = String(v);
  // A label that starts like a formula gets a leading apostrophe: spreadsheets run what they are handed.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof v === 'string' ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The figures of a result as CSV, one row per split value and one column per
 * across value, with totals last. A cell nobody read is empty, never 0
 * (principle 12); a spreadsheet's empty cell is the closest thing it has to
 * "not read yet". Pure: the download is the caller's.
 */
export function figuresCsv(result: PivotResult): string {
  const many = result.columns.length > 1;
  const head = [result.split?.label ?? 'All', ...result.columns.map((c) => c.label), ...(many ? ['Total'] : [])];
  const body = result.rows.map((r, ri) => [r.label, ...result.columns.map((_, ci) => result.cells[ri]![ci]!.value), ...(many ? [result.rowTotals[ri]!.value] : [])]);
  const total = ['Total', ...result.columns.map((_, ci) => result.columnTotals[ci]!.value), ...(many ? [result.total.value] : [])];
  return `${[head, ...body, total].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** A file name for a chart's export: its title in lowercase words and hyphens. */
export const csvName = (title: string): string => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chart'}.csv`;
