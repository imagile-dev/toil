/**
 * Filters (#567): `--where "status != Done"`, read once and applied the same
 * way by the CLI, MCP and Toil UI. The decision that matters is what a filter
 * does to an item it cannot judge because the dimension was never read (principle 12):
 * under `=` the item is left out, since nothing confirms it belongs; under `!=`
 * it is kept, since nothing says it is excluded. Either way the result counts
 * how many it could not judge, so the screen can say so. The filter grammar was
 * approved in committee, which is why it has two operators and not forty.
 */

import type { WorkItem } from '../owi/types.js';
import { parseDimension, valuesOf, type ValuesContext } from './dimensions.js';
import type { Filter } from './types.js';

/** Splits on a separator outside double quotes (a backslash escapes inside them). Pieces keep their quotes. */
export function splitUnquoted(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted && c === '\\' && i + 1 < text.length) { cur += c + text[++i]; continue; }
    if (c === '"') quoted = !quoted;
    if (c === sep && !quoted) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** A value as typed: surrounding quotes dropped, `\"` and `\\` unescaped. */
export function unquote(piece: string): string {
  const t = piece.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\(["\\])/g, '$1') : t;
}

/** A value ready to put in a list: quoted when it holds a comma, semicolon or quote. */
export function quoteIf(value: string): string {
  return /[",;]|^\s|\s$/.test(value) ? `"${value.replace(/(["\\])/g, '\\$1')}"` : value;
}

/** Reads `<dimension> = v1, v2` or `<dimension> != v1`, or throws an Error saying what to write. */
export function parseWhere(text: string): Filter {
  const m = /^\s*([^=!\s]+)\s*(!=|=)([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`Cannot read the filter "${text}". Write <dimension> = value, value or <dimension> != value, for example: status != Done.`);
  const dimension = m[1]!;
  parseDimension(dimension);
  const values = splitUnquoted(m[3]!, ',').map(unquote).filter((v) => v !== '');
  if (values.length === 0) throw new Error(`The filter "${text.trim()}" names no value after ${m[2]}. Write for example: ${dimension} ${m[2]} Done.`);
  return { dimension, op: m[2] as Filter['op'], values };
}

/** The filter as `parseWhere` reads it back. */
export const formatFilter = (f: Filter): string => `${f.dimension} ${f.op} ${f.values.map(quoteIf).join(', ')}`;

const lower = (s: string) => s.toLowerCase();

/** Whether the item holds one of the filter's values, or null when the dimension was never read for it. */
function holds(item: WorkItem, f: Filter, ctx: ValuesContext): boolean | null {
  const d = parseDimension(f.dimension);
  const v = valuesOf(item, d, ctx);
  if (v.unread) return null;
  const tokens = v.values.length === 0
    ? (d.noneLabel === null ? [] : ['none', lower(d.noneLabel)])
    : v.values.flatMap((x) => [lower(x.label), lower(x.key), lower(x.key.replace(/^v:/, ''))]);
  return f.values.some((w) => tokens.includes(lower(w)));
}

/** Items that pass every filter, and per filter how many items it could not judge. */
export function applyFilters(items: WorkItem[], filters: Filter[], ctx: ValuesContext): { kept: WorkItem[]; unjudged: Array<{ filter: Filter; count: number }> } {
  const unjudged = filters.map((filter) => ({ filter, count: 0 }));
  const kept = items.filter((item) => {
    let ok = true;
    filters.forEach((f, i) => {
      const hit = holds(item, f, ctx);
      if (hit === null) { unjudged[i]!.count++; if (f.op === '=') ok = false; }
      else if (f.op === '=' ? !hit : hit) ok = false;
    });
    return ok;
  });
  return { kept, unjudged: unjudged.filter((u) => u.count > 0) };
}

/** True when the item passes every filter (an item a filter cannot judge is out under `=` and in under `!=`). */
export const matches = (item: WorkItem, filters: Filter[], ctx: ValuesContext): boolean => applyFilters([item], filters, ctx).kept.length === 1;
