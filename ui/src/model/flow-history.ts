/**
 * The Flow dashboard's figures that the pivot model has no dimension for
 * (#567): a cumulative flow diagram, which needs each item's status category
 * on every week and not only today's, and the sentence that leads the page.
 * Both are worked out from the status history, one way, here, so the chart, its
 * doors and the headline in Where the work goes agree. An item whose history was
 * not read is in no week of the diagram (and the page says how many), and a
 * diagram with no history at all is not drawn: unknown is not zero (principle 12).
 * A cumulative flow diagram is a chart whose bands only widen, which has been
 * known to comfort the people who commissioned it.
 */

import { addDays, bucketStart, bucketsBetween, dayOf, type PivotAxisValue, type PivotCell, type PivotResult } from '../../../src/core/insights/index.ts';
import type { StatusCategory, WorkItem } from '../toil.ts';
import { dayWords, periodOf, type WorkInsights } from './work-insights.ts';

export const FLOW_CATEGORIES = ['DONE', 'IN_PROGRESS', 'TODO'] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];
const LABEL: Record<FlowCategory, string> = { DONE: 'Done', IN_PROGRESS: 'In progress', TODO: 'To do' };

/**
 * An item's status category at the end of a day, from its history: the last move on or before it. Before its first move it
 * was in the category that move left (to do, if none is named). Null when the item did not exist yet, or when its history
 * can't say (never read, or it has a status but no recorded moves).
 */
