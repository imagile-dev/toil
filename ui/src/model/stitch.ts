/**
 * One table from several single-column pivots (#567). The pivot model buckets
 * an item once per dimension value, which is right for "resolved by week" and
 * wrong for "done in each sprint" or "in progress during each week", where an
 * item may belong to several columns for reasons the model's dimensions don't
 * name. The dashboards ask the model the same question once per column, over
 * the items that belong to that column, and `stitchColumns` joins the answers
 * into the `PivotResult` the chart kit draws, so those charts get the
 * tooltips, shares, figures and unread states every other chart has. A row
 * that one column's pivot did not see is a computed zero if that column was
 * read at all, and a dash if it was not: null is never 0 (principle 12). The
 * columns of one chart, assembled from several enquiries, is also how most
 * minutes of a long meeting are produced.
 */

import { NONE_KEY, OTHER_KEY, type PivotAxisValue, type PivotCell, type PivotResult, type PivotSpec } from '../../../src/core/insights/index.ts';

export interface StitchPart {
  key: string;
  label: string;
  /** The pivot over this column's items: a split, no across, and every value kept (`top: 0`). */
  result: PivotResult;
}

export interface StitchOptions {
  spec: PivotSpec;
  /** How many split values keep their own row (the rest fold into Other); 0 keeps all. Default 4. */
  top?: number;
  /** Rows in name order, never by size: people and teams. */
  byName?: boolean;
}

const ids = (lists: string[][]): string[] => [...new Set(lists.flat())].sort();
const sum = (values: Array<number | null>): number | null => (values.every((v) => v === null) ? null : values.reduce<number>((n, v) => n + (v ?? 0), 0));

/** The parts joined as columns, rows in size order (or name order), the smallest folded into Other, "none" last. */
export function stitchColumns(parts: StitchPart[], { spec, top = 4, byName = false }: StitchOptions): PivotResult {
  const first = parts[0]?.result;
  const columns: PivotAxisValue[] = parts.map((p) => ({ key: p.key, label: p.label, kind: 'value' }));
  const unreadSplit = parts.find((p) => p.result.split && !p.result.split.read);
  if (!first || unreadSplit) {
    const base = unreadSplit?.result ?? first;
    return {
      spec, asOf: base?.asOf ?? '', period: base?.period ?? { from: '', to: '' }, measure: base?.measure ?? { id: spec.measure, unit: 'items', label: 'Items' },
      split: base?.split ?? null, across: null, rows: [], columns, cells: [], rowTotals: [], columnTotals: [],
      total: { value: null, items: [], measured: 0, of: 0, reason: 'The table could not be drawn because a dimension was never read.' },
      allValues: [], coverage: { items: 0, measured: 0, unreadSplit: 0, unreadAcross: 0, parentsLeftOut: 0, multi: false, notes: base?.coverage.notes ?? [] }, notable: [],
    };
  }
  const seen = new Map<string, PivotAxisValue>();
  for (const p of parts) for (const r of p.result.rows) if (!seen.has(r.key)) seen.set(r.key, r);
  const cellOf = (part: PivotResult, key: string): PivotCell => {
    const at = part.rows.findIndex((r) => r.key === key);
    if (at >= 0) return part.cells[at]![0]!;
    return part.total.value === null ? { value: null, items: [], measured: 0, of: 0, reason: part.total.reason ?? 'Not read.' } : { value: 0, items: [], measured: 0, of: 0 };
  };
  const real = [...seen.values()].filter((r) => r.kind === 'value');
  const size = (key: string) => sum(parts.map((p) => cellOf(p.result, key).value)) ?? 0;
  const ordered = byName ? [...real].sort((a, b) => a.label.localeCompare(b.label)) : [...real].sort((a, b) => size(b.key) - size(a.key) || a.label.localeCompare(b.label));
  const keep = top === 0 || byName ? ordered : ordered.slice(0, top);
  const folded = ordered.filter((r) => !keep.includes(r));
  const rows: PivotAxisValue[] = [...keep];
  const lines: Array<(part: PivotResult) => PivotCell> = keep.map((r) => (part) => cellOf(part, r.key));
  const merge = (cells: PivotCell[]): PivotCell => ({ value: sum(cells.map((c) => c.value)), items: ids(cells.map((c) => c.items)), measured: cells.reduce((n, c) => n + c.measured, 0), of: cells.reduce((n, c) => n + c.of, 0) });
  if (folded.length > 0) {
    rows.push({ key: OTHER_KEY, label: 'Other', kind: 'other' });
    lines.push((part) => merge(folded.map((r) => cellOf(part, r.key))));
  }
  const none = seen.get(NONE_KEY);
  if (none && parts.some((p) => (cellOf(p.result, NONE_KEY).items.length > 0))) {
    rows.push(none);
    lines.push((part) => cellOf(part, NONE_KEY));
  }
  const cells = lines.map((line) => parts.map((p) => line(p.result)));
  const columnTotals = parts.map((p) => p.result.total);
  const rowTotals = cells.map((row) => merge(row));
  const total: PivotCell = { value: sum(columnTotals.map((c) => c.value)), items: ids(columnTotals.map((c) => c.items)), measured: columnTotals.reduce((n, c) => n + c.measured, 0), of: columnTotals.reduce((n, c) => n + c.of, 0) };
  const notes = [...new Set(parts.flatMap((p) => p.result.coverage.notes))];
  return {
    spec, asOf: first.asOf, period: first.period, measure: first.measure, split: first.split, across: null,
    rows, columns, cells, rowTotals, columnTotals, total,
    allValues: ordered.map((r) => ({ key: r.key, label: r.label, value: size(r.key), items: ids(parts.map((p) => cellOf(p.result, r.key).items)).length })),
    coverage: { items: total.of, measured: total.measured, unreadSplit: first.coverage.unreadSplit, unreadAcross: 0, parentsLeftOut: first.coverage.parentsLeftOut, multi: first.coverage.multi, notes },
    notable: [],
  };
}
