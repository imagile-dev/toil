/**
 * The summary rules behind `--summary-file` (src/core/output/shape.ts): which
 * part of a result stays in the envelope when the whole of it goes to a file.
 * The rules are fixed and checked in order, first match wins, so the same
 * data always gets the same summary and the model reading it never has to
 * decide how much to look at:
 *
 * 1. `record`: no table in it, and a primitive or an object of 20 fields or
 *    fewer. The whole result.
 * 2. `all`: 50 rows or fewer (a result with no table counts as one), and an
 *    estimated 1,500 tokens or fewer. The whole result.
 * 3. `outline`: no table, or rows that don't flatten into one (fewer than 80%
 *    of their dot-path keys shared by every row). The top-level keys, the
 *    length of each list and object, and one sample.
 * 4. `head`: 500 rows or fewer. The first 20 rows and `stats`.
 * 5. `sample`: more than 500 rows. The column schema, 10 rows spread evenly
 *    from first to last, and `stats`, with a warning to work over the file.
 *
 * The table is the result itself when it's a list, or else its longest list
 * reached through objects (`issues` in `{ total, issues }`, `findings.results`
 * in a report). Every summary is held to the
 * same token budget: rows beyond it are dropped from the end, a sample too big
 * for it is cut to its keys, and meta.summary says when either happened. A
 * summary is, after all, the only part of any report that anyone reads.
 */

/** Tokens are estimated, never counted: JSON characters divided by this. Conservative for English and JSON alike. */
export const CHARS_PER_TOKEN = 3.5;
/** The most a summary should cost, in estimated tokens. */
export const TOKEN_BUDGET = 1500;
const RECORD_FIELDS = 20;
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
  /** Rows the token budget dropped from the summary's rows, or `sample` cut to its keys. */
  trimmed?: { rows?: number; sample?: true };
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

/**
 * The table in a result: the result itself when it's a list, else its longest
 * list found through objects (`issues` in `{ total, issues }`, or
 * `findings.results` a level down), the shallowest and then the first on a tie.
 */
function findTable(data: unknown): { path: string; rows: unknown[] } | undefined {
  if (Array.isArray(data)) return { path: '', rows: data };
  let best: { path: string; rows: unknown[]; depth: number } | undefined;
  const visit = (value: unknown, path: string, depth: number) => {
    if (!isObject(value) || depth > MAX_DEPTH) return;
    for (const [key, child] of Object.entries(value)) {
      const at = path === '' ? key : `${path}.${key}`;
      if (Array.isArray(child)) {
        if (!best || child.length > best.rows.length || (child.length === best.rows.length && depth < best.depth)) best = { path: at, rows: child, depth };
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
 * it's small, else only its top-level primitives, which cost little and say a lot.
 */
function besideTable(data: unknown, table: string): Record<string, unknown> | undefined {
  const rest = withoutTable(data, table);
  if (!isObject(rest) || Object.keys(rest).length === 0) return undefined;
  if (estimateTokens(rest) <= TOKEN_BUDGET / 4) return rest;
  const kept = Object.entries(rest).filter(([, value]) => value === null || typeof value !== 'object');
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** Drops rows from the end until the summary fits the budget, keeping at least one. */
function fitRows(build: (rows: unknown[]) => unknown, rows: unknown[]): { data: unknown; dropped: number } {
  let kept = rows.length;
  let data = build(rows);
  while (kept > 1 && estimateTokens(data) > TOKEN_BUDGET) data = build(rows.slice(0, --kept));
  return { data, dropped: rows.length - kept };
}

/** The summary of `data` (after --select), by the rules above. `file` is added by the caller once it's written. */
export function summarize(data: unknown): Summary {
  const full = estimateTokens(data);
  const table = findTable(data);
  const rows = table?.rows.length ?? 1;
  const tokens = (summary: unknown) => ({ full, summary: estimateTokens(summary), estimate: `JSON characters / ${CHARS_PER_TOKEN}` });
  const whole = (rule: SummaryRule): Summary => ({ data, report: { rule, rows, table: table?.path ?? null, tokens: tokens(data) }, large: false });

  if (!table && (!isObject(data) || Object.keys(data).length <= RECORD_FIELDS)) return whole('record');
  if (rows <= ALL_ROWS && full <= TOKEN_BUDGET) return whole('all');

  const flat = table ? table.rows.map((row) => flatten(row)) : [];
  const shape = columnsOf(flat);
  if (!table || !shape.flattens) {
    const lengths: Record<string, number> = {};
    let sample: unknown;
    if (Array.isArray(data)) {
      sample = data[0];
    } else if (isObject(data)) {
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) lengths[key] = value.length;
        else if (isObject(value)) lengths[key] = Object.keys(value).length;
      }
      // The table's first row, else the first nested value: one example of what the bulk of it looks like.
      sample = table ? table.rows[0] : Object.values(data).find((v) => typeof v === 'object' && v !== null);
    }
    const keys = Array.isArray(data) ? [...new Set(data.flatMap((row) => (isObject(row) ? Object.keys(row) : [])))].slice(0, MAX_COLUMNS * 2) : Object.keys(data as object);
    const build = (s: unknown) => ({ keys, ...(Object.keys(lengths).length > 0 ? { lengths } : {}), ...(s === undefined ? {} : { sample: s }) });
    let summary: unknown = build(sample);
    let cut = false;
    if (estimateTokens(summary) > TOKEN_BUDGET && isObject(sample)) {
      summary = build({ keys: Object.keys(sample) });
      cut = true;
    }
    return { data: summary, report: { rule: 'outline', rows, table: table?.path ?? null, tokens: tokens(summary), ...(cut ? { trimmed: { sample: true } } : {}) }, large: false };
  }

  const described = shape.columns.slice(0, MAX_COLUMNS);
  const stats = Object.fromEntries(described.map((c) => [c, statsFor(flat, c)]));
  const fields = besideTable(data, table.path);
  const rule: SummaryRule = rows <= HEAD_ROWS ? 'head' : 'sample';
  const schema = rule === 'sample' ? Object.fromEntries(described.map((c) => [c, schemaFor(flat, c)])) : undefined;
  const picked = rule === 'head' ? table.rows.slice(0, HEAD_KEEP) : spread(table.rows, SAMPLE_KEEP);
  const { data: summary, dropped } = fitRows(
    (kept) => ({ ...(fields ? { fields } : {}), ...(schema ? { schema } : {}), rows: kept, stats }),
    picked,
  );
  return {
    data: summary,
    report: { rule, rows, table: table.path, tokens: tokens(summary), columns: shape.columns.length, ...(dropped > 0 ? { trimmed: { rows: dropped } } : {}) },
    large: rule === 'sample',
  };
}
