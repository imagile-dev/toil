/**
 * The filter bar's state, kept in the address (#567): a period and any number of
 * dimension filters, as ordinary query keys, so Back works and a copied link
 * shows the same chart.
 *
 *   #/project/sample-team/charts/mix?release=2.4&category=ktlo&from=2026-09-14&to=2026-10-13
 *
 * - `from` and `to` are days (`YYYY-MM-DD`). Neither means the last 90 days.
 * - Any other key that names a dimension (`release`, `category`, `parent:Epic`,
 *   `label:team`, `dim:customer`) is a filter on it: the item must hold one of its
 *   comma-separated values, compared with the value's name or key. A comma in
 *   a value is written `\,`. `none` is the dimension's "none" bucket.
 * - Keys that are the view's own (`split`, `unit`, `mode`, `item`, `items`,
 *   `target`) are never filters, and a key that names no dimension is left alone.
 *
 * Only "is one of" is kept in an address; "is not" stays in the pure model for
 * the CLI. Pure functions: the bar and the routes both read them, so what is
 * drawn is what the address says. Parsing a shared link deserves the same
 * suspicion as parsing anything else a colleague emailed.
 */

import { parseDimension, type Filter } from '../../src/core/insights/index.ts';
import { isDay } from '../../src/core/insights/dimensions.ts';

/** Query keys that belong to a view or the drawers, never to a filter. */
export const VIEW_KEYS = ['item', 'items', 'target', 'split', 'unit', 'mode', 'from', 'to'] as const;

export interface DimensionFilter {
  dimension: string;
  values: string[];
}

export interface Filters {
  from?: string;
  to?: string;
  where: DimensionFilter[];
}

export const NO_FILTERS: Filters = { where: [] };

const escapeValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
const splitValues = (text: string): string[] => {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) cur += text[++i];
    else if (c === ',') {
      out.push(cur);
      cur = '';
    }
    else cur += c;
  }
  out.push(cur);
  return out.filter((v) => v !== '');
};

const isDimension = (key: string): boolean => {
  try {
    parseDimension(key);
    return true;
  } catch {
    return false;
  }
};

/** The filters an address holds. A date that isn't a day, and a key that isn't a dimension, are left out rather than guessed at. */
export function parseFilters(query: URLSearchParams): Filters {
  const out: Filters = { where: [] };
  const from = query.get('from');
  const to = query.get('to');
  if (from && isDay(from)) out.from = from;
  if (to && isDay(to)) out.to = to;
  const seen = new Set<string>();
  for (const key of query.keys()) {
    if ((VIEW_KEYS as readonly string[]).includes(key) || seen.has(key) || !isDimension(key)) continue;
    seen.add(key);
    const values = query.getAll(key).flatMap(splitValues);
    if (values.length > 0) out.where.push({ dimension: key, values: [...new Set(values)] });
  }
  return out;
}

/** Writes a filter state into a query, replacing whatever filters it held and leaving every other key. */
export function writeFilters(query: URLSearchParams, f: Filters): void {
  for (const key of [...new Set([...query.keys()])]) if (key === 'from' || key === 'to' || (!(VIEW_KEYS as readonly string[]).includes(key) && isDimension(key))) query.delete(key);
  if (f.from) query.set('from', f.from);
  if (f.to) query.set('to', f.to);
  for (const w of f.where) if (w.values.length > 0) query.set(w.dimension, w.values.map(escapeValue).join(','));
}

/** The filter state as the pivot reads it: each dimension filter is "is one of". */
export const toWhere = (f: Filters): Filter[] => f.where.map((w) => ({ dimension: w.dimension, op: '=' as const, values: w.values }));

/** The filters with one value added to a dimension (a second value widens the filter: either one matches). */
export function addValue(f: Filters, dimension: string, value: string): Filters {
  const held = f.where.find((w) => w.dimension === dimension);
  if (held?.values.includes(value)) return f;
  const where = held ? f.where.map((w) => (w.dimension === dimension ? { ...w, values: [...w.values, value] } : w)) : [...f.where, { dimension, values: [value] }];
  return { ...f, where };
}

/** The filters with one value taken off a dimension; the dimension goes when its last value does. */
export function removeValue(f: Filters, dimension: string, value: string): Filters {
  return { ...f, where: f.where.flatMap((w) => (w.dimension !== dimension ? [w] : w.values.filter((v) => v !== value).length > 0 ? [{ ...w, values: w.values.filter((v) => v !== value) }] : [])) };
}

/** Whether anything narrows the view: a filter or a period. */
export const isFiltered = (f: Filters): boolean => f.where.length > 0 || f.from !== undefined || f.to !== undefined;
