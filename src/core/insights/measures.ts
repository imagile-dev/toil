/**
 * Measures (#567): one figure for a set of items, with how many of them it
 * could read. A measure that needs data (estimate, days, cycle time, aging) is
 * `null` when it read nothing, never 0 (principle 12); one that is a count
 * (items, throughput, work in progress) is a real count, so 0 is 0. Person-days
 * split a person's working day across what they had open, which is the nearest
 * a status history comes to the timesheet nobody filled in.
 */

import type { EstimateUnit, WorkItem } from '../owi/types.js';
import { calendarDays, DAY } from '../brief/time.js';
import { addDays, dayMs, dayOf, startedAt } from './dimensions.js';
import type { MeasureId, MeasureUnit } from './types.js';

export interface MeasureContext {
  asOf: string;
  period: { from: string; to: string };
  /** The unit `estimate` adds up in; `estimateUnit` of the whole input picks it. */
  unit: EstimateUnit;
  /** Person-days by OWI id, from `personDays` over the whole input. Missing ids are unmeasured. */
  days: ReadonlyMap<string, number | null>;
}

export interface MeasureCell {
  value: number | null;
  p85?: number | null;
  /** How many of `of` the measure could read. */
  measured: number;
  /** How many items the measure applies to (for cycle time and aging, the finished or open ones among the cell's). */
  of: number;
  reason?: string;
}

export const MEASURE_LABEL: Record<MeasureId, string> = {
  items: 'Items', estimate: 'Estimate', days: 'Days in progress', throughput: 'Items finished', cycleTime: 'Cycle time', wip: 'Work in progress', aging: 'Age of work in progress',
};

export function measureUnit(measure: MeasureId, unit: EstimateUnit): MeasureUnit {
  switch (measure) {
    case 'estimate': return unit;
    case 'days': return 'person-days';
    case 'cycleTime': case 'aging': return 'days';
    default: return 'items';
  }
}

