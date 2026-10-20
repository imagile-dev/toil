/**
 * The summary rules behind `--summary-file` (src/core/output/shape.ts): which
 * part of a result stays in the envelope when the whole of it goes to a file.
 * The rules are fixed and checked in order, first match wins, so the same
 * data always gets the same summary and the model reading it never has to
 * decide how much to look at:
 *
 * 1. `record`: no table in it, a primitive or an object of 20 fields or
 *    fewer, and an estimated 1,500 tokens or fewer. The whole result.
 * 2. `all`: 50 rows or fewer (a result with no table counts as one), and an
 *    estimated 1,500 tokens or fewer. The whole result.
 * 3. `outline`: no table, or rows that don't flatten into one (fewer than 80%
 *    of their dot-path keys shared by every row), or a record too big for the
 *    budget. The top-level keys, the length of each list, object and long text,
 *    and one sample with its long text cut short (a bare text keeps a prefix).
 * 4. `head`: 500 rows or fewer. The first 20 rows and `stats`.
 * 5. `sample`: more than 500 rows. The column schema, 10 rows spread evenly
 *    from first to last, and `stats`, with a warning to work over the file.
 *
 * The table is the result itself when it's a list, or else the list reached
 * through objects that holds the most (`issues` in `{ total, issues }`,
 * `findings.results` in a report). Every summary is held to the same token budget: long texts are
 * cut short, rows beyond it are dropped from the end, a sample too big for it
 * is cut to its keys, and meta.summary.trimmed says what was cut. A
 * summary is, after all, the only part of any report that anyone reads.
 */

/** Tokens are estimated, never counted: JSON characters divided by this. Conservative for English and JSON alike. */
export const CHARS_PER_TOKEN = 3.5;
/** The most a summary should cost, in estimated tokens. */
export const TOKEN_BUDGET = 1500;
const RECORD_FIELDS = 20;
/** Text in an outline's sample is cut to this many characters; a bare value, the whole result, to PREFIX_CLIP. */
const STRING_CLIP = 200;
const PREFIX_CLIP = 2000;
/** A last row too wide for the budget at STRING_CLIP has its texts cut to this before it is dropped. */
const TIGHT_CLIP = 40;
const ALL_ROWS = 50;
const HEAD_ROWS = 500;
const HEAD_KEEP = 20;
const SAMPLE_KEEP = 10;
const SHARED_KEYS = 0.8;
/** Columns described in `schema` and `stats`; a wider table names the rest in meta.summary.columns. */
const MAX_COLUMNS = 25;
/** How deep to look through objects for the table. */
const MAX_DEPTH = 4;

export type SummaryRule = 'record' | 'all' | 'outline' | 'head' | 'sample';

export interface ColumnStats {
  /** Rows where the column is null or missing. */
  nulls: number;
  /** Distinct non-null values. */
  distinct: number;
  /** For a column of numbers, or of dates (ISO 8601 text): the smallest and largest. Null for any other column, so every column has the same keys. */
  min: number | string | null;
  max: number | string | null;
}

export interface SummaryReport {
  rule: SummaryRule;
  /** Rows in the full result: the table's length, or 1 when there's no table. */
  rows: number;
  /** Where the table is in `data`: `""` for the result itself, a dot path (`findings.results`), or null when there's none. */
  table: string | null;
  /** The file holding the full result, absolute, with forward slashes. */
  file: string;
  /** Estimated tokens, JSON characters divided by `CHARS_PER_TOKEN`: an estimate, never a count. */
  tokens: { full: number; summary: number; estimate: string };
  /** Columns in the table's flattened rows, when there's a table; `schema` and `stats` describe the first 25. */
  columns?: number;
  /** What the token budget cut: rows dropped from the end, `sample` cut to its keys or left out, how many long texts were cut short (ending in `…`), `lengths` left out, keys dropped from the end of `keys`, or fields beside the table left out of `fields`. */
  trimmed?: { rows?: number; sample?: true; strings?: number; lengths?: true; keys?: number; fields?: number };
}

