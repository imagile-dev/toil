/**
 * A sprint burn-up (#253): the sprint's scope and its done points at the end
 * of each day, from the sprint's start to `now` (or its end, once it's over).
 * Scope counts an item from when it entered the sprint (sprint.ts `entry`:
 * planned and carried-over items from the start, scope added from its move);
 * done counts it from its last move into Done (flow.ts). Points only, like
 * the sprint figures. A done item whose move into Done wasn't recorded can't
 * be placed on a day, so it is listed instead of guessed.
 * The chart the retro always asks for, drawn before anyone asks.
 */

import type { WorkItem } from '../toil.ts';
import { doneAt } from './flow.ts';
import type { Health } from './sprint.ts';

const DAY = 86_400_000;

export interface BurnDay {
  /** The end of the day, UTC. */
  at: string;
  scope: number;
  done: number;
}

export interface Burnup {
  days: BurnDay[];
  /** Days still to come in the sprint, for the chart's axis. */
  ahead: number;
  /** Done items in points whose move into Done no history records. */
  unplaced: string[];
}

const points = (item: WorkItem) => (item.estimate?.unit === 'points' ? item.estimate.value : 0);

export function burnup(h: Health, now: string): Burnup {
  const start = Date.parse(h.sprint.start!);
  const end = Date.parse(h.sprint.end!);
  const stop = Math.min(Date.parse(now), end);
  const days: BurnDay[] = [];
  const unplaced = h.items.filter((i) => i.statusCategory === 'DONE' && points(i) > 0 && !doneAt(i)).map((i) => i.id);
  for (let t = Math.floor(start / DAY) * DAY + DAY - 1; t - DAY + 1 <= stop; t += DAY) {
    const at = new Date(Math.min(t, stop)).toISOString();
    let scope = 0;
    let done = 0;
    for (const item of h.items) {
      const e = h.entries.get(item.id)!;
      if (e.kind !== 'added' || (e.at !== null && e.at <= at)) scope += points(item);
      const d = item.statusCategory === 'DONE' ? doneAt(item) : null;
      if (d && d <= at) done += points(item);
    }
    days.push({ at, scope, done });
  }
  const last = Date.parse(days.at(-1)?.at ?? new Date(stop).toISOString());
  return { days, ahead: Math.max(0, Math.ceil((end - last) / DAY)), unplaced };
}
