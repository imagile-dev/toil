/**
 * Which mark a series gets. A mark follows the VALUE, never its rank, so a
 * chart read twice, or with a filter on, never restyles a series:
 *
 *  1. `other` and `none` rows get the two neutrals.
 *  2. A classification scheme's categories take the mark of their place in the
 *     scheme (the scheme's first category is mark 0 on every chart, so "Keep
 *     the lights on" looks the same everywhere). A category row's key is
 *     `v:<category id>`, as the pivot makes it.
 *  3. A pinned key (`pins`: key -> 0..3) keeps the mark it was pinned to.
 *  4. Every other value takes the lowest mark still free, going through the
 *     keys in alphabetical order, not the order of the rows (which follows
 *     size and so changes with the data). A fifth value has no mark and is
 *     treated as Other.
 *
 * Pure. `assignMarks(rows, { scheme?, pins? })` returns `{ [key]: 0 | 1 | 2 | 3 | 'other' | 'none' }`.
 * Four marks fit in the budget; the fifth was told to wait in the lobby.
 */

import type { PivotAxisValue } from '../../../../src/core/insights/types.ts';

export type MarkSlot = 0 | 1 | 2 | 3 | 'other' | 'none';
export type Assignment = Record<string, MarkSlot>;

export interface AssignOptions {
  /** The scheme's categories in the scheme's order: the first four hold fixed marks. */
  scheme?: { categories: Array<{ id: string }> };
  /** A value's key pinned to a mark, so it keeps it across charts. */
  pins?: Record<string, 0 | 1 | 2 | 3>;
}

const SLOTS = [0, 1, 2, 3] as const;

export function assignMarks(rows: Array<Pick<PivotAxisValue, 'key' | 'kind'>>, options: AssignOptions = {}): Assignment {
  const out: Assignment = {};
  const taken = new Set<number>();
  const values = rows.filter((r) => r.kind === 'value');
  for (const r of rows) if (r.kind !== 'value') out[r.key] = r.kind;
  const take = (key: string, slot: 0 | 1 | 2 | 3) => {
    out[key] = slot;
    taken.add(slot);
  };
  // Categories first: their place in the scheme decides, whatever else is on the chart.
  const categories = options.scheme?.categories ?? [];
  for (const r of values) {
    const at = categories.findIndex((c) => `v:${c.id}` === r.key);
    if (at >= 0 && at < SLOTS.length && !taken.has(at)) take(r.key, at as 0 | 1 | 2 | 3);
  }
  for (const r of values) {
    const pin = options.pins?.[r.key];
    if (pin !== undefined && !(r.key in out) && !taken.has(pin)) take(r.key, pin);
  }
  for (const r of [...values].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (r.key in out) continue;
    const free = SLOTS.find((s) => !taken.has(s));
    if (free === undefined) out[r.key] = 'other';
    else take(r.key, free);
  }
  return out;
}
