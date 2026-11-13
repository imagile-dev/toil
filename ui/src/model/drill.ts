/**
 * What a click on a chart opens (#567): a list of items, named by the address so
 * the list can be sent to someone. The address holds how to find the items, not
 * the items, which keeps it short whatever the cell holds:
 *
 *   items=cell|<row key>|<column key>|<the pivot as a query>     a cell of a pivot
 *   items=release|<set>|<release>|<day or ->|<filters as a query>  a figure about one release
 *   items=sprint|<set>|<sprint>|<split or ->|<row or ->          a figure about one sprint
 *   items=where|<row key>|<week key>|<the pivot as a query>      a cell of days in progress by week
 *   items=cfd|<status category>|<week start>                     a band of the cumulative flow diagram
 *
 * A cell is found again by running the same pivot and reading the same row and
 * column, so the list always has exactly as many items as the number clicked.
 * A release figure that is not a pivot cell (what was added after it started,
 * what is open past its date, done by a day) is a named set, worked out by the
 * same model that drew the number. Rows and columns are written with
 * encodeURIComponent so a name that holds `|` cannot split the address.
 * An unknown set, or a pivot that no longer holds the cell, opens an
 * explanation, never a quietly empty list.
 */

import { specFromQuery, specToQuery, ALL_KEY, type Filter, type PivotSpec } from '../../../src/core/insights/index.ts';
import { dayOf } from '../../../src/core/insights/dimensions.ts';
import { cfdSet, flowCategoryLabel, FLOW_CATEGORIES, type FlowCategory } from './flow-history.ts';
import { SPRINT_SETS, sprintSet, sprintStories, type SprintSet } from './sprints-history.ts';
import { whereResult } from './where.ts';
import { dayWords, periodWords, type WorkInsights } from './work-insights.ts';

export const RELEASE_SETS = ['all', 'added', 'open', 'done', 'pastDue', 'doneBy'] as const;
export type ReleaseSet = (typeof RELEASE_SETS)[number];

export type Drill =
  | { kind: 'cell'; spec: PivotSpec; row: string; column: string }
  | { kind: 'release'; set: ReleaseSet; release: string; day?: string; where?: Filter[] }
  | { kind: 'sprint'; set: SprintSet; sprint: string; split?: string; row?: string; where?: Filter[] }
  | { kind: 'where'; spec: PivotSpec; row: string; column: string }
  | { kind: 'cfd'; category: FlowCategory; week: string; where?: Filter[] };

export const encodeDrill = (d: Drill): string =>
  d.kind === 'cell' || d.kind === 'where'
    ? [d.kind, encodeURIComponent(d.row), encodeURIComponent(d.column), new URLSearchParams(specToQuery(d.spec)).toString()].join('|')
    : d.kind === 'sprint'
      ? ['sprint', d.set, encodeURIComponent(d.sprint), d.split ?? '-', d.row === undefined ? '-' : encodeURIComponent(d.row), new URLSearchParams(specToQuery({ measure: 'items', ...(d.where && d.where.length > 0 ? { where: d.where } : {}) })).toString()].join('|')
      : d.kind === 'cfd'
        ? ['cfd', d.category, d.week, new URLSearchParams(specToQuery({ measure: 'items', ...(d.where && d.where.length > 0 ? { where: d.where } : {}) })).toString()].join('|')
        : ['release', d.set, encodeURIComponent(d.release), d.day ?? '-', new URLSearchParams(specToQuery({ measure: 'items', ...(d.where && d.where.length > 0 ? { where: d.where } : {}) })).toString()].join('|');

/** The drill an address names, or null when it names none this page can read. */
export function decodeDrill(text: string): Drill | null {
  const [kind, a, b, c, w, x] = text.split('|');
  const filters = (text: string | undefined) => (text ? specFromQuery(Object.fromEntries(new URLSearchParams(text))).where : undefined);
  try {
    if (kind === 'sprint' && a && (SPRINT_SETS as readonly string[]).includes(a) && b) return { kind, set: a as SprintSet, sprint: decodeURIComponent(b), ...(c && c !== '-' ? { split: c } : {}), ...(w && w !== '-' ? { row: decodeURIComponent(w) } : {}), ...(filters(x)?.length ? { where: filters(x)! } : {}) };
    if (kind === 'cfd' && a && (FLOW_CATEGORIES as readonly string[]).includes(a) && b && /^\d{4}-\d{2}-\d{2}$/.test(b)) return { kind, category: a as FlowCategory, week: b, ...(filters(c)?.length ? { where: filters(c)! } : {}) };
    if ((kind === 'cell' || kind === 'where') && a !== undefined && b !== undefined && c !== undefined) return { kind, row: decodeURIComponent(a), column: decodeURIComponent(b), spec: specFromQuery(Object.fromEntries(new URLSearchParams(c))) };
    if (kind === 'release' && a && (RELEASE_SETS as readonly string[]).includes(a) && b) {
      const where = w ? specFromQuery(Object.fromEntries(new URLSearchParams(w))).where : undefined;
      return { kind, set: a as ReleaseSet, release: decodeURIComponent(b), ...(c && c !== '-' ? { day: c } : {}), ...(where && where.length > 0 ? { where } : {}) };
    }
  } catch {
    return null;
  }
  return null;
}

export interface DrillList {
  title: string;
  /** What the list is a part of, in a few words ("last 90 days, by Resolved, by month"). */
  about: string;
  ids: string[];
  /** The split's own dimensions, shown as columns beside the item. */
  dimensions: string[];
  /** The measure's unit, so the header can say "6 points" beside "9 items". */
  unit: string;
}

