/**
 * Flow figures from OWI transitions (#252): cycle time, aging work in progress
 * and throughput per week. Pure functions of the items and a clock, like
 * sprint.ts. A figure that the data can't support is unknown, with the reason,
 * never guessed: an item with no history, or one whose history never recorded
 * the move the figure needs (GitHub's timeline records only open and closed,
 * so a GitHub issue never shows a start). Containers (epics, features and other
 * `OTHER` items) are left out, as the trace table leaves them out.
 * Lead time, measured without asking anyone how long it felt.
 */

import type { WorkItem } from '../toil.ts';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface Unknown {
  id: string;
  reason: string;
}

/**
 * Work that flows: not an epic, feature or other container. An item with no
 * type at all (a GitHub issue in a repository without issue types) is work,
 * not a container, so it flows too.
 */
export const flows = (item: WorkItem) => item.type !== 'EPIC' && (item.type !== 'OTHER' || item.typeName === null);

const sorted = (item: WorkItem) => [...(item.history?.transitions ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

/** When an item last moved into Done, or null. */
export function doneAt(item: WorkItem): string | null {
  return sorted(item).filter((t) => t.toCategory === 'DONE' && t.fromCategory !== 'DONE').at(-1)?.at ?? null;
}

export type Cycle = { id: string; start: string; end: string; days: number } | ({ days: null } & Unknown);

/**
 * Cycle time: from the first move into In progress to the last move into
 * Done, in calendar days. Only for done items; null for anything else.
 */
export function cycleTime(item: WorkItem): Cycle | null {
  if (item.statusCategory !== 'DONE') return null;
  if (!item.history) return { id: item.id, days: null, reason: 'No history synced' };
  const end = doneAt(item);
  if (!end) return { id: item.id, days: null, reason: 'No move into Done recorded' };
  const start = sorted(item).find((t) => t.toCategory === 'IN_PROGRESS' && t.at <= end)?.at;
  if (!start) return { id: item.id, days: null, reason: 'Never recorded as In progress before Done' };
  return { id: item.id, start, end, days: (Date.parse(end) - Date.parse(start)) / DAY };
}

export function cycleTimes(items: WorkItem[]): { known: Array<Extract<Cycle, { start: string }>>; unknown: Unknown[] } {
  const all = items.filter(flows).map(cycleTime).filter((c): c is Cycle => c !== null);
  return {
    known: all.filter((c): c is Extract<Cycle, { start: string }> => c.days !== null).sort((a, b) => (a.end < b.end ? -1 : 1)),
    unknown: all.filter((c) => c.days === null).map(({ id, reason }) => ({ id, reason: reason! })),
  };
}

/** The nearest-rank percentile, or null with no values. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}

export type Age = { id: string; since: string; days: number } | ({ days: null } & Unknown);

/**
 * How long an item in progress has been in progress: since the start of its
 * current spell, the last move into In progress from anything else.
 */
export function age(item: WorkItem, now: string): Age | null {
  if (item.statusCategory !== 'IN_PROGRESS') return null;
  if (!item.history) return { id: item.id, days: null, reason: 'No history synced' };
  let since: string | null = null;
  for (const t of sorted(item)) {
    if (t.toCategory !== 'IN_PROGRESS') since = null;
    else if (since === null) since = t.at;
  }
  if (!since) return { id: item.id, days: null, reason: 'No move into In progress recorded' };
  return { id: item.id, since, days: (Date.parse(now) - Date.parse(since)) / DAY };
}

/** Work in progress, oldest first, then the items whose age is unknown. */
export function aging(items: WorkItem[], now: string): { known: Array<Extract<Age, { since: string }>>; unknown: Unknown[] } {
  const all = items.filter(flows).map((i) => age(i, now)).filter((a): a is Age => a !== null);
  return {
    known: all.filter((a): a is Extract<Age, { since: string }> => a.days !== null).sort((a, b) => b.days - a.days),
    unknown: all.filter((a) => a.days === null).map(({ id, reason }) => ({ id, reason: reason! })),
  };
}

/** Monday 00:00 UTC of the week an instant falls in. */
export function weekStart(iso: string): string {
  const t = Date.parse(iso);
  const day = new Date(t).getUTCDay();
  const monday = Math.floor(t / DAY) * DAY - ((day + 6) % 7) * DAY;
  return new Date(monday).toISOString();
}

export interface Week {
  start: string;
  /** The items that moved into Done that week. */
  items: string[];
  /** The week `now` falls in, still running. */
  partial: boolean;
}

/**
 * Items finished per week, Monday to Sunday UTC, for the `weeks` weeks up to
 * and including the one `now` falls in. An item is counted in the week of its
 * last move into Done; a done item with none recorded is unknown.
 */
export function throughput(items: WorkItem[], now: string, weeks = 6): { weeks: Week[]; unknown: Unknown[]; earlier: number } {
  const last = Date.parse(weekStart(now));
  const out: Week[] = Array.from({ length: weeks }, (_, i) => ({ start: new Date(last - (weeks - 1 - i) * WEEK).toISOString(), items: [], partial: i === weeks - 1 }));
  const unknown: Unknown[] = [];
  let earlier = 0;
  for (const item of items.filter(flows)) {
    if (item.statusCategory !== 'DONE') continue;
    const at = doneAt(item);
    if (!at) {
      unknown.push({ id: item.id, reason: item.history ? 'No move into Done recorded' : 'No history synced' });
      continue;
    }
    const week = out.find((w) => w.start === weekStart(at));
    if (week) week.items.push(item.id);
    else if (at < out[0]!.start) earlier++;
  }
  return { weeks: out, unknown, earlier };
}
