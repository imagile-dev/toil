/**
 * The Explore dashboard's logic (#567): which dimensions its menus offer, how a
 * view lives in the address, which chart form follows the data, and the exact
 * input a press of Save to Charts hands toil's `projects view set`. All pure, so
 * a test holds each without a browser. The dimension menu is the model's own
 * plus what this toil project's data holds: parent levels that exist ("Parent ›
 * Initiative"), label families (the part before a `/`, `:` or `-` that three
 * labels share) and each field the toil project names. A dimension nobody read
 * is greyed "not read yet" and not hidden, so a person learns it exists and
 * what reads it (principle 12). A spreadsheet pivot table has the same
 * menu, except that nobody ever had to ask it what an Epic was.
 */

import { DIMENSION_MENU, MEASURE_LABEL, formatFilter, parseDimension, specFromQuery, specToQuery, viewToSpec, type Filter, type PivotResult, type PivotSpec, type SavedView } from '../../../src/core/insights/index.ts';
import { ALL_KEY } from '../../../src/core/insights/index.ts';
import { toWhere, writeFilters, type Filters } from '../filters.ts';
import type { WorkInsights } from './work-insights.ts';

export interface DimensionChoice {
  spec: string;
  label: string;
  /** False when the read never fetched it for any item: shown greyed, "not read yet". */
  read: boolean;
  time: boolean;
}

/** The parent levels the data holds, by the name a person would say ("Initiative"), beyond the Epic and Feature the menu always has. */
export function parentLevels(ins: WorkInsights): string[] {
  const names = new Set<string>();
  for (const i of ins.items) for (const a of i.ancestors ?? []) names.add(a.typeName ?? a.type.charAt(0) + a.type.slice(1).toLowerCase());
  return [...names].sort((a, b) => a.localeCompare(b));
}

const FAMILY = /^([^/:\-\s]{2,})[/:-](.+)$/;

/** Label prefixes (before a `/`, `:` or `-`) that at least three different labels share: "team/payments", "team/search" and "team/web" make "team". */
export function labelFamilies(ins: WorkInsights): string[] {
  const byPrefix = new Map<string, Set<string>>();
  for (const i of ins.items) {
    for (const l of i.labels) {
      const m = FAMILY.exec(l);
      if (!m) continue;
      const prefix = m[1]!.toLowerCase();
      const set = byPrefix.get(prefix) ?? new Set<string>();
      set.add(l.toLowerCase());
      byPrefix.set(prefix, set);
    }
  }
  return [...byPrefix].filter(([, set]) => set.size >= 3).map(([prefix]) => prefix).sort();
}

/** Every dimension a menu offers for this data: the model's menu, the parent levels and label families the data holds, and the toil project's own fields. */
export function dimensionChoices(ins: WorkInsights, dimensionNames: readonly string[] = []): DimensionChoice[] {
  const specs = new Map<string, string>();
  for (const d of DIMENSION_MENU) specs.set(d.spec, d.label);
  for (const level of parentLevels(ins)) {
    const spec = `parent:${level}`;
    if (![...specs.keys()].some((s) => s.toLowerCase() === spec.toLowerCase())) specs.set(spec, parseDimension(spec).label);
  }
  for (const prefix of labelFamilies(ins)) specs.set(`label:${prefix}`, parseDimension(`label:${prefix}`).label);
  for (const name of dimensionNames) specs.set(`dim:${name}`, parseDimension(`dim:${name}`).label);
  return [...specs].map(([spec, label]) => ({ spec, label, read: ins.valuesIn(spec) !== null, time: parseDimension(spec).kind === 'time' }));
}

// The address -------------------------------------------------------------------------------------

/** Query keys Explore owns besides the filter bar's: the spec's, in specToQuery's words. */
export const EXPLORE_KEYS = ['measure', 'across', 'where', 'share', 'top', 'pin', 'parents'] as const;

