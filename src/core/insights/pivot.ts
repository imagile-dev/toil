/**
 * The pivot (#567): one measure, split by one dimension, across time or a
 * second dimension, under filters. This is the whole model's front door; the
 * CLI, MCP and Toil UI call `pivot()` and draw what comes back, so a figure on
 * a screen is the figure an agent reads. Every cell carries the OWI ids behind
 * it, an item counts once in a total however many values it holds, and an
 * axis nobody read comes back empty with a sentence saying so, because an empty
 * chart with no explanation is how a report becomes a meeting about the report.
 */

import type { WorkItem } from '../owi/types.js';
import { addDays, bucketLabel, bucketsBetween, dayOf, parseDimension, unreadNoun, valuesOf, type ValuesContext } from './dimensions.js';
import { applyFilters, formatFilter } from './filter.js';
import { computeMeasure, estimateUnit, MEASURE_LABEL, measureUnit, personDays, type MeasureCell, type MeasureContext } from './measures.js';
import { notable } from './notable.js';
import { ALL_KEY, MEASURES, NONE_KEY, OTHER_KEY, type Dimension, type PivotAxisValue, type PivotCell, type PivotInput, type PivotResult, type TimeGrain } from './types.js';

export const DEFAULT_TOP = 4;
export const DEFAULT_PERIOD_DAYS = 90;

type Entry = { key: string; label: string; short?: string; order?: string };
type Sets = Map<string, Set<string>>;

interface AxisRead {
  dim: Dimension | null;
  /** Value keys per item (NONE_KEY for the none bucket); an item missing here is unread or outside every bucket. */
  keys: Map<string, string[]>;
  entries: Map<string, Entry>;
  unread: number;
  /** Items that have no date for a time dimension inside the period: in no bucket, and said so. */
  outside: Set<string>;
  read: boolean;
}

function readAxis(dim: Dimension | null, pool: WorkItem[], ctx: ValuesContext): AxisRead {
  const out: AxisRead = { dim, keys: new Map(), entries: new Map(), unread: 0, outside: new Set(), read: true };
  if (!dim) {
    out.entries.set(ALL_KEY, { key: ALL_KEY, label: 'All items' });
    for (const i of pool) out.keys.set(i.id, [ALL_KEY]);
    return out;
  }
  for (const item of pool) {
    const v = valuesOf(item, dim, ctx);
    if (v.unread) { out.unread++; continue; }
    if (v.values.length === 0) {
      if (dim.noneLabel === null) out.outside.add(item.id);
      else { out.keys.set(item.id, [NONE_KEY]); out.entries.set(NONE_KEY, { key: NONE_KEY, label: dim.noneLabel }); }
      continue;
    }
    for (const e of v.values) out.entries.set(e.key, e);
    out.keys.set(item.id, v.values.map((e) => e.key));
  }
  out.read = !(pool.length > 0 && out.unread === pool.length);
  return out;
}