export function categoryAt(item: WorkItem, endOfDay: string): FlowCategory | null | 'unknown' {
  const created = item.created === null ? Number.NaN : Date.parse(item.created);
  if (!Number.isNaN(created) && created > Date.parse(endOfDay)) return null;
  if (!item.history) return 'unknown';
  const moves = [...item.history.transitions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (moves.length === 0) return item.statusCategory === 'TODO' ? 'TODO' : 'unknown';
  let at: StatusCategory = moves[0]!.fromCategory ?? 'TODO';
  for (const m of moves) {
    if (Date.parse(m.at) > Date.parse(endOfDay)) break;
    at = m.toCategory;
  }
  return at === 'DONE' || at === 'IN_PROGRESS' || at === 'TODO' ? at : 'TODO';
}

const endOf = (day: string) => `${day}T23:59:59.999Z`;

export interface Cfd {
  result: PivotResult;
  /** The last day each week counts to (today for the one still filling). */
  upTo: string[];
  /** Items whose status on some week could not be told, so they are in no band. */
  unknown: number;
}

/**
 * Items by status category at the end of each week of the period: done at the
 * bottom, then in progress, then to do. Null when no item's history was read.
 */
export function cfdOf(ins: WorkInsights, f: { from?: string; to?: string } = {}): Cfd | null {
  const period = periodOf(ins.today, f.from, f.to);
  const last = period.to > ins.today ? ins.today : period.to;
  const starts = bucketsBetween(period.from, last, 'week');
  const upTo = starts.map((s) => { const e = addDays(s, 6); return e < last ? e : last; });
  const unknownIds = new Set<string>();
  let anyKnown = false;
  const lists = starts.map((_, w) => {
    const by: Record<FlowCategory, string[]> = { DONE: [], IN_PROGRESS: [], TODO: [] };
    const end = upTo[w]! === ins.today ? ins.asOf : endOf(upTo[w]!);
    for (const item of ins.items) {
      const at = categoryAt(item, end);
      if (at === null) continue;
      if (at === 'unknown') {
        unknownIds.add(item.id);
        continue;
      }
      anyKnown = true;
      by[at].push(item.id);
    }
    return by;
  });
  if (!anyKnown) return null;
  const columns: PivotAxisValue[] = starts.map((s) => ({ key: `v:${s}`, label: dayWords(s), kind: 'value' }));
  const rows: PivotAxisValue[] = FLOW_CATEGORIES.map((c) => ({ key: `v:${c}`, label: LABEL[c], kind: 'value' }));
  const cells: PivotCell[][] = FLOW_CATEGORIES.map((c) => lists.map((by) => ({ value: by[c].length, items: by[c].sort(), measured: by[c].length, of: by[c].length })));
  const columnTotals: PivotCell[] = lists.map((by) => { const all = FLOW_CATEGORIES.flatMap((c) => by[c]).sort(); return { value: all.length, items: all, measured: all.length, of: all.length }; });
  const lastTotal = columnTotals.at(-1)!;
  const rowTotals: PivotCell[] = cells.map((row) => row.at(-1)!);
  const notes = unknownIds.size > 0 ? [`${unknownIds.size} ${unknownIds.size === 1 ? 'item has' : 'items have'} no recorded history of its status, so ${unknownIds.size === 1 ? 'it is' : 'they are'} in no band.`] : [];
  const result: PivotResult = {
    spec: { measure: 'items', split: 'statusCategory', across: 'created:week' }, asOf: ins.asOf, period: { from: period.from, to: last },
    measure: { id: 'items', unit: 'items', label: 'Items' },
    split: { spec: 'statusCategory', label: 'Status category', kind: 'single', read: true }, across: { spec: 'created:week', label: 'Week', kind: 'time', read: true },
    rows, columns, cells, rowTotals, columnTotals, total: lastTotal, allValues: [],
    coverage: { items: ins.items.length, measured: ins.items.length - unknownIds.size, unreadSplit: 0, unreadAcross: 0, parentsLeftOut: 0, multi: false, notes }, notable: [],
  };
  return { result, upTo, unknown: unknownIds.size };
}

/** The items in one status category at the end of a week of the diagram: what a click on a band opens. */
export function cfdSet(ins: WorkInsights, category: FlowCategory, weekStart: string): { ids: string[]; upTo: string } {
  const start = bucketStart(weekStart, 'week');
  const e = addDays(start, 6);
  const upTo = e < ins.today ? e : ins.today;
  const end = upTo === ins.today ? ins.asOf : endOf(upTo);
  return { ids: ins.items.filter((i) => categoryAt(i, end) === category).map((i) => i.id).sort(), upTo };
}

export const flowCategoryLabel = (c: FlowCategory): string => LABEL[c];

export interface FlowFigures {
  /** Items finished a week, on average over the complete weeks since the first item; null when nothing was finished. */
  perWeek: number | null;
  /** The weeks that average is over. */
  weeks: number;
  /** The median days from started to finished; null when the history wasn't read (or nothing finished in the period). */
  cycleDays: number | null;
  p85: number | null;
}

/** The two figures the Flow headline leads with, over the period. */
export function flowFigures(ins: WorkInsights, f: { from?: string; to?: string } = {}): FlowFigures {
  const period = periodOf(ins.today, f.from, f.to);
  const through = ins.run({ measure: 'throughput', across: 'resolved:week', ...period });
  const first = ins.earliest ? bucketStart(ins.earliest, 'week') : period.from;
  const full = through.columns.flatMap((c, i) => {
    const start = /^v:(\d{4}-\d{2}-\d{2})$/.exec(c.key)?.[1];
    if (!start || start < first || addDays(start, 6) >= (period.to < ins.today ? addDays(period.to, 1) : ins.today)) return [];
    return [through.columnTotals[i]!.value ?? 0];
  });
  const total = through.total.value ?? 0;
  const cycle = ins.run({ measure: 'cycleTime', ...period });
  return {
    perWeek: total === 0 || full.length === 0 ? null : Math.round(full.reduce((a, b) => a + b, 0) / full.length),
    weeks: full.length,
    cycleDays: cycle.total.value === null ? null : cycle.total.value,
    p85: cycle.total.p85 ?? null,
  };
}

const days = (n: number) => `${Math.round(n * 10) / 10} ${n === 1 ? 'day' : 'days'}`;

/** "About 9 finished a week, typically in 4.9 days"; the cycle clause is left out where the history wasn't read. Null when nothing finished. */
export function flowSentence(f: FlowFigures): string | null {
  if (f.perWeek === null) return null;
  return `About ${f.perWeek} finished a week${f.cycleDays === null ? '' : `, typically in ${days(f.cycleDays)}`}`;
}

/** A cell's `dayOf` for a key like `v:2026-07-27`, or null. */
export const dayOfKey = (key: string): string | null => dayOf(/^v:(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1] ?? null);
