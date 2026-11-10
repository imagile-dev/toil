/**
 * Where the team is working (#567): days in progress by week for each epic (or
 * any other grouping), how many epics had work going each week, and how much
 * of the backlog has no epic above it. The pivot model counts an item's
 * days inside a period, so a weekly column is one pivot run over that week;
 * `stitchColumns` joins the weeks into the table the heatmap draws. When no
 * status history was read there are no days to count, and the answer is "not
 * read yet", never a table of zeros (principle 12). Parallel streams here mean
 * epics with work in progress, which is the one kind of parallelism that has
 * never once been scheduled on purpose.
 */

import { addDays, bucketStart, bucketsBetween, NONE_KEY, type Filter, type PivotResult } from '../../../src/core/insights/index.ts';
import { stitchColumns, type StitchPart } from './stitch.ts';
import { dayWords, isPeopleDimension, periodOf, type WorkInsights } from './work-insights.ts';

/** The epic level of the parent chain, the grouping the page starts with. */
export const EPIC = 'parent:Epic';

export interface WeekPart extends StitchPart {
  start: string;
  /** The last day the week counts to (today for the one still filling). */
  end: string;
}

/** The weeks of the period, each as the pivot run over that week's days with `split` as the rows. Null when no item's history was read. */
/**
 * Filters go in the pivot's own `where`, never in a narrowed copy of the items: a person-day is shared out across everything
 * a person had open that day, so taking items away from the input would change the days of the ones that stay.
 */
export interface WhereOptions {
  from?: string;
  to?: string;
  where?: Filter[];
  top?: number;
}

export function weekParts(ins: WorkInsights, split: string, f: WhereOptions = {}): WeekPart[] | null {
  const period = periodOf(ins.today, f.from, f.to);
  const last = period.to > ins.today ? ins.today : period.to;
  const parts = bucketsBetween(period.from, last, 'week').map((start): WeekPart => {
    const from = start < period.from ? period.from : start;
    const e = addDays(start, 6);
    const end = e < last ? e : last;
    return { key: `v:${start}`, label: dayWords(start), start, end, result: ins.run({ measure: 'days', split, top: 0, from, to: end, ...(f.where && f.where.length > 0 ? { where: f.where } : {}) }) };
  });
  return parts.length === 0 || parts.every((p) => p.result.total.value === null) ? null : parts;
}

/** Days in progress by week for each value of `split`: the heatmap's table. Null when the status history wasn't read. */
export function whereResult(ins: WorkInsights, split: string, f: WhereOptions = {}): PivotResult | null {
  const parts = weekParts(ins, split, f);
  if (!parts) return null;
  const period = periodOf(ins.today, f.from, f.to);
  return stitchColumns(parts, { spec: { measure: 'days', split, across: 'started:week', from: period.from, to: period.to, ...(f.where && f.where.length > 0 ? { where: f.where } : {}) }, top: f.top ?? 8, byName: isPeopleDimension(split) });
}

export interface Streams {
  /** Epics with work in progress each week, oldest first. */
  weeks: Array<{ start: string; label: string; count: number }>;
  /** The latest week's number and the one before it; the previous is null when there is no earlier week. */
  current: number;
  previous: number | null;
  /** The epics that had work this week, by name. */
  names: string[];
}

/** How many epics had work in progress each week. Null when no history was read, or no item sits under an epic. */
export function streamsOf(ins: WorkInsights, f: WhereOptions = {}): Streams | null {
  const parts = weekParts(ins, EPIC, f);
  if (!parts) return null;
  const real = (p: WeekPart) => p.result.rows.flatMap((r, i) => (r.kind === 'value' && (p.result.rowTotals[i]!.value ?? 0) > 0 ? [r.label] : []));
  const weeks = parts.map((p) => ({ start: p.start, label: p.label, count: real(p).length }));
  const read = parts.some((p) => p.result.rows.some((r) => r.kind === 'value'));
  if (!read) return null;
  return { weeks, current: weeks.at(-1)!.count, previous: weeks.length > 1 ? weeks.at(-2)!.count : null, names: real(parts.at(-1)!).sort() };
}

export interface NoEpic {
  /** Items with no epic above them, and every item that could have one (epics and initiatives themselves are not counted). */
  none: number;
  of: number;
  share: number;
  /** The pivot a door opens: the items in the "no epic" bucket. */
  spec: { measure: 'items'; split: string; top: number; where?: Filter[] };
  row: string;
}

/** The share of work with no epic above it. Null when the parent chains weren't read, or there is no work to count. */
export function noEpicOf(ins: WorkInsights, where: Filter[] = []): NoEpic | null {
  const spec = { measure: 'items' as const, split: EPIC, top: 0, ...(where.length > 0 ? { where } : {}) };
  const r = ins.run(spec);
  if (!r.split?.read) return null;
  const at = r.rows.findIndex((x) => x.key === NONE_KEY);
  const of = r.total.items.length;
  if (of === 0) return null;
  const none = at < 0 ? 0 : r.rowTotals[at]!.items.length;
  return { none, of, share: none / of, spec, row: NONE_KEY };
}

/** "Work this week is spread across 4 epics; 19 of 136 items (14%) have no epic above them." Null where neither could be worked out. */
export function whereSentence(streams: Streams | null, none: NoEpic | null): string | null {
  const spread = streams ? `Work this week is spread across ${streams.current} ${streams.current === 1 ? 'epic' : 'epics'}` : null;
  const lack = none ? `${none.none} of ${none.of} items (${Math.round(none.share * 100)}%) have no epic above them` : null;
  if (spread && lack) return `${spread}; ${lack}.`;
  if (spread) return `${spread}.`;
  return lack ? `${lack.charAt(0).toUpperCase()}${lack.slice(1)}.` : null;
}

/** Each row of a result with the items behind it, for the mix beside the heatmap: the row's own items, whichever week they were in. */
export function rowItems(result: PivotResult): Array<{ key: string; label: string; kind: string; ids: string[] }> {
  return result.rows.map((r, i) => ({ key: r.key, label: r.label, kind: r.kind, ids: result.rowTotals[i]!.items }));
}

/** The Monday a week-column key names, or null. */
export const weekOfKey = (key: string): string | null => {
  const day = /^v:(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1];
  return day ? bucketStart(day, 'week') : null;
};