export interface Summary {
  data: unknown;
  report: Omit<SummaryReport, 'file'>;
  /** True for `sample`: the caller warns the agent to work over the file. */
  large: boolean;
}

export function estimateTokens(value: unknown): number {
  return Math.ceil((JSON.stringify(value) ?? 'null').length / CHARS_PER_TOKEN);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rows looked at to judge how wide a list's rows are. */
const WIDTH_SAMPLE = 20;

/**
 * How many cells a list holds: its rows times how wide they are, judged from
 * the first rows (an object's dot-path keys, a list's items, else one). Shape,
 * never size, so one long text can't make a one-row list the table.
 */
function cellsOf(rows: unknown[]): number {
  const sample = rows.slice(0, WIDTH_SAMPLE);
  if (sample.length === 0) return 0;
  const width = sample.reduce<number>((sum, row) => sum + (isObject(row) ? Object.keys(flatten(row)).length : Array.isArray(row) ? row.length : 1), 0) / sample.length;
  return rows.length * Math.max(width, 1);
}

/**
 * Whether `list` is the header of a sibling list rather than data: a list of
 * objects (`{ name, type }`), as long as a sibling's rows are wide when those
 * rows are lists, or naming its columns beside an empty sibling. That's how `db query` returns `{ columns, rows }`, and its
 * one-row answer is still a table of one row, not of its column definitions.
 */
function describesSibling(list: unknown[], siblings: unknown[][]): boolean {
  if (list.length === 0 || !list.every(isObject)) return false;
  // With no rows there's no width to match, so an empty sibling counts only when
  // every item names a column (a string `name`), as `db`'s do: an empty answer is
  // a table of no rows, and `{ comments, attachments: [] }` keeps its comments.
  const named = list.every((item) => typeof (item as Record<string, unknown>).name === 'string');
  return siblings.some(
    (other) => other !== list && (other.length === 0 ? named : Array.isArray(other[0]) && other.every((row) => Array.isArray(row) && row.length === list.length)),
  );
}

/**
 * The table in a result: the result itself when it's a list, else the list
 * reached through objects with the most cells, leaving out one that only
 * names a sibling's columns (`issues` in `{ total, issues }`,
 * `findings.results` a level down, `rows` beside a `db` query's 40 `columns`),
 * the shallowest and then the first on a tie.
 */
function findTable(data: unknown): { path: string; rows: unknown[] } | undefined {
  if (Array.isArray(data)) return { path: '', rows: data };
  let best: { path: string; rows: unknown[]; depth: number; cells: number } | undefined;
  const visit = (value: unknown, path: string, depth: number) => {
    if (!isObject(value) || depth > MAX_DEPTH) return;
    const lists = Object.values(value).filter((child): child is unknown[] => Array.isArray(child));
    for (const [key, child] of Object.entries(value)) {
      const at = path === '' ? key : `${path}.${key}`;
      if (Array.isArray(child)) {
        if (describesSibling(child, lists)) continue;
        const cells = cellsOf(child);
        if (!best || cells > best.cells || (cells === best.cells && depth < best.depth)) best = { path: at, rows: child, depth, cells };
      } else visit(child, at, depth + 1);
    }
  };
  visit(data, '', 0);
  return best && { path: best.path, rows: best.rows };
}

/** `data` without the list at `path`, which the summary describes on its own. */
function withoutTable(data: unknown, path: string): unknown {
  if (!isObject(data) || path === '') return undefined;
  const [head, ...rest] = path.split('.');
  const copy: Record<string, unknown> = { ...data };
  if (rest.length === 0) delete copy[head!];
  else copy[head!] = withoutTable(copy[head!], rest.join('.'));
  return copy;
}

/**
 * A row as dot-path columns: nested objects open out (`fields.status.name`),
 * lists and empty objects stay whole, and a row that isn't an object is one
 * column, `@`, as JMESPath names the current value.
 */
function flatten(row: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isObject(row) || (prefix !== '' && Object.keys(row).length === 0)) {
    out[prefix === '' ? '@' : prefix] = row;
    return out;
  }
  for (const [key, value] of Object.entries(row)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (isObject(value) && Object.keys(value).length > 0) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

/** Every column, in the order rows first show them, and whether at least 80% of them are in every row. */
function columnsOf(flat: Array<Record<string, unknown>>): { columns: string[]; flattens: boolean } {
  const seen = new Map<string, number>();
  for (const row of flat) for (const key of Object.keys(row)) seen.set(key, (seen.get(key) ?? 0) + 1);
  const columns = [...seen.keys()];
  const shared = [...seen.values()].filter((n) => n === flat.length).length;
  return { columns, flattens: columns.length > 0 && shared / columns.length >= SHARED_KEYS };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const isDate = (value: unknown): value is string => typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isDate(value)) return 'date';
  return typeof value;
}

function statsFor(flat: Array<Record<string, unknown>>, column: string): ColumnStats {
  const values = flat.map((row) => row[column]).filter((v) => v !== null && v !== undefined);
  const stats: ColumnStats = { nulls: flat.length - values.length, distinct: new Set(values.map((v) => JSON.stringify(v))).size, min: null, max: null };
  if (values.length > 0 && values.every((v) => typeof v === 'number')) {
    stats.min = values.reduce((a, b) => Math.min(a as number, b as number)) as number;
    stats.max = values.reduce((a, b) => Math.max(a as number, b as number)) as number;
  } else if (values.length > 0 && values.every(isDate)) {
    const ordered = [...values].sort((a, b) => Date.parse(a) - Date.parse(b));
    stats.min = ordered[0]!;
    stats.max = ordered[ordered.length - 1]!;
  }
  return stats;
}

/** A column's type across its non-null values: one type, or `mixed`. */
function schemaFor(flat: Array<Record<string, unknown>>, column: string): string {
  const types = new Set(flat.map((row) => row[column]).filter((v) => v !== null && v !== undefined).map(typeOf));
  if (types.size === 0) return 'null';
  return types.size === 1 ? [...types][0]! : 'mixed';
}

/** `n` rows spread evenly from the first to the last. */
function spread<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  return Array.from({ length: n }, (_, k) => rows[Math.round((k * (rows.length - 1)) / (n - 1))]!);
}

