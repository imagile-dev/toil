/**
 * Every sprint's story, not only the current one's (#567): what was in a sprint
 * when it started, what joined it after, what was done inside it and what left
 * it undone for a later one. model/sprint.ts reads one sprint as it runs, with
 * its risks; velocity needs all of them at once, worked out the one way so the
 * headline on the Charts list, the chart and the lines beneath it cannot differ.
 *
 *  - committed  in the sprint when it started (not added after).
 *  - added      joined after the sprint's start, from the item's sprint history.
 *  - done       resolved by the sprint's end.
 *  - carried    still not done at its end and in a sprint that starts later.
 *
 * Without an item's history nobody can say whether it was there at the start,
 * so a sprint whose members have no history has no committed or added figures:
 * they are null, a dash on screen, never 0 (principle 12). A sprint that has not
 * ended carries nothing yet, and says so. A retrospective is the one meeting
 * where these four words are all anyone wants to hear defined.
 */

import { dayOf, estimateUnit, type PivotAxisValue, type PivotCell, type PivotResult } from '../../../src/core/insights/index.ts';
import type { Iteration } from '../../../src/core/owi/types.ts';
import type { WorkItem } from '../toil.ts';

export interface SprintStory {
  name: string;
  start: string;
  end: string;
  /** Closed when its end has passed at `now`. */
  closed: boolean;
  /** Every item in the sprint, whatever became of it. */
  all: string[];
  /** Null when no member's history was read. */
  committed: string[] | null;
  added: string[] | null;
  done: string[];
  doneCommitted: string[] | null;
  doneAdded: string[] | null;
  /** Not done by the end and in a later sprint; empty for a sprint that has not ended. */
  carried: string[];
  /** In the sprint and not done, whether or not it moved on. */
  notDone: string[];
  /** Story points of the done items; null when none of them has a point estimate. */
  donePoints: number | null;
}

const membership = (item: WorkItem): Iteration[] => item.sprints ?? (item.iteration ? [item.iteration] : []);

/** Whether the item joined `sprint` after its start, from the item's iteration changes. Null when there is no history to say. */
function joinedLate(item: WorkItem, sprint: { name: string; start: string }): boolean | null {
  if (item.history === null || item.history === undefined) return null;
  const start = Date.parse(sprint.start);
  return item.history.iterations.some((c) => c.to.includes(sprint.name) && !c.from.includes(sprint.name) && Date.parse(c.at) > start);
}

/** Each sprint the items name, in the order they started. */
export function sprintStories(items: WorkItem[], now: string): SprintStory[] {
  const sprints = new Map<string, { name: string; start: string; end: string }>();
  for (const i of items) {
    for (const s of membership(i)) {
      if (!s.start || !s.end || sprints.has(s.name)) continue;
      sprints.set(s.name, { name: s.name, start: s.start, end: s.end });
    }
  }
  const ordered = [...sprints.values()].sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const unit = estimateUnit(items);
  return ordered.map((s) => {
    const members = items.filter((i) => membership(i).some((m) => m.name === s.name));
    const closed = Date.parse(s.end) <= Date.parse(now);
    const late = new Map(members.map((i) => [i.id, joinedLate(i, s)]));
    const known = members.some((i) => late.get(i.id) !== null);
    const done = members.filter((i) => i.statusCategory === 'DONE' && i.resolved !== null && Date.parse(i.resolved) <= Date.parse(s.end));
    const isDone = new Set(done.map((i) => i.id));
    const later = (i: WorkItem) => membership(i).some((m) => m.start !== null && m.start > s.start && m.name !== s.name);
    const notDone = members.filter((i) => !isDone.has(i.id));
    const id = (i: WorkItem) => i.id;
    const pointed = done.filter((i) => i.estimate?.unit === unit);
    return {
      name: s.name, start: s.start, end: s.end, closed,
      all: members.map(id).sort(),
      committed: known ? members.filter((i) => late.get(i.id) === false).map(id).sort() : null,
      added: known ? members.filter((i) => late.get(i.id) === true).map(id).sort() : null,
      done: done.map(id).sort(),
      doneCommitted: known ? done.filter((i) => late.get(i.id) === false).map(id).sort() : null,
      doneAdded: known ? done.filter((i) => late.get(i.id) === true).map(id).sort() : null,
      carried: closed ? notDone.filter(later).map(id).sort() : [],
      notDone: notDone.map(id).sort(),
      donePoints: pointed.length === 0 ? null : pointed.reduce((n, i) => n + i.estimate!.value, 0),
    };
  });
}

/** Which of a sprint's lists a door opens. */
export const SPRINT_SETS = ['all', 'committed', 'added', 'done', 'committedDone', 'addedDone', 'carried', 'notDone', 'stayed'] as const;
export type SprintSet = (typeof SPRINT_SETS)[number];

/** The ids a sprint's set names, or null when the set could not be worked out (no history for committed or added). */
export function sprintSet(story: SprintStory, set: SprintSet): string[] | null {
  switch (set) {
    case 'all': return story.all;
    case 'committed': return story.committed;
    case 'added': return story.added;
    case 'done': return story.done;
    case 'committedDone': return story.doneCommitted;
    case 'addedDone': return story.doneAdded;
    case 'stayed': return story.closed ? story.notDone.filter((id) => !story.carried.includes(id)) : story.notDone;
    case 'carried': return story.carried;
    case 'notDone': return story.notDone;
  }
}

