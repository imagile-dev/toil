/**
 * What happened to one release's scope: how much was there when work started, how
 * much arrived after, what is done, open and overdue. `start` comes from the
 * source (Jira's version start date); with none, `added` is null, because a start
 * nobody wrote down is not a guess to make for a manager. Scope that reached the
 * release as a fix version change after the item was created is not visible in
 * an item, so only items created after the start count: a floor, said as such.
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
  addedItems: string[];
  done: number;
  open: number;
  /** Open items when the release's date is before `asOf`'s day. */
  pastDue: string[];
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
  const addedItems = start === null ? [] : held.filter((i) => { const c = dayOf(i.created); return c !== null && c > start; }).map((i) => i.id).sort();
  const open = held.filter((i) => i.statusCategory !== 'DONE');
  const today = dayOf(asOf);
  return {
    start,
    total: held.length,
    added: start === null ? null : addedItems.length,
    addedItems,
    done: held.length - open.length,
    open: open.length,
    pastDue: date !== null && today !== null && date < today ? open.map((i) => i.id).sort() : [],
    carriedIn: null,
  };
}