/**
 * Everything beside the table (`total`, a cursor, counts by level): whole when
 * it's small, else with its long texts cut short, else as many of its top-level
 * primitives as fit, which cost little and say a lot. `count` counts the cut
 * texts and the fields left out.
 */
function besideTable(data: unknown, table: string, count: { strings: number; fields: number }): Record<string, unknown> | undefined {
  const rest = withoutTable(data, table);
  if (!isObject(rest) || Object.keys(rest).length === 0) return undefined;
  const fits = (value: unknown) => estimateTokens(value) <= TOKEN_BUDGET / 4;
  if (fits(rest)) return rest;
  const short = clip(rest, STRING_CLIP, count) as Record<string, unknown>;
  if (fits(short)) return short;
  const all = Object.entries(short);
  const primitives = all.filter(([, value]) => value === null || typeof value !== 'object');
  // Many short fields can still be too many: keep them from the front while
  // they fit, counting each one's JSON once, so it's linear in the fields.
  const kept = prefixThatFits(primitives, ([key, value]) => jsonLength(key) + 1 + jsonLength(value), 2, TOKEN_BUDGET / 4);
  count.fields = all.length - kept.length;
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** The length of `value` as JSON, as estimateTokens counts it. */
const jsonLength = (value: unknown): number => (JSON.stringify(value) ?? 'null').length;

/**
 * The longest prefix of `items` whose JSON, one `size` per item plus a comma
 * between them on top of `base` characters, fits `budget` tokens. One pass,
 * whatever the count: a cap that serialized everything again for each item
 * dropped would take seconds on a few thousand.
 */
function prefixThatFits<T>(items: readonly T[], size: (item: T) => number, base: number, budget: number): T[] {
  let chars = base;
  let n = 0;
  for (const item of items) {
    const next = chars + size(item) + (n > 0 ? 1 : 0);
    if (Math.ceil(next / CHARS_PER_TOKEN) > budget) break;
    chars = next;
    n++;
  }
  return items.slice(0, n);
}

/** `value` with every text longer than `limit` cut to it, ending in `…`; `count.strings` counts the cuts. */
function clip(value: unknown, limit: number, count: { strings: number }): unknown {
  if (typeof value === 'string' && value.length > limit) {
    count.strings++;
    return `${value.slice(0, limit)}…`;
  }
  if (Array.isArray(value)) return value.map((v) => clip(v, limit, count));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v, limit, count)]));
  return value;
}