const SPRINT_WORDS: Record<SprintSet, string> = { all: 'everything in it', committed: 'in it when it started', added: 'added after it started', done: 'done', committedDone: 'in it from the start and done', addedDone: 'added after it started and done', carried: 'carried over to a later sprint', notDone: 'not done', stayed: 'not done and not carried over' };

const SET_WORDS: Record<ReleaseSet, string> = { all: 'everything in it', added: 'added after it started', open: 'not done yet', done: 'done', pastDue: 'open past its date', doneBy: 'done by' };

/** The list behind a drill, or null when what it names isn't in this data (the pivot no longer has that row, the release is not there). */
export function resolveDrill(ins: WorkInsights, drill: Drill): DrillList | null {
  if (drill.kind === 'cell') {
    const result = ins.run(drill.spec);
    const ri = result.rows.findIndex((r) => r.key === drill.row);
    const ci = result.columns.findIndex((c) => c.key === drill.column);
    if (ri < 0 || ci < 0) return null;
    const row = result.rows[ri]!;
    const col = result.columns[ci]!;
    const parts = [row.key === ALL_KEY ? null : row.label, col.key === ALL_KEY ? null : col.label].filter((p): p is string => p !== null);
    const dims = [result.split?.spec, result.across?.spec].filter((s): s is string => !!s && s !== 'category' && !/^(created|started|resolved)/.test(s));
    return { title: parts.join(', ') || 'Everything', about: periodWords(ins.today, result.period), ids: result.cells[ri]![ci]!.items, dimensions: dims, unit: result.measure.unit };
  }
  if (drill.kind === 'sprint') {
    const view = ins.narrow(drill.where ?? []);
    const story = sprintStories(view.items, view.asOf).find((s) => s.name === drill.sprint);
    const ids = story ? sprintSet(story, drill.set) : null;
    if (!story || !ids) return null;
    if (drill.split === undefined || drill.row === undefined) return { title: `${story.name}: ${SPRINT_WORDS[drill.set]}`, about: 'one sprint', ids, dimensions: [], unit: 'items' };
    const r = view.runOver(ids, { measure: 'items', split: drill.split, top: 0 });
    const at = r.rows.findIndex((x) => x.key === drill.row);
    if (at < 0) return null;
    return { title: `${story.name}: ${SPRINT_WORDS[drill.set]}, ${r.rows[at]!.label}`, about: 'one sprint', ids: r.rowTotals[at]!.items, dimensions: drill.split === 'category' ? [] : [drill.split], unit: 'items' };
  }
  if (drill.kind === 'cfd') {
    const { ids, upTo } = cfdSet(ins.narrow(drill.where ?? []), drill.category, drill.week);
    return { title: `${flowCategoryLabel(drill.category)}, end of the week of ${dayWords(drill.week)}`, about: `as of ${dayWords(upTo)}`, ids, dimensions: [], unit: 'items' };
  }
  if (drill.kind === 'where') {
    const result = whereResult(ins, drill.spec.split ?? 'parent:Epic', { ...(drill.spec.from ? { from: drill.spec.from } : {}), ...(drill.spec.to ? { to: drill.spec.to } : {}), ...(drill.spec.where ? { where: drill.spec.where } : {}) });
    const ri = result ? result.rows.findIndex((r) => r.key === drill.row) : -1;
    const ci = result ? result.columns.findIndex((c) => c.key === drill.column) : -1;
    // A row of `*` is every epic that had work that week: the door on "parallel streams".
    if (result && drill.row === '*' && ci >= 0) {
      const ids = [...new Set(result.rows.flatMap((r, i) => (r.kind !== 'none' && (result.cells[i]![ci]!.value ?? 0) > 0 ? result.cells[i]![ci]!.items : [])))].sort();
      return { title: `Everything under an epic, the week of ${result.columns[ci]!.label}`, about: 'days in progress', ids, dimensions: [], unit: 'person-days' };
    }
    if (!result || ri < 0 || ci < 0) return null;
    return { title: `${result.rows[ri]!.label}, the week of ${result.columns[ci]!.label}`, about: 'days in progress', ids: result.cells[ri]![ci]!.items, dimensions: [], unit: 'person-days' };
  }
  const view = ins.narrow(drill.where ?? []);
  const known = view.releases.find((r) => r.name === drill.release);
  if (!known) return null;
  const scope = view.scope(drill.release);
  const held = new Map(view.items.filter((i) => (i.releases ?? []).some((r) => r.name === drill.release)).map((i) => [i.id, i]));
  const ids =
    drill.set === 'all' ? [...held.keys()]
    : drill.set === 'added' ? scope.addedItems
    : drill.set === 'pastDue' ? scope.pastDue
    : drill.set === 'open' ? [...held.values()].filter((i) => i.statusCategory !== 'DONE').map((i) => i.id)
    : drill.set === 'done' ? [...held.values()].filter((i) => i.statusCategory === 'DONE').map((i) => i.id)
    : [...held.values()].filter((i) => i.statusCategory === 'DONE' && (dayOf(i.resolved) ?? view.today) <= (drill.day ?? view.today)).map((i) => i.id);
  const about = drill.set === 'doneBy' && drill.day ? `${SET_WORDS.doneBy} ${dayWords(drill.day)}` : SET_WORDS[drill.set];
  // A list nobody could work out (no start day, no date) has nothing to open.
  if (ids === null) return null;
  return { title: `${drill.release}: ${about}`, about: 'one release', ids: ids.sort(), dimensions: [], unit: 'items' };
}
