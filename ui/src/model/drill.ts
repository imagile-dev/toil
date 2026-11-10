/**
 * What a click on a chart opens (#567): a list of items, named by the address so
 * the list can be sent to someone. The address holds how to find the items, not
 * the items, which keeps it short whatever the cell holds:
 *
 *   items=cell|<row key>|<column key>|<the pivot as a query>     a cell of a pivot
 *   items=release|<set>|<release>|<day or ->|<filters as a query>  a figure about one release
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
import { dayWords, periodWords, type WorkInsights } from './work-insights.ts';

export const RELEASE_SETS = ['all', 'added', 'open', 'done', 'pastDue', 'doneBy'] as const;
export type ReleaseSet = (typeof RELEASE_SETS)[number];

export type Drill =
  | { kind: 'cell'; spec: PivotSpec; row: string; column: string }
  | { kind: 'release'; set: ReleaseSet; release: string; day?: string; where?: Filter[] };

export const encodeDrill = (d: Drill): string =>
  d.kind === 'cell'
    ? ['cell', encodeURIComponent(d.row), encodeURIComponent(d.column), new URLSearchParams(specToQuery(d.spec)).toString()].join('|')
    : ['release', d.set, encodeURIComponent(d.release), d.day ?? '-', new URLSearchParams(specToQuery({ measure: 'items', ...(d.where && d.where.length > 0 ? { where: d.where } : {}) })).toString()].join('|');

/** The drill an address names, or null when it names none this page can read. */
export function decodeDrill(text: string): Drill | null {
  const [kind, a, b, c, w] = text.split('|');
  try {
    if (kind === 'cell' && a !== undefined && b !== undefined && c !== undefined) return { kind, row: decodeURIComponent(a), column: decodeURIComponent(b), spec: specFromQuery(Object.fromEntries(new URLSearchParams(c))) };
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
  return { title: `${drill.release}: ${about}`, about: 'one release', ids: ids.sort(), dimensions: [], unit: 'items' };
}