/**
 * Fits the rows to the budget: as they are when they fit, else with their long
 * texts cut short, then dropped from the end; a last row still too wide has its
 * texts cut to 40 characters, and goes only if even that doesn't fit.
 */
function fitRows(build: (rows: unknown[]) => unknown, rows: unknown[]): { data: unknown; dropped: number; strings: number } {
  let data = build(rows);
  if (estimateTokens(data) <= TOKEN_BUDGET) return { data, dropped: 0, strings: 0 };
  const count = { strings: 0 };
  const short = rows.map((row) => clip(row, STRING_CLIP, count));
  let kept = short.length;
  data = build(short);
  while (kept > 0 && estimateTokens(data) > TOKEN_BUDGET) data = build(short.slice(0, --kept));
  if (kept === 0 && rows.length > 0) {
    // One row too wide even so: its texts cut shorter still, before it goes too.
    const tight = { strings: 0 };
    const one = build([clip(rows[0], TIGHT_CLIP, tight)]);
    if (estimateTokens(one) <= TOKEN_BUDGET) return { data: one, dropped: rows.length - 1, strings: tight.strings };
  }
  return { data, dropped: rows.length - kept, strings: count.strings };
}

/** The summary of `data` (after --select), by the rules above. `file` is added by the caller once it's written. */
export function summarize(data: unknown): Summary {
  const full = estimateTokens(data);
  const table = findTable(data);
  const rows = table?.rows.length ?? 1;
  const tokens = (summary: unknown) => ({ full, summary: estimateTokens(summary), estimate: `JSON characters / ${CHARS_PER_TOKEN}` });
  const whole = (rule: SummaryRule): Summary => ({ data, report: { rule, rows, table: table?.path ?? null, tokens: tokens(data) }, large: false });

  if (!table && full <= TOKEN_BUDGET && (!isObject(data) || Object.keys(data).length <= RECORD_FIELDS)) return whole('record');
  if (rows <= ALL_ROWS && full <= TOKEN_BUDGET) return whole('all');

  const flat = table ? table.rows.map((row) => flatten(row)) : [];
  const shape = columnsOf(flat);
  if (!table || !shape.flattens) {
    const lengths: Record<string, number> = {};
    let sample: unknown;
    let keys: string[] | undefined;
    if (Array.isArray(data)) {
      sample = data[0];
      keys = [...new Set(data.flatMap((row) => (isObject(row) ? Object.keys(row) : [])))].slice(0, MAX_COLUMNS * 2);
    } else if (isObject(data)) {
      keys = Object.keys(data);
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) lengths[key] = value.length;
        else if (isObject(value)) lengths[key] = Object.keys(value).length;
        else if (typeof value === 'string' && value.length > STRING_CLIP) lengths[key] = value.length;
      }
      // The table's first row, else a record itself (its long text clipped), else
      // the first nested value: one example of what the bulk of it looks like.
      sample = table ? table.rows[0] : keys.length <= RECORD_FIELDS ? data : Object.values(data).find((v) => typeof v === 'object' && v !== null);
    } else {
      // A bare value too big for the budget: a long text, with its length and a prefix.
      if (typeof data === 'string') lengths['@'] = data.length;
      sample = data;
    }
    const sampleIsData = sample === data;
    const clipped = { strings: 0 };
    sample = clip(sample, typeof sample === 'string' ? PREFIX_CLIP : STRING_CLIP, clipped);
    const build = (s: unknown) => ({ ...(keys ? { keys } : {}), ...(Object.keys(lengths).length > 0 ? { lengths } : {}), ...(s === undefined ? {} : { sample: s }) });
    // Over the budget, in order: the sample becomes its keys (or goes, when it
    // was the result itself), then the lengths go, then the sample, then keys
    // are dropped from the end. Each step is said in meta.summary.trimmed.
    const over = () => estimateTokens(build(sample)) > TOKEN_BUDGET;
    let cut = false;
    if (over() && isObject(sample)) {
      sample = sampleIsData ? undefined : { keys: Object.keys(sample) };
      cut = true;
    }
    const lengthsCut = over() && Object.keys(lengths).length > 0;
    if (lengthsCut) for (const key of Object.keys(lengths)) delete lengths[key];
    if (over() && sample !== undefined) {
      sample = undefined;
      cut = true;
    }
    let droppedKeys = 0;
    if (keys && keys.length > 1 && over()) {
      // The keys from the front that fit beside the rest, counted in one pass, at least one.
      const all = keys;
      keys = [];
      const kept = prefixThatFits(all, jsonLength, jsonLength(build(sample)), TOKEN_BUDGET);
      keys = kept.length > 0 ? kept : all.slice(0, 1);
      droppedKeys = all.length - keys.length;
    }
    const summary = build(sample);
    const trimmed = {
      ...(cut ? { sample: true as const } : {}),
      ...(clipped.strings > 0 && !cut ? { strings: clipped.strings } : {}),
      ...(lengthsCut ? { lengths: true as const } : {}),
      ...(droppedKeys > 0 ? { keys: droppedKeys } : {}),
    };
    return { data: summary, report: { rule: 'outline', rows, table: table?.path ?? null, tokens: tokens(summary), ...(Object.keys(trimmed).length > 0 ? { trimmed } : {}) }, large: false };
  }

  const described = shape.columns.slice(0, MAX_COLUMNS);
  const stats = Object.fromEntries(described.map((c) => [c, statsFor(flat, c)]));
  const besideCuts = { strings: 0, fields: 0 };
  const fields = besideTable(data, table.path, besideCuts);
  const rule: SummaryRule = rows <= HEAD_ROWS ? 'head' : 'sample';
  const schema = rule === 'sample' ? Object.fromEntries(described.map((c) => [c, schemaFor(flat, c)])) : undefined;
  const picked = rule === 'head' ? table.rows.slice(0, HEAD_KEEP) : spread(table.rows, SAMPLE_KEEP);
  const { data: summary, dropped, strings: rowCuts } = fitRows(
    (kept) => ({ ...(fields ? { fields } : {}), ...(schema ? { schema } : {}), rows: kept, stats }),
    picked,
  );
  const strings = rowCuts + besideCuts.strings;
  const trimmed = { ...(dropped > 0 ? { rows: dropped } : {}), ...(strings > 0 ? { strings } : {}), ...(besideCuts.fields > 0 ? { fields: besideCuts.fields } : {}) };
  return {
    data: summary,
    report: { rule, rows, table: table.path, tokens: tokens(summary), columns: shape.columns.length, ...(Object.keys(trimmed).length > 0 ? { trimmed } : {}) },
    large: rule === 'sample',
  };
}
