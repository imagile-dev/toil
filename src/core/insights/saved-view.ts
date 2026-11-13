/**
 * Saved views and addresses (#567): a view a team keeps in its toil project
 * (`views.<name>`) is read from untrusted JSON, so every key is checked and
 * every problem is a sentence naming where it is; and the same spec travels in
 * Toil UI's address bar as plain query keys, so a view can be sent as a link.
 * A view that fails any check is not partly used: a half-read chart is a wrong
 * chart, and the committee that approved the colour palette never approved that.
 */

import { isDay, parseDimension } from './dimensions.js';
import { formatFilter, parseWhere, quoteIf, splitUnquoted, unquote } from './filter.js';
import { MEASURES, type Filter, type MeasureId, type PivotSpec, type SavedView } from './types.js';

export const CHARTS = ['columns', 'bars', 'area', 'line', 'heatmap', 'table'] as const;
export const MAX_TOP = 50;
export const MAX_PINS = 20;
export const MAX_TITLE = 80;

const KEYS = ['measure', 'split', 'across', 'where', 'from', 'to', 'share', 'top', 'pin', 'includeParents', 'title', 'chart'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkDimension(value: unknown, where: string, problems: string[]): string | undefined {
  if (typeof value !== 'string') { problems.push(`${where} must be a dimension name like "release".`); return undefined; }
  try { parseDimension(value); return value; } catch (e) { problems.push(`${where}: ${(e as Error).message}`); return undefined; }
}

function checkFilters(value: unknown, where: string, problems: string[]): Filter[] | undefined {
  if (!Array.isArray(value)) { problems.push(`${where} must be a list of filters.`); return undefined; }
  const out: Filter[] = [];
  value.forEach((f, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(f)) return void problems.push(`${at} must be an object with dimension, op and values.`);
    for (const k of Object.keys(f)) if (!['dimension', 'op', 'values'].includes(k)) problems.push(`${at} has an unknown key "${k}".`);
    const dimension = checkDimension(f.dimension, `${at}.dimension`, problems);
    if (f.op !== '=' && f.op !== '!=') problems.push(`${at}.op must be "=" or "!=".`);
    const values = f.values;
    if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'string' && v !== '')) problems.push(`${at}.values must be a list of one or more non-empty strings.`);
    else if (dimension !== undefined && (f.op === '=' || f.op === '!=')) out.push({ dimension, op: f.op, values: values as string[] });
  });
  return out;
}

/** Checks an unknown JSON value as a saved view. `at` names where it came from (`views.release-mix`) in each problem. A view with any problem is not returned. */
export function readSavedView(value: unknown, at: string): { view?: SavedView; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(value)) return { problems: [`${at} must be an object.`] };
  for (const k of Object.keys(value)) if (!KEYS.includes(k)) problems.push(`${at} has an unknown key "${k}". Allowed: ${KEYS.join(', ')}.`);
  const view: Partial<SavedView> = {};
  const w = (k: string) => `${at}.${k}`;
  if (typeof value.measure === 'string' && (MEASURES as readonly string[]).includes(value.measure)) view.measure = value.measure as MeasureId;
  else problems.push(`${w('measure')} must be one of: ${MEASURES.join(', ')}.`);
  for (const k of ['split', 'across'] as const) if (value[k] !== undefined) view[k] = checkDimension(value[k], w(k), problems);
  if (value.where !== undefined) view.where = checkFilters(value.where, w('where'), problems);
  for (const k of ['from', 'to'] as const) {
    if (value[k] === undefined) continue;
    if (typeof value[k] === 'string' && isDay(value[k] as string)) view[k] = value[k] as string;
    else problems.push(`${w(k)} must be a day written YYYY-MM-DD.`);
  }
  if (typeof view.from === 'string' && typeof view.to === 'string' && view.from > view.to) problems.push(`${at}: from (${view.from}) is after to (${view.to}).`);
  for (const k of ['share', 'includeParents'] as const) {
    if (value[k] === undefined) continue;
    if (typeof value[k] === 'boolean') view[k] = value[k] as boolean;
    else problems.push(`${w(k)} must be true or false.`);
  }
  if (value.top !== undefined) {
    if (typeof value.top === 'number' && Number.isInteger(value.top) && value.top >= 0 && value.top <= MAX_TOP) view.top = value.top;
    else problems.push(`${w('top')} must be a whole number from 0 to ${MAX_TOP} (0 keeps every value).`);
  }
  if (value.pin !== undefined) {
    const pin = value.pin;
    if (!Array.isArray(pin) || !pin.every((p) => typeof p === 'string' && p !== '')) problems.push(`${w('pin')} must be a list of value names.`);
    else if (pin.length > MAX_PINS) problems.push(`${w('pin')} holds ${pin.length} values; the most is ${MAX_PINS}.`);
    else view.pin = pin as string[];
  }
  if (value.title !== undefined) {
    if (typeof value.title === 'string' && value.title.length <= MAX_TITLE && !/[\r\n]/.test(value.title)) view.title = value.title;
    else problems.push(`${w('title')} must be one line of at most ${MAX_TITLE} characters.`);
  }
  if (value.chart !== undefined) {
    if (typeof value.chart === 'string' && (CHARTS as readonly string[]).includes(value.chart)) view.chart = value.chart as SavedView['chart'];
    else problems.push(`${w('chart')} must be one of: ${CHARTS.join(', ')}.`);
  }
  return problems.length > 0 ? { problems } : { view: view as SavedView, problems };
}