/** What the address names, or the sentence saying which key is wrong. Filters from the bar are added to the spec's own. */
export function exploreSpec(query: URLSearchParams, filters: Filters): { spec: PivotSpec } | { error: string } {
  try {
    const spec = specFromQuery(Object.fromEntries([...query].filter(([k]) => k === 'split' || (EXPLORE_KEYS as readonly string[]).includes(k))));
    const where = [...(spec.where ?? []), ...toWhere(filters)];
    const out: PivotSpec = { ...spec, ...(where.length > 0 ? { where } : {}) };
    if (filters.from) out.from = filters.from;
    if (filters.to) out.to = filters.to;
    return { spec: out };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The address query for a spec: its own keys, with each "is one of" filter as the filter bar's key so the bar shows and removes it. */
export function exploreQuery(spec: PivotSpec, chart?: SavedView['chart']): URLSearchParams {
  const equal = (spec.where ?? []).filter((f) => f.op === '=');
  const rest = (spec.where ?? []).filter((f) => f.op !== '=');
  const q = new URLSearchParams(specToQuery({ ...spec, where: rest }));
  q.delete('from');
  q.delete('to');
  const filters: Filters = { where: equal.map((f) => ({ dimension: f.dimension, values: f.values })), ...(spec.from ? { from: spec.from } : {}), ...(spec.to ? { to: spec.to } : {}) };
  writeFilters(q, filters);
  if (chart) q.set('chart', chart);
  return q;
}

/** The link to open Explore on a spec, from the toil project's name. */
export const exploreHref = (base: string, spec: PivotSpec, chart?: SavedView['chart']): string => `${base}?${exploreQuery(spec, chart).toString()}`;

/** What a saved view counts, in words for its card: "Items finished, by category, across resolved by month". */
export function viewSentence(spec: PivotSpec): string {
  const label = (d: string) => parseDimension(d).label.toLowerCase();
  return `${MEASURE_LABEL[spec.measure]}${spec.split ? `, by ${label(spec.split)}` : ''}${spec.across ? `, across ${label(spec.across)}` : ''}`;
}

/** A saved view as the spec Explore opens: the view without its title and chart. */
export const viewSpec = (view: SavedView): PivotSpec => viewToSpec(view);

// The chart that follows the data ---------------------------------------------------------------------

export type ExploreForm = 'columns' | 'bars' | 'heatmap' | 'table';

/**
 * The form a pivot reads best in, unless a saved view named one: a time across is columns over time; two categorical
 * dimensions with many values is a heatmap; a categorical across is stacked bars; no across is one bar per value.
 */
export function formFor(result: PivotResult, chosen?: SavedView['chart']): ExploreForm {
  if (chosen === 'columns' || chosen === 'area' || chosen === 'line') return 'columns';
  if (chosen === 'bars') return 'bars';
  if (chosen === 'heatmap') return 'heatmap';
  if (chosen === 'table') return 'table';
  if (result.across?.kind === 'time') return 'columns';
  if (result.across && result.split) return result.rows.length > 6 || result.columns.length > 6 ? 'heatmap' : 'bars';
  return 'bars';
}

/** A result with no across turned on its side: one column per split value, so each value is one bar. */
export function oneBarEach(result: PivotResult): PivotResult {
  if (result.across || result.rows.length === 0) return result;
  const all = { key: ALL_KEY, label: result.measure.label, kind: 'value' as const };
  return {
    ...result,
    rows: [all],
    columns: result.rows,
    cells: [result.rows.map((_, i) => result.cells[i]![0]!)],
    rowTotals: [result.total],
    columnTotals: result.rowTotals,
    split: null,
    across: result.split,
  };
}

// Save to Charts --------------------------------------------------------------------------------------------

/** The line a filter reads as in `projects view set --where`: "release = 2.4, 2.5". */
export const whereLines = (where: Filter[] | undefined): string[] => (where ?? []).map(formatFilter);

/** A view's name from its title: lowercase words and hyphens, starting with a letter. */
export function viewNameFrom(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41).replace(/-+$/, '');
  return /^[a-z]/.test(slug) ? slug : slug === '' ? '' : `view-${slug}`.slice(0, 41).replace(/-+$/, '');
}

/**
 * The input a press of Save to Charts gives `projects view set`: the spec's own fields, filters as the command reads
 * them, and the name and title the person typed. `replace` is only sent when the person said to change a view that exists.
 */
export function saveViewInput(toilProject: string, name: string, title: string, spec: PivotSpec, chart?: SavedView['chart'], replace = false): Record<string, unknown> {
  return {
    toilProject,
    name,
    measure: spec.measure,
    ...(spec.split ? { split: spec.split } : {}),
    ...(spec.across ? { across: spec.across } : {}),
    ...(spec.where && spec.where.length > 0 ? { where: whereLines(spec.where) } : {}),
    ...(spec.from ? { from: spec.from } : {}),
    ...(spec.to ? { to: spec.to } : {}),
    ...(spec.share ? { share: true } : {}),
    ...(spec.top !== undefined ? { top: spec.top } : {}),
    ...(spec.pin && spec.pin.length > 0 ? { pin: spec.pin } : {}),
    ...(spec.includeParents ? { includeParents: true } : {}),
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(chart ? { chart } : {}),
    ...(replace ? { replace: true } : {}),
  };
}
