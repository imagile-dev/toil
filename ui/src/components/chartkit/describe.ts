/**
 * What a mark says. The same sentence is a tooltip's text and the mark's
 * accessible name, built here from a pivot result and nothing else, so a test
 * can hold it:
 *
 *  - `axisName(value)`   "Keep the lights on (KTLO)": the label, then the
 *    scheme's short form when it has one. A mark's own name ("Riveted iron
 *    plate") is never here: it belongs to theme authors.
 *  - `cellText(result, row, column, mode)`  "Keep the lights on (KTLO), 4.2: 24
 *    items, 36% of 4.2 (12 of 14 have an estimate)". A null cell says "not read
 *    yet" and its reason, never a number.
 *  - `seriesText(result, row)`   a legend swatch's: the name, then its total
 *    across the chart.
 *  - `columnText(result, column)` a column's total, for a chip or a dash marker.
 *
 * An unread figure is null, and null is never 0 (principle 12).
 * The sentence is filed in the margin, where the legend used to be.
 */

import { ALL_KEY, type PivotAxisValue, type PivotCell, type PivotResult } from '../../../../src/core/insights/types.ts';
import { STANDARD } from '../../wording.ts';

export const NOT_READ_YET = STANDARD['chart.notRead'];

export type ChartMode = 'count' | 'share';

const UNITS: Record<string, [string, string]> = {
  items: ['item', 'items'],
  points: ['point', 'points'],
  hours: ['hour', 'hours'],
  days: ['day', 'days'],
  'person-days': ['person-day', 'person-days'],
};

/** A number as people read it: whole where it is whole, else one decimal. */
export const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

export const percent = (share: number): string => `${Math.round(share * 100)}%`;

export function axisName(v: Pick<PivotAxisValue, 'label' | 'short'>): string {
  return v.short && v.short !== v.label ? `${v.label} (${v.short})` : v.label;
}

/** "24 items", "1 item", "6 points". */
export function quantity(result: Pick<PivotResult, 'measure'>, n: number): string {
  const [one, many] = UNITS[result.measure.unit] ?? [result.measure.unit, result.measure.unit];
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** What the measure needs an item to have, for "12 of 14 have an estimate". */
const NEEDS: Record<string, string> = { estimate: 'an estimate', days: 'a history', cycleTime: 'a history', aging: 'a history' };

/** The cell's share of its column: the pivot's own when it has one, else worked out from the column's total (null when that is unknown or zero). */
export function shareOf(result: PivotResult, row: number, column: number): number | null {
  const cell = result.cells[row]?.[column];
  if (!cell || cell.value === null) return null;
  if (cell.share !== undefined) return cell.share;
  const total = result.columnTotals[column]?.value;
  return total ? cell.value / total : null;
}

/** "(12 of 14 have an estimate)" where the measure could read only some of a cell's items. */
export function coverageText(result: Pick<PivotResult, 'measure'>, cell: Pick<PivotCell, 'measured' | 'of'>): string | null {
  if (cell.of <= 0 || cell.measured >= cell.of) return null;
  return `${cell.measured} of ${cell.of} have ${NEEDS[result.measure.id] ?? 'a value'}`;
}

export function cellText(result: PivotResult, row: number, column: number): string {
  const r = result.rows[row];
  const c = result.columns[column];
  const cell = result.cells[row]?.[column];
  if (!r || !c || !cell) return '';
  const name = result.columns.length > 1 || c.key !== ALL_KEY ? `${axisName(r)}, ${axisName(c)}` : axisName(r);
  if (cell.value === null) return `${name}: ${NOT_READ_YET}${cell.reason ? ` (${cell.reason})` : ''}`;
  const share = shareOf(result, row, column);
  const of = c.key === ALL_KEY ? 'all' : axisName(c);
  const figure = share === null ? quantity(result, cell.value) : `${quantity(result, cell.value)}, ${percent(share)} of ${of}`;
  const cov = coverageText(result, cell);
  return `${name}: ${figure}${cov ? ` (${cov})` : ''}`;
}

/** A legend swatch's tooltip: the series' name and its total across the chart. */
export function seriesText(result: PivotResult, row: number): string {
  const r = result.rows[row];
  const total = result.rowTotals[row];
  if (!r || !total) return '';
  return total.value === null ? `${axisName(r)}: ${NOT_READ_YET}` : `${axisName(r)}: ${quantity(result, total.value)} in all`;
}

/** A column's tooltip: its name and its total. */
export function columnText(result: PivotResult, column: number): string {
  const c = result.columns[column];
  const total = result.columnTotals[column];
  if (!c || !total) return '';
  return total.value === null ? `${axisName(c)}: ${NOT_READ_YET}` : `${axisName(c)}: ${quantity(result, total.value)} in all`;
}

/** The column's rows that nobody read, by name, for the dash that stands in for them. */
export function unreadRows(result: PivotResult, column: number): PivotAxisValue[] {
  return result.rows.filter((_, i) => result.cells[i]?.[column]?.value === null);
}