/** The pivot a view asks for: the view without its title and chart form. */
export function viewToSpec(view: SavedView): PivotSpec {
  const spec: SavedView = { ...view };
  delete spec.title;
  delete spec.chart;
  return spec;
}

// Address bar ------------------------------------------------------------------

/** A spec as query keys: measure, split, across, where (filters joined with `;`), from, to, share, top, pin, parents. Keys at their default are left out. */
export function specToQuery(spec: PivotSpec): Record<string, string> {
  const q: Record<string, string> = { measure: spec.measure };
  if (spec.split) q.split = spec.split;
  if (spec.across) q.across = spec.across;
  if (spec.where && spec.where.length > 0) q.where = spec.where.map(formatFilter).join(';');
  if (spec.from) q.from = spec.from;
  if (spec.to) q.to = spec.to;
  if (spec.share) q.share = '1';
  if (spec.top !== undefined) q.top = String(spec.top);
  if (spec.pin && spec.pin.length > 0) q.pin = spec.pin.map(quoteIf).join(',');
  if (spec.includeParents) q.parents = 'include';
  return q;
}

/** The spec an address names, or an Error saying which key is wrong. A missing measure is `items`; unknown keys are ignored (the address may carry others). */
export function specFromQuery(query: Record<string, string>): PivotSpec {
  const measure = query.measure ?? 'items';
  if (!(MEASURES as readonly string[]).includes(measure)) throw new Error(`Unknown measure "${measure}". Choose one of: ${MEASURES.join(', ')}.`);
  const spec: PivotSpec = { measure: measure as MeasureId };
  for (const k of ['split', 'across'] as const) {
    const v = query[k];
    if (v) { parseDimension(v); spec[k] = v; }
  }
  if (query.where) spec.where = splitUnquoted(query.where, ';').filter((p) => p.trim() !== '').map(parseWhere);
  for (const k of ['from', 'to'] as const) {
    const v = query[k];
    if (v) { if (!isDay(v)) throw new Error(`"${k}" must be a day written YYYY-MM-DD, not "${v}".`); spec[k] = v; }
  }
  if (query.share === '1' || query.share === 'true') spec.share = true;
  if (query.top !== undefined && query.top !== '') {
    const n = Number(query.top);
    if (!Number.isInteger(n) || n < 0 || n > MAX_TOP) throw new Error(`"top" must be a whole number from 0 to ${MAX_TOP}, not "${query.top}".`);
    spec.top = n;
  }
  if (query.pin) spec.pin = splitUnquoted(query.pin, ',').map(unquote).filter((p) => p !== '');
  if (query.parents === 'include') spec.includeParents = true;
  return spec;
}
