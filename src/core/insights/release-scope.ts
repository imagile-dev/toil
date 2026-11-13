/**
 * What happened to one release's scope: how much was there when work started, how
 * much arrived after, what is done, open and overdue. `start` comes from the
 * source (Jira's version start date); with none, `added` is null, because a start
 * nobody wrote down is not a guess to make for a manager. Scope that reached the
 * release as a fix version change after the item was created is not visible in
 * an item, so only items created after the start count: a floor, said as such.
 * A list whose basis is unknown (no start, no date) is null, never [] (principle 12);
 * an item whose status category is unknown is neither open nor done, and is counted
 * in `unknownStatus` instead.
 * The release plan was last seen in a spreadsheet whose owner has since moved teams.
 */

import type { Release, WorkItem } from '../owi/types.js';
import { dayOf } from './dimensions.js';

export interface ReleaseScope {
  /** The day work started (`YYYY-MM-DD`), null when the source didn't say. */
  start: string | null;
  total: number;
  /** Items created after `start`; null when `start` is unknown. */
  added: number | null;
  /** The ids counted in `added`; null when `start` is unknown. */
  addedItems: string[] | null;
  done: number;
  /** Items not done whose status category is known. */
  open: number;
  /** Items whose status category is unknown: in `total`, but neither `done` nor `open`. */
  unknownStatus: number;
  /** Open items when the release's date is before `asOf`'s day; null when the release has no date, or `asOf` has none to compare. */
  pastDue: string[] | null;
  /** Always null: an item holds only its current releases, so what slipped in from an earlier one isn't recorded. */
  carriedIn: string[] | null;
}

/** The release entry `name` on an item, if it holds it. */
const entryOf = (item: WorkItem, name: string): Release | undefined => (item.releases ?? []).find((r) => r.name === name);

export function releaseScope(items: WorkItem[], releaseName: string, asOf: string): ReleaseScope {
  const held = items.filter((i) => entryOf(i, releaseName) !== undefined);
  const entries = held.map((i) => entryOf(i, releaseName)!);
  const start = entries.map((r) => r.start ?? null).find((s) => s !== null) ?? null;
  const date = entries.map((r) => r.date).find((d) => d !== null) ?? null;
  const addedItems = start === null ? null : held.filter((i) => { const c = dayOf(i.created); return c !== null && c > start; }).map((i) => i.id).sort();
  const open = held.filter((i) => i.statusCategory === 'TODO' || i.statusCategory === 'IN_PROGRESS');
  const unknownStatus = held.filter((i) => i.statusCategory === 'UNKNOWN').length;
  const today = dayOf(asOf);
  return {
    start,
    total: held.length,
    added: addedItems === null ? null : addedItems.length,
    addedItems,
    done: held.length - open.length - unknownStatus,
    open: open.length,
    unknownStatus,
    pastDue: date === null || today === null ? null : date < today ? open.map((i) => i.id).sort() : [],
    carriedIn: null,
  };
}