/** The estimate unit most items use (ties go to points, then hours); items in the others are left out and counted. */
export function estimateUnit(items: WorkItem[]): EstimateUnit {
  const n: Record<EstimateUnit, number> = { points: 0, hours: 0, days: 0 };
  for (const i of items) if (i.estimate) n[i.estimate.unit]++;
  return (['points', 'hours', 'days'] as const).reduce((best, u) => (n[u] > n[best] ? u : best), 'points' as EstimateUnit);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nearest-rank percentile (0 to 1) of values already sorted ascending. */
export function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Person-days ------------------------------------------------------------------

/** The days (UTC day numbers) an item was IN_PROGRESS inside the period, Monday to Friday; null when its history can't say. */
function workingDaysInProgress(item: WorkItem, period: { from: string; to: string }, asOf: string): number[] | null {
  if (item.history === null) return null;
  const moves = [...item.history.transitions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (item.statusCategory === 'IN_PROGRESS' && startedAt(item) === null) return null; // In progress now, but the history never saw it start.
  const lo = dayMs(period.from);
  const hi = Math.min(dayMs(addDays(period.to, 1)), Date.parse(asOf));
  const intervals: Array<[number, number]> = [];
  let since: number | null = null;
  for (const t of moves) {
    const at = Date.parse(t.at);
    if (t.toCategory === 'IN_PROGRESS' && since === null) since = at;
    else if (t.toCategory !== 'IN_PROGRESS' && since !== null) { intervals.push([since, at]); since = null; }
  }
  if (since !== null) intervals.push([since, Date.parse(asOf)]);
  const days = new Set<number>();
  for (const [a, b] of intervals) {
    const start = Math.max(a, lo);
    const end = Math.min(b, hi);
    if (end <= start) continue;
    for (let d = Math.floor(start / DAY); d * DAY < end; d++) {
      const dow = new Date(d * DAY).getUTCDay();
      if (dow !== 0 && dow !== 6) days.add(d);
    }
  }
  return [...days];
}

/**
 * Person-days per item over the period. A person is the item's current
 * assignee (history keeps no assignee), and an item with nobody on it counts
 * as its own person. Each working day, a person's one day is split evenly
 * across the items they had in progress. An item whose history was not read
 * gets null: unmeasured, not zero.
 */
export function personDays(items: WorkItem[], period: { from: string; to: string }, asOf: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const byPersonDay = new Map<string, string[]>();
  for (const item of items) {
    const days = workingDaysInProgress(item, period, asOf);
    out.set(item.id, days === null ? null : 0);
    const person = item.assignee?.id ?? `item:${item.id}`;
    for (const d of days ?? []) {
      const k = `${person}\u0000${d}`;
      byPersonDay.set(k, [...(byPersonDay.get(k) ?? []), item.id]);
    }
  }
  for (const ids of byPersonDay.values()) for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1 / ids.length);
  return out;
}

// Per measure ------------------------------------------------------------------

const resolvedInPeriod = (i: WorkItem, ctx: MeasureContext) => {
  const day = dayOf(i.resolved);
  return i.statusCategory === 'DONE' && day !== null && day >= ctx.period.from && day <= ctx.period.to;
};

function sum(measure: 'estimate' | 'days', items: WorkItem[], ctx: MeasureContext): MeasureCell {
  const values = items.flatMap((i) => {
    const v = measure === 'estimate' ? (i.estimate?.unit === ctx.unit ? i.estimate.value : null) : ctx.days.get(i.id) ?? null;
    return v === null ? [] : [v];
  });
  const of = items.length;
  const cell: MeasureCell = { value: values.length === 0 && of > 0 ? null : round2(values.reduce((a, b) => a + b, 0)), measured: values.length, of };
  if (of > 0 && values.length < of) {
    const left = of - values.length;
    cell.reason = measure === 'estimate'
      ? values.length === 0 ? `None of the ${plural(of, 'item')} has an estimate in ${ctx.unit}.` : `${values.length} of ${plural(of, 'item')} have an estimate in ${ctx.unit}; the other ${left} are left out.`
      : values.length === 0 ? `The status history was not read for any of the ${plural(of, 'item')}.` : `The status history was not read for ${left} of ${plural(of, 'item')}; they are left out.`;
  }
  return cell;
}

function throughput(items: WorkItem[], ctx: MeasureContext): MeasureCell {
  const unknown = items.filter((i) => i.statusCategory === 'DONE' && dayOf(i.resolved) === null).length;
  const cell: MeasureCell = { value: items.filter((i) => resolvedInPeriod(i, ctx)).length, measured: items.length - unknown, of: items.length };
  if (unknown > 0) cell.reason = `${plural(unknown, 'finished item')} ${unknown === 1 ? 'has' : 'have'} no resolved date, so ${unknown === 1 ? 'it is' : 'they are'} not counted.`;
  return cell;
}

/** The median and 85th percentile of a day figure per item, or null where no item has one. */
function spread(applicable: WorkItem[], figure: (i: WorkItem) => number | null, none: string, partial: (read: number, of: number) => string): MeasureCell {
  const nums = applicable.flatMap((i) => { const v = figure(i); return v === null ? [] : [v]; }).sort((a, b) => a - b);
  const cell: MeasureCell = { value: null, p85: null, measured: nums.length, of: applicable.length };
  if (applicable.length === 0) cell.reason = none;
  else if (nums.length === 0) cell.reason = partial(0, applicable.length);
  else {
    cell.value = round2(percentile(nums, 0.5));
    cell.p85 = round2(percentile(nums, 0.85));
    if (nums.length < applicable.length) cell.reason = partial(nums.length, applicable.length);
  }
  return cell;
}

const startedPartial = (one: string, many: string) => (read: number, of: number) =>
  read === 0 ? `No start date could be read for the ${plural(of, one, many)}: the status history was not read, or never saw it start.` : `${read} of ${plural(of, one, many)} had a start date; the other ${of - read} are left out.`;

/** One measure for a set of items. */
export function computeMeasure(measure: MeasureId, items: WorkItem[], ctx: MeasureContext): MeasureCell {
  switch (measure) {
    case 'items': return { value: items.length, measured: items.length, of: items.length };
    case 'estimate': case 'days': return sum(measure, items, ctx);
    case 'throughput': return throughput(items, ctx);
    case 'wip': {
      const n = items.filter((i) => i.statusCategory === 'IN_PROGRESS').length;
      return { value: n, measured: items.length, of: items.length };
    }
    case 'cycleTime':
      return spread(
        items.filter((i) => resolvedInPeriod(i, ctx)),
        (i) => { const s = startedAt(i); return s === null || i.resolved === null ? null : calendarDays(s, i.resolved); },
        'No item was resolved in the period.',
        startedPartial('finished item', 'finished items'),
      );
    case 'aging':
      return spread(
        items.filter((i) => i.statusCategory === 'IN_PROGRESS'),
        (i) => { const s = startedAt(i); return s === null ? null : calendarDays(s, ctx.asOf); },
        'No item is in progress.',
        startedPartial('item in progress', 'items in progress'),
      );
  }
}
