/**
 * What the Board's swimlanes, the People view's mix bar and the Summary's
 * split modals have in common (#567): a set of items sorted into the values of
 * one dimension, worked out by the insights data layer's own pivots, so a lane,
 * a segment and a chart in Charts all count the same items. Pure functions, no
 * React. A lane is a grouping and never a status, so nothing here knows what a
 * move is. The team is measured and never the person: people and squads come
 * out in name order, not sorted by how much work they hold, and no function
 * here ranks anything. An item whose dimension was never read is not put in the
 * "none" lane, because "no epic" and "never asked" are different answers to a
 * steering committee (principle 12). Sorting items into lanes is the only
 * filing job in the building that nobody has asked for a retention schedule.
 */

import { addDays, parseDimension, specToQuery, type PivotCell, type PivotResult, type PivotSpec } from '../../../src/core/insights/index.ts';
import { bucketStart } from '../../../src/core/insights/dimensions.ts';
import { chartsHref } from '../format.ts';
import type { WorkItem } from '../toil.ts';
import { isPeopleDimension, SPLIT_MENU, type WorkInsights } from './work-insights.ts';

// Group by ---------------------------------------------------------------------------------

/** The dimensions a person looks for first when grouping work: the epic it belongs to, then the release, the squad and the category. */
const GROUP_FIRST = ['parent:Epic', 'release', 'team', 'category', 'component', 'assignee', 'sprint'];

/**
 * Every dimension the Group by menu offers, in the order a person looks for them. The status columns are already the
 * status category, so grouping by it would draw a board of one-column lanes.
 */
export const GROUP_MENU: string[] = [...GROUP_FIRST, ...SPLIT_MENU.map((d) => d.spec).filter((s) => !GROUP_FIRST.includes(s) && s !== 'statusCategory')].filter((s) => SPLIT_MENU.some((d) => d.spec === s));

/** The dimensions the Split by menus in the Summary's modals offer: ways of cutting the team's flow, never a person. */
export const SPLIT_DIMENSIONS = ['category', 'component', 'team', 'release', 'parent:Epic'];

/** What the People view's menu can show a person's open work by. */
export const PERSON_MIX_DIMENSIONS = ['category', 'release', 'parent:Epic', 'component'];

/** The most lanes shown before the rest fold into "Other" (the largest by count, for a dimension that isn't people). */
export const LANE_LIMIT = 4;

export const isGroupSpec = (spec: string | null | undefined): spec is string => !!spec && GROUP_MENU.includes(spec);

export interface Lane {
  key: string;
  label: string;
  /** For a category: its short form, for a tooltip. */
  short?: string;
  kind: 'value' | 'none' | 'other' | 'unread';
  items: WorkItem[];
}

export interface LaneSet {
  spec: string;
  lanes: Lane[];
  /** How many lanes are folded into Other right now. */
  folded: number;
  /** How many lanes "Show all lanes" opens, or would open if they were not already shown: 0 for a dimension that is never folded. */
  foldable: number;
}

/**
 * The board's items sorted into lanes by one dimension, or null when the read never fetched it. An item that holds several
 * values (components, fix versions, sprints) is in each of their lanes, as it is in each of their rows in a chart.
 * Lanes run largest first, with the folded rest as "Other", the "none" lane (No epic) and then anything unread last;
 * people and squads run in name order and are never folded, since a lane per person has no biggest.
 */
