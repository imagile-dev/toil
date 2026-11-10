/**
 * Notable changes (#567): the three things code can find in a pivot so an AI
 * agent explains them instead of discovering them (and invents the number it
 * did not find). A share that moved, scope that arrived after the work began,
 * and the row that grew fastest. Each says exactly what it counted, in one
 * sentence with the figures in it. Thresholds are the contract's constants and,
 * unlike most thresholds, have been written down somewhere other than a slide.
 */

import type { WorkItem } from '../owi/types.js';
import { dayOf, nextBucket, parseDimension, startedAt } from './dimensions.js';
import { ALL_KEY, NOTABLE_SCOPE_RATIO, NOTABLE_SHARE_POINTS, type Notable, type PivotCell, type PivotInput, type PivotResult, type TimeGrain } from './types.js';

const num = (x: number) => String(Math.round(x * 10) / 10);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const EPS = 1e-9;

/** The two columns to compare: the last two complete ones. The bucket holding `asOf` is still filling, so it is skipped when three or more exist. */
function comparedColumns(result: PivotResult): [number, number] | null {
  const n = result.columns.length;
  if (result.across?.kind !== 'time' || n < 2) return null;
  const grain = (parseDimension(result.across.spec).arg ?? 'week') as TimeGrain;
  const start = result.columns[n - 1]!.key.replace(/^v:/, '');
  const today = dayOf(result.asOf)!;
  const incomplete = start <= today && today < nextBucket(start, grain);
  return incomplete && n >= 3 ? [n - 3, n - 2] : [n - 2, n - 1];
}

function shareOf(result: PivotResult, r: number, c: number): number | null {
  const v = result.cells[r]![c]!.value;
  const t = result.columnTotals[c]!.value;
  return v === null || t === null || t <= 0 ? null : v / t;
}

function shareMoved(result: PivotResult, [p, c]: [number, number]): Notable[] {
  const out: Notable[] = [];
  const prev = result.columns[p]!;
  const cur = result.columns[c]!;
  result.rows.forEach((row, r) => {
    const a = shareOf(result, r, p);
    const b = shareOf(result, r, c);
    if (a === null || b === null || Math.abs(b - a) < NOTABLE_SHARE_POINTS - EPS) return;
    out.push({
      kind: 'share-moved', row: row.key, column: cur.key, delta: b - a, items: result.cells[r]![c]!.items,
      message: `${row.label} went from ${pct(a)} of ${prev.label} to ${pct(b)} of ${cur.label}, ${b > a ? 'up' : 'down'} ${Math.round(Math.abs(b - a) * 100)} points.`,
    });
  });
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

const GROWTH_MEASURES = ['items', 'estimate', 'days', 'throughput', 'wip'];

function grewFastest(result: PivotResult, [p, c]: [number, number]): Notable[] {
  if (!GROWTH_MEASURES.includes(result.measure.id)) return [];
  const rows = result.rows.flatMap((row, r) => {
    const a = result.cells[r]![p]!;
    const b = result.cells[r]![c]!;
    return row.kind === 'value' && a.value !== null && b.value !== null ? [{ row, a, b, growth: b.value - a.value }] : [];
  });
  if (rows.length < 2) return [];
  const average = rows.reduce((s, x) => s + x.growth, 0) / rows.length;
  const best = rows.reduce((m, x) => (x.growth > m.growth ? x : m));
  const added = best.b.items.length - best.a.items.length;
  if (best.growth <= 0 || added < 3 || (average > 0 && best.growth < 2 * average - EPS)) return [];
  const unit = result.measure.unit;
  return [{
    kind: 'grew-fastest', row: best.row.key, column: result.columns[c]!.key, delta: best.growth, items: best.b.items,
    message: `${best.row.label} grew fastest: from ${num(best.a.value!)} to ${num(best.b.value!)} ${unit} between ${result.columns[p]!.label} and ${result.columns[c]!.label}, up ${num(best.growth)} against ${num(average)} on average across rows.`,
  }];
}

/**
 * Scope added to a release after work on it began. What is counted: of the items
 * in an unreleased release, those created after the earliest `started` among them,
 * over the release's item count. Row `(all)` or column `(all)` stands for the
 * whole of the other axis, which is the release's own total.
 */
function scopeAdded(result: PivotResult, input: PivotInput): Notable[] {
  const bySplit = result.split && parseDimension(result.split.spec).base === 'release';
  const byAcross = result.across && parseDimension(result.across.spec).base === 'release';
  if (!bySplit && !byAcross) return [];
  const axis = bySplit ? result.rows : result.columns;
  const totals = bySplit ? result.rowTotals : result.columnTotals;
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const out: Notable[] = [];
  axis.forEach((value, i) => {
    if (value.kind !== 'value') return;
    const items = ((totals[i] as PivotCell).items.map((id) => byId.get(id)).filter(Boolean)) as WorkItem[];
    const named = items.flatMap((it) => (it.releases ?? []).filter((r) => `v:${r.id ?? r.name}` === value.key));
    if (named.length === 0 || named.some((r) => r.released === true)) return;
    const starts = items.flatMap((it) => { const s = startedAt(it); return s === null ? [] : [Date.parse(s)]; });
    if (starts.length === 0) return;
    const first = Math.min(...starts);
    const added = items.filter((it) => it.created !== null && Date.parse(it.created) > first);
    const ratio = added.length / items.length;
    if (ratio < NOTABLE_SCOPE_RATIO - EPS) return;
    out.push({
      kind: 'scope-added', row: bySplit ? value.key : ALL_KEY, column: bySplit ? ALL_KEY : value.key, delta: ratio, items: added.map((it) => it.id).sort(),
      message: `${value.label}: ${added.length} of its ${items.length} items (${pct(ratio)}) were created after work on it started on ${new Date(first).toISOString().slice(0, 10)}.`,
    });
  });
  return out.sort((x, y) => y.delta - x.delta);
}

/** The changes worth a look in a pivot, in a fixed order: shares moved, scope added, fastest growth. */
export function notable(result: PivotResult, input: PivotInput): Notable[] {
  const pair = comparedColumns(result);
  return [...(pair ? shareMoved(result, pair) : []), ...scopeAdded(result, input), ...(pair ? grewFastest(result, pair) : [])];
}