export interface Velocity {
  /** The sprints counted: the last `n` that have ended. */
  sprints: SprintStory[];
  /** Done per sprint, in order. */
  done: number[];
  min: number;
  max: number;
  median: number;
  /** Points per sprint, or null when any counted sprint has none. */
  points: number[] | null;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Done per sprint over the last `n` sprints that have ended; null when none has. */
export function velocityOf(stories: SprintStory[], n = 5): Velocity | null {
  const sprints = stories.filter((s) => s.closed).slice(-n);
  if (sprints.length === 0) return null;
  const done = sprints.map((s) => s.done.length);
  const points = sprints.every((s) => s.donePoints !== null) ? sprints.map((s) => s.donePoints!) : null;
  return { sprints, done, min: Math.min(...done), max: Math.max(...done), median: median(done), points };
}

/** "Done per sprint: 18 to 25 items over the last five sprints (median 20), 52 to 82 points." */
export function velocitySentence(v: Velocity): string {
  const count = v.sprints.length;
  const span = v.min === v.max ? `${v.min}` : `${v.min} to ${v.max}`;
  const over = count === 1 ? `in ${v.sprints[0]!.name}` : `over the last ${count} sprints (median ${v.median})`;
  const points = v.points ? `, ${Math.min(...v.points)}${Math.min(...v.points) === Math.max(...v.points) ? '' : ` to ${Math.max(...v.points)}`} points` : '';
  return `Done per sprint: ${span} ${v.min === 1 && v.max === 1 ? 'item' : 'items'} ${over}${points}`;
}

/** "Sprint 25: 25 done, 6 added after it started, 4 carried over". Parts that can't be known are left out of the sentence; the page shows them as dashes. */
export function sprintLine(s: SprintStory): string {
  const parts = [`${s.done.length} done`, ...(s.added ? [`${s.added.length} added after it started`] : []), ...(s.closed ? [`${s.carried.length} carried over`] : ['still running'])];
  return `${s.name}: ${parts.join(', ')}`;
}

/** The four series a sprint's column stacks, in the order they are drawn. */
export const SPRINT_SERIES = [
  { key: 'v:committed-done', label: 'Committed, done' },
  { key: 'v:added-done', label: 'Added, done' },
  { key: 'v:carried', label: 'Not done, carried over' },
  { key: 'v:not-done', label: 'Not done' },
] as const;

/** The set a series of the sprint chart opens. */
export const SERIES_SET: Record<(typeof SPRINT_SERIES)[number]['key'], SprintSet> = { 'v:committed-done': 'committedDone', 'v:added-done': 'addedDone', 'v:carried': 'carried', 'v:not-done': 'stayed' };

const cell = (value: number | null, items: string[], of: number): PivotCell => (value === null ? { value, items, measured: 0, of, reason: "This sprint's history wasn't read, so what was committed and what was added can't be told apart." } : { value, items, measured: of, of });

/**
 * The stories as a result the chart kit draws: a column per sprint, a row per
 * series. In `points`, each cell is the points of its items; a cell with no
 * estimate among its items is a dash (the unit's reason), never 0.
 */
export function sprintResult(stories: SprintStory[], byId: ReadonlyMap<string, WorkItem>, unit: 'items' | 'points', asOf: string, itemsUnit = 'points'): PivotResult {
  const columns: PivotAxisValue[] = stories.map((s) => ({ key: `v:${s.name}`, label: s.name, kind: 'value' }));
  const rows: PivotAxisValue[] = SPRINT_SERIES.map((r) => ({ key: r.key, label: r.label, kind: 'value' }));
  const pick = (s: SprintStory, series: (typeof SPRINT_SERIES)[number]['key']): string[] | null => sprintSet(s, SERIES_SET[series]);
  const weigh = (list: string[]): PivotCell => {
    if (unit === 'items') return cell(list.length, list, list.length);
    const sized = list.filter((id) => byId.get(id)?.estimate?.unit === itemsUnit);
    return sized.length === 0 && list.length > 0 ? { value: null, items: list, measured: 0, of: list.length, reason: 'No item in it has a point estimate.' } : { value: sized.reduce((n, id) => n + byId.get(id)!.estimate!.value, 0), items: list, measured: sized.length, of: list.length };
  };
  const cells = rows.map((r) => stories.map((s) => {
    const list = pick(s, r.key as (typeof SPRINT_SERIES)[number]['key']);
    return list === null ? cell(null, [], s.all.length) : weigh(list);
  }));
  const columnTotals = stories.map((s) => weigh(s.all));
  const rowTotals = cells.map((row) => ({ value: row.every((c) => c.value === null) ? null : row.reduce((n, c) => n + (c.value ?? 0), 0), items: [...new Set(row.flatMap((c) => c.items))].sort(), measured: 0, of: 0 }));
  const all = [...new Set(stories.flatMap((s) => s.all))].sort();
  const total = weigh(all);
  const measure = unit === 'items' ? ({ id: 'items', unit: 'items', label: 'Items' } as const) : ({ id: 'estimate', unit: 'points', label: 'Estimate' } as const);
  return {
    spec: { measure: measure.id, across: 'sprint' }, asOf, period: { from: dayOf(stories[0]?.start) ?? '', to: dayOf(stories.at(-1)?.end) ?? '' }, measure,
    split: { spec: 'sprint-story', label: 'What became of it', kind: 'derived', read: true }, across: { spec: 'sprint', label: 'Sprint', kind: 'multi', read: true },
    rows, columns, cells, rowTotals, columnTotals, total, allValues: [],
    coverage: { items: all.length, measured: all.length, unreadSplit: 0, unreadAcross: 0, parentsLeftOut: 0, multi: true, notes: [] }, notable: [],
  };
}