export function boardLanes(ins: WorkInsights, items: WorkItem[], spec: string, showAll: boolean): LaneSet | null {
  // Parents are put back in: a story with sub-tasks is a card on this board like any other, and the epics are not (the board skips containers).
  const result = ins.run({ measure: 'items', split: spec, top: 0, includeParents: true });
  if (!result.split?.read) return null;
  const on = (ids: ReadonlySet<string>) => items.filter((i) => ids.has(i.id));
  const placed = new Set<string>();
  const values: Lane[] = [];
  let none: Lane | null = null;
  result.rows.forEach((row, i) => {
    const mine = on(new Set(result.rowTotals[i]!.items));
    if (mine.length === 0) return;
    for (const m of mine) placed.add(m.id);
    const lane: Lane = { key: row.key, label: row.label, ...(row.short ? { short: row.short } : {}), kind: row.kind === 'none' ? 'none' : 'value', items: mine };
    if (lane.kind === 'none') none = lane;
    else values.push(lane);
  });
  const byName = isPeopleDimension(spec);
  values.sort(byName ? (a, b) => a.label.localeCompare(b.label) : (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  // An Other lane of one value would only rename it, so folding starts when two or more would fold.
  const folding = !byName && !showAll && values.length > LANE_LIMIT + 1;
  const shown = folding ? values.slice(0, LANE_LIMIT) : values;
  const rest = folding ? values.slice(LANE_LIMIT) : [];
  const lanes = [...shown];
  if (rest.length > 0) {
    const ids = new Set(rest.flatMap((l) => l.items.map((i) => i.id)));
    lanes.push({ key: '(other)', label: 'Other', kind: 'other', items: on(ids) });
  }
  if (none) lanes.push(none);
  const unread = items.filter((i) => !placed.has(i.id));
  if (unread.length > 0) lanes.push({ key: '(unread)', label: 'Not read yet', kind: 'unread', items: unread });
  return { spec, lanes, folded: rest.length, foldable: byName || values.length <= LANE_LIMIT + 1 ? 0 : values.length - LANE_LIMIT };
}

// The mix of a set of items -----------------------------------------------------------------

/**
 * One dimension's mix of a given set of items, as a pivot result a `MixBar` can draw: the whole data's rows with each row's
 * count cut down to the set. Null when the dimension was never read. Starting from the whole data's own pivot means the
 * rows, their names and their marks are the ones every other chart uses.
 */
export function mixOfItems(ins: WorkInsights, ids: readonly string[], dimension: string): PivotResult | null {
  const template = ins.run({ measure: 'items', split: dimension, top: 0 });
  if (!template.split?.read) return null;
  const keep = new Set(ids);
  const cut = (all: string[]): PivotCell => {
    const items = all.filter((id) => keep.has(id));
    return { value: items.length, items, measured: items.length, of: items.length };
  };
  const rowTotals = template.rowTotals.map((r) => cut(r.items));
  const total = cut(template.total.items);
  return { ...template, cells: rowTotals.map((c) => [c]), rowTotals, columnTotals: [total], total };
}

/** A person's open work, split by one dimension: the spec the People view's mix bar draws and its segments open. */
export function openWorkSpec(person: string, dimension: string): PivotSpec {
  return {
    measure: 'items',
    split: dimension,
    top: 0,
    where: [
      { dimension: 'assignee', op: '=', values: [person] },
      { dimension: 'statusCategory', op: '!=', values: ['Done'] },
    ],
  };
}

/** A result's rows in name order, "none" and "other" last: for a split by squad, which a chart must not sort by size. */
export function rowsInNameOrder(result: PivotResult): PivotResult {
  const order = result.rows.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.kind === 'none') - Number(b.r.kind === 'none') || Number(a.r.kind === 'other') - Number(b.r.kind === 'other') || a.r.label.localeCompare(b.r.label));
  return { ...result, rows: order.map((o) => o.r), cells: order.map((o) => result.cells[o.i]!), rowTotals: order.map((o) => result.rowTotals[o.i]!) };
}

// The Summary's split modals ---------------------------------------------------------------------

export type SplitMeasure = 'throughput' | 'cycleTime' | 'aging';

/** The weeks the Finished chart draws, counted from the Monday that many weeks back so no bar is a partial week's. */
const WEEKS = 6;

/**
 * The pivot a modal runs: today's chart's own question with no split (finished work by week, the time measures as one
 * median), or the same cut by one dimension. Finished work is stacked by week; the time measures read one median with its
 * 85th percentile per value. A split by squad keeps every squad (`top: 0`), since the Other fold would sort them by size.
 */
export function splitSpec(measure: SplitMeasure, split: string | null, today: string): PivotSpec {
  if (split !== null && !SPLIT_DIMENSIONS.includes(split)) throw new Error(`"${split}" is not a split the Summary offers.`);
  const base: PivotSpec = { measure, ...(split ? { split } : {}), ...(split && isPeopleDimension(split) ? { top: 0 } : {}) };
  if (measure === 'throughput') return { ...base, across: 'resolved:week', from: bucketStart(addDays(today, -7 * (WEEKS - 1)), 'week'), to: today };
  return base;
}

/** Where "Open in Charts" goes: the Explore dashboard, with the modal's own split in its address. */
export function exploreHref(toilProject: string, spec: PivotSpec): string {
  return `${chartsHref(toilProject, 'explore')}?${new URLSearchParams(specToQuery(spec)).toString()}`;
}

/** What a dimension is called in a sentence: "fix version", "parent › epic". */
export const dimensionWords = (spec: string): string => parseDimension(spec).label.toLowerCase();