function setsOf(axis: AxisRead, eligible: Set<string>): Sets {
  const sets: Sets = new Map();
  for (const [id, keys] of axis.keys) {
    if (!eligible.has(id)) continue;
    for (const k of keys) (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(id);
  }
  return sets;
}

interface Arranged { axis: PivotAxisValue[]; sets: Sets; all: PivotResult['allValues'] }

/** Rows or columns in the order a table shows them: pinned, then largest, then Other, then none; time and ordered dimensions in their own order. */
function arrange(a: AxisRead, valueSets: Sets, run: (ids: string[]) => MeasureCell, top: number, pin: string[], period: PivotResult['period']): Arranged {
  const sets: Sets = new Map(valueSets);
  const dim = a.dim;
  if (!dim) return { axis: [{ key: ALL_KEY, label: 'All items', kind: 'value' }], sets, all: [] };
  if (dim.kind === 'time') {
    const grain = (dim.arg ?? 'week') as TimeGrain;
    for (const start of bucketsBetween(period.from, period.to, grain)) {
      const key = `v:${start}`;
      if (!a.entries.has(key)) a.entries.set(key, { key, label: bucketLabel(start, grain), order: start });
      if (!sets.has(key)) sets.set(key, new Set());
    }
  }
  const entry = (k: string) => a.entries.get(k)!;
  const real = [...sets.keys()].filter((k) => k !== NONE_KEY);
  const sized = real.map((k) => ({ k, label: entry(k).label, n: sets.get(k)!.size, value: run([...sets.get(k)!]).value }));
  sized.sort((x, y) => (y.value ?? -Infinity) - (x.value ?? -Infinity) || y.n - x.n || x.label.localeCompare(y.label));
  const all = sized.map((s) => ({ key: s.k, label: s.label, value: s.value, items: s.n }));
  const value = (k: string): PivotAxisValue => ({ key: k, label: entry(k).label, kind: 'value', ...(entry(k).short ? { short: entry(k).short } : {}) });
  const axis: PivotAxisValue[] = [];
  const ordered = dim.kind === 'time' || (real.length > 0 && real.every((k) => entry(k).order !== undefined));
  let folded: string[] = [];
  if (ordered) {
    axis.push(...[...real].sort((x, y) => entry(x).order!.localeCompare(entry(y).order!) || entry(x).label.localeCompare(entry(y).label)).map(value));
  } else {
    const pinned: string[] = [];
    for (const p of pin) {
      const hit = sized.find((s) => s.label.toLowerCase() === p.toLowerCase());
      if (hit && !pinned.includes(hit.k)) pinned.push(hit.k);
    }
    const rest = sized.map((s) => s.k).filter((k) => !pinned.includes(k));
    const room = top === 0 ? rest.length : Math.max(0, top - pinned.length);
    axis.push(...[...pinned, ...rest.slice(0, room)].map(value));
    folded = rest.slice(room);
  }
  if (folded.length > 0) {
    axis.push({ key: OTHER_KEY, label: 'Other', kind: 'other' });
    sets.set(OTHER_KEY, new Set(folded.flatMap((k) => [...sets.get(k)!])));
  }
  if (sets.has(NONE_KEY) && sets.get(NONE_KEY)!.size > 0) axis.push({ key: NONE_KEY, label: entry(NONE_KEY).label, kind: 'none' });
  return { axis, sets, all };
}

const toCell = (m: MeasureCell, items: string[]): PivotCell => {
  const c: PivotCell = { value: m.value, items, measured: m.measured, of: m.of };
  if (m.p85 !== undefined) c.p85 = m.p85;
  if (m.reason) c.reason = m.reason;
  return c;
};

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const axisInfo = (a: AxisRead) => (a.dim ? { spec: a.dim.spec, label: a.dim.label, kind: a.dim.kind, read: a.read } : null);

/** Works out one pivot. Pure: the same input gives the same result, and nothing here reads a clock. */
export function pivot(input: PivotInput): PivotResult {
  const { spec, asOf } = input;
  if (!(MEASURES as readonly string[]).includes(spec.measure)) throw new Error(`Unknown measure "${spec.measure}". Choose one of: ${MEASURES.join(', ')}.`);
  const today = dayOf(asOf);
  if (today === null) throw new Error(`asOf must be an ISO 8601 date, not "${asOf}".`);
  const to = spec.to ?? today;
  const from = spec.from ?? addDays(to, 1 - DEFAULT_PERIOD_DAYS);
  if (from > to) throw new Error(`The period starts after it ends (${from} to ${to}).`);
  const period = { from, to };
  const top = spec.top ?? DEFAULT_TOP;
  const index = new Map(input.items.map((i) => [i.id, i]));
  const vctx: ValuesContext = { asOf, period, people: input.people, categories: input.categories, scheme: input.scheme, index };
  const splitDim = spec.split ? parseDimension(spec.split) : null;
  const acrossDim = spec.across ? parseDimension(spec.across) : null;
  const notes: string[] = [];

  const { kept, unjudged } = applyFilters(input.items, spec.where ?? [], vctx);
  for (const u of unjudged) {
    const d = parseDimension(u.filter.dimension);
    notes.push(`The filter "${formatFilter(u.filter)}" could not judge ${plural(u.count, 'item')} because ${lcFirst(unreadNoun(d))} weren't read; ${u.count === 1 ? 'it is' : 'they are'} ${u.filter.op === '=' ? 'left out' : 'kept in'}.`);
  }

  const parentSplit = splitDim?.kind === 'parent' || acrossDim?.kind === 'parent';
  const parents = new Set(input.items.flatMap((i) => [...(i.parent ? [i.parent] : []), ...(i.ancestors ?? []).map((a) => a.id)]));
  const pool = parentSplit && !spec.includeParents ? kept.filter((i) => !parents.has(i.id)) : kept;
  const parentsLeftOut = kept.length - pool.length;
  if (parentsLeftOut > 0) notes.push(`${plural(parentsLeftOut, 'parent item is', 'parent items are')} left out so their children carry the work; ask for parents to be included to put ${parentsLeftOut === 1 ? 'it' : 'them'} back.`);

  const rowAxis = readAxis(splitDim, pool, vctx);
  const colAxis = readAxis(acrossDim, pool, vctx);
  const unit = estimateUnit(input.items);
  const mctx: MeasureContext = { asOf, period, unit, days: spec.measure === 'days' ? personDays(input.items, period, asOf) : new Map() };
  const run = (ids: string[]) => computeMeasure(spec.measure, ids.map((id) => index.get(id)!), mctx);

  for (const a of [rowAxis, colAxis]) {
    if (!a.dim || a.unread === 0) continue;
    const noun = unreadNoun(a.dim);
    notes.push(a.read ? `${noun} weren't read for ${a.unread} of the ${pool.length} items; they are left out of the table.` : `${noun} weren't read for any of the ${pool.length} items.`);
  }

  const base = {
    spec, asOf, period,
    measure: { id: spec.measure, unit: measureUnit(spec.measure, unit), label: MEASURE_LABEL[spec.measure] },
    split: axisInfo(rowAxis), across: axisInfo(colAxis),
  };
  const coverageBase = { items: pool.length, unreadSplit: rowAxis.unread, unreadAcross: colAxis.unread, parentsLeftOut, multi: splitDim?.kind === 'multi' || acrossDim?.kind === 'multi' };
  if (input.changes && input.changes.length > 0) notes.push(`${plural(input.changes.length, 'pull request')} in the input ${input.changes.length === 1 ? 'is' : 'are'} not counted: no measure reads them yet.`);

  if (!rowAxis.read || !colAxis.read) {
    return {
      ...base, rows: [], columns: [], cells: [], rowTotals: [], columnTotals: [],
      total: { value: null, items: [], measured: 0, of: 0, reason: 'The table could not be drawn because a dimension was never read.' },
      allValues: [], coverage: { ...coverageBase, measured: 0, notes }, notable: [],
    };
  }

  const eligible = new Set(pool.filter((i) => rowAxis.keys.has(i.id) && colAxis.keys.has(i.id)).map((i) => i.id));
  for (const a of [rowAxis, colAxis]) {
    if (a.dim?.kind === 'time' && a.outside.size > 0) notes.push(`${plural(a.outside.size, 'item')} ${a.outside.size === 1 ? 'has' : 'have'} no ${a.dim.base} date between ${from} and ${to}, so ${a.outside.size === 1 ? 'it is' : 'they are'} not in the table.`);
  }

  const rows = arrange(rowAxis, setsOf(rowAxis, eligible), run, top, spec.pin ?? [], period);
  const cols = arrange(colAxis, setsOf(colAxis, eligible), run, top, [], period);
  const ids = (s: Set<string> | undefined) => [...(s ?? [])].sort();
  const both = (a: Set<string> | undefined, b: Set<string> | undefined) => ids(a).filter((id) => b?.has(id));
  const cells = rows.axis.map((r) => cols.axis.map((c) => { const list = both(rows.sets.get(r.key), cols.sets.get(c.key)); return toCell(run(list), list); }));
  const rowTotals = rows.axis.map((r) => { const list = ids(rows.sets.get(r.key)); return toCell(run(list), list); });
  const columnTotals = cols.axis.map((c) => { const list = ids(cols.sets.get(c.key)); return toCell(run(list), list); });
  const everyone = [...eligible].sort();
  const total = toCell(run(everyone), everyone);

  if (spec.share) {
    cols.axis.forEach((_, ci) => {
      const t = columnTotals[ci]!.value;
      rows.axis.forEach((__, ri) => {
        const v = cells[ri]![ci]!.value;
        cells[ri]![ci]!.share = t === null || t === 0 || v === null ? null : Math.round((v / t) * 10000) / 10000;
      });
    });
  }

  if (coverageBase.multi) {
    const which = [splitDim, acrossDim].filter((d): d is Dimension => d?.kind === 'multi').map((d) => lcFirst(d.label)).join(' and ');
    notes.push(`An item can hold more than one ${which}, so it can count in more than one ${splitDim?.kind === 'multi' ? 'row' : 'column'} and the figures may add up to more than the total.`);
  }
  if (total.reason) notes.push(total.reason);

  const result: PivotResult = {
    ...base, rows: rows.axis, columns: cols.axis, cells, rowTotals, columnTotals, total,
    allValues: rows.all, coverage: { ...coverageBase, measured: total.measured, notes }, notable: [],
  };
  result.notable = notable(result, input);
  return result;
}
