/**
 * TOON, Token-Oriented Object Notation: a line-based text form of the JSON
 * data model that writes a uniform array of objects as one header and one
 * line per row, so the field names are paid for once rather than on every row.
 * `--output-format toon` renders `data` with it (src/core/output/shape.ts).
 *
 * This is an encoder for TOON 4.4 (https://github.com/toon-format/spec,
 * SPEC.md at release v4.4.0, commit d09c3d33), written here rather than taken
 * as a dependency: the published package has no runtime dependencies
 * (CLAUDE.md, No Executables), and an encoder is small. It passes the spec's
 * own encode fixtures, kept in test/fixtures/toon/. toil never decodes TOON;
 * the agent reading it does.
 *
 * Only what the spec requires of an encoder is here: canonical numbers, the
 * quoting rules, tabular and keyed-tabular forms, list items, and one document
 * delimiter declared in every header. The spec is a working draft; when it
 * moves, the fixtures are refreshed from the same repository and this follows.
 * Like any standard drafted by committee, it will be final the week after
 * everyone has stopped needing it.
 */

export type ToonDelimiter = ',' | '\t' | '|';

export interface ToonOptions {
  /** The document delimiter, declared in every array header. Default: comma. */
  delimiter?: ToonDelimiter;
  /** Spaces per indentation level. Default: 2. */
  indentSize?: number;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** A column of a tabular header: a field, or a group of nested fields (`customer{name,country}`). */
interface Column {
  name: string;
  children?: Column[];
}

const UNQUOTED_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const NUMERIC_LIKE = /^[+-]?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;

/**
 * `value` as a TOON document. It is first read as JSON reads it (a Date as
 * its ISO string, `undefined` and functions dropped, NaN and Infinity as
 * null), since TOON is defined over the JSON data model and `data` is
 * whatever JSON.stringify would have printed.
 */
export function encodeToon(value: unknown, options: ToonOptions = {}): string {
  const text = JSON.stringify(value);
  // JSON.stringify has nothing to say about undefined; the envelope prints it as null.
  const json = (text === undefined ? null : JSON.parse(text)) as Json;
  const encoder = new Encoder(options.delimiter ?? ',', options.indentSize ?? 2);
  return encoder.document(json).join('\n');
}

class Encoder {
  private readonly lines: string[] = [];

  constructor(
    private readonly delimiter: ToonDelimiter,
    private readonly indentSize: number,
  ) {}

  document(value: Json): string[] {
    if (isPrimitive(value)) {
      // A root string starting with a byte-order mark would lose it to the decoder.
      this.lines.push(typeof value === 'string' && value.startsWith('\uFEFF') ? quote(value) : this.primitive(value));
    } else if (Array.isArray(value)) {
      this.array('', value, 0, '');
    } else if (Object.keys(value).length > 0) {
      const columns = keyedColumns(value);
      if (columns) this.keyedTable('', value, columns, 0, '');
      else for (const [key, field] of Object.entries(value)) this.field(encodeKey(key), field, 0);
    }
    // An empty object at the root is an empty document.
    return this.lines;
  }

  private indent(depth: number): string {
    return ' '.repeat(depth * this.indentSize);
  }

  /** The `[N]` part of a header, with the delimiter declared unless it's the comma. `keyed` adds the `:` of a keyed table. */
  private length(n: number, keyed = false): string {
    return `[${n}${keyed ? ':' : ''}${this.delimiter === ',' ? '' : this.delimiter}]`;
  }

  private primitive(value: null | boolean | number | string): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return formatNumber(value);
    return needsQuotes(value, this.delimiter) ? quote(value) : value;
  }

  private columnsText(columns: Column[]): string {
    return `{${columns.map((c) => `${encodeKey(c.name)}${c.children ? this.columnsText(c.children) : ''}`).join(this.delimiter)}}`;
  }

  /** One row's cells, depth first through any nested group, joined by the delimiter. */
  private cells(row: JsonObject, columns: Column[]): string[] {
    return columns.flatMap((c) => (c.children ? this.cells(row[c.name] as JsonObject, c.children) : [this.primitive(row[c.name] as null | boolean | number | string)]));
  }

  /**
   * A key and its value. `lead` is the text before the key on its first
   * line: the indentation for `depth`, or a list item's `- `, whose first field
   * sits on the hyphen line. Anything under it goes one level below `depth`.
   */
  private field(key: string, value: Json, depth: number, lead = this.indent(depth)): void {
    if (isPrimitive(value)) {
      this.lines.push(`${lead}${key}: ${this.primitive(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      this.array(key, value, depth, lead);
      return;
    }
    const columns = keyedColumns(value);
    if (columns) {
      this.keyedTable(key, value, columns, depth, lead);
      return;
    }
    this.lines.push(`${lead}${key}:`);
    for (const [k, v] of Object.entries(value)) this.field(encodeKey(k), v, depth + 1);
  }

  /** `key[N:]{fields}:`, then one `entry: cells` line per entry. */
  private keyedTable(key: string, value: JsonObject, columns: Column[], depth: number, lead: string): void {
    const entries = Object.entries(value);
    this.lines.push(`${lead}${key}${this.length(entries.length, true)}${this.columnsText(columns)}:`);
    for (const [entry, row] of entries) this.lines.push(`${this.indent(depth + 1)}${encodeKey(entry)}: ${this.cells(row as JsonObject, columns).join(this.delimiter)}`);
  }

  /** An array under `key` ('' at the root): inline primitives, a table, or list items. */
  private array(key: string, value: Json[], depth: number, lead: string): void {
    if (value.length === 0) {
      this.lines.push(key === '' ? `${lead}[]` : `${lead}${key}: []`);
      return;
    }
    if (value.every(isPrimitive)) {
      this.lines.push(`${lead}${key}${this.length(value.length)}: ${value.map((v) => this.primitive(v)).join(this.delimiter)}`);
      return;
    }
    const columns = tabularColumns(value);
    if (columns) {
      this.lines.push(`${lead}${key}${this.length(value.length)}${this.columnsText(columns)}:`);
      for (const row of value) this.lines.push(`${this.indent(depth + 1)}${this.cells(row as JsonObject, columns).join(this.delimiter)}`);
      return;
    }
    this.lines.push(`${lead}${key}${this.length(value.length)}:`);
    for (const item of value) this.item(item, depth + 1);
  }

  /** One `- ` list item at `depth`. */
  private item(value: Json, depth: number): void {
    const lead = `${this.indent(depth)}- `;
    if (isPrimitive(value)) {
      this.lines.push(`${lead}${this.primitive(value)}`);
    } else if (Array.isArray(value)) {
      // An array in item position is never a table: inline primitives, or more list items.
      if (value.length > 0 && !value.every(isPrimitive)) {
        this.lines.push(`${lead}${this.length(value.length)}:`);
        for (const inner of value) this.item(inner, depth + 1);
      } else {
        this.lines.push(`${lead}${this.length(value.length)}:${value.length > 0 ? ` ${value.map((v) => this.primitive(v as null | boolean | number | string)).join(this.delimiter)}` : ''}`);
      }
    } else {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        this.lines.push(`${this.indent(depth)}-`);
        return;
      }
      // The first field stands on the hyphen line; the rest line up under it.
      entries.forEach(([k, v], i) => this.field(encodeKey(k), v, depth + 1, i === 0 ? lead : undefined));
    }
  }
}

function isPrimitive(value: Json): value is null | boolean | number | string {
  return value === null || typeof value !== 'object';
}

function isObject(value: Json): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The columns of a table of `rows`, or undefined when they aren't one: every
 * row a non-empty object with the same keys, and every column all primitives
 * or all non-empty objects that are themselves a table (a nested group).
 * Columns follow the first row's key order.
 */
function tabularColumns(rows: Json[]): Column[] | undefined {
  if (!rows.every((row) => isObject(row) && Object.keys(row).length > 0)) return undefined;
  const objects = rows as JsonObject[];
  const keys = Object.keys(objects[0]!);
  const sameKeys = (row: JsonObject) => {
    const own = Object.keys(row);
    return own.length === keys.length && keys.every((k) => Object.hasOwn(row, k));
  };
  if (!objects.every(sameKeys)) return undefined;
  const columns: Column[] = [];
  for (const key of keys) {
    const values = objects.map((row) => row[key]!);
    if (values.every(isPrimitive)) {
      columns.push({ name: key });
      continue;
    }
    const children = tabularColumns(values);
    if (!children) return undefined;
    columns.push({ name: key, children });
  }
  return columns;
}

/** The columns of an object written as a keyed table: two or more entries whose values form a table. */
function keyedColumns(value: JsonObject): Column[] | undefined {
  const values = Object.values(value);
  return values.length >= 2 ? tabularColumns(values) : undefined;
}

/** The fewest digits that read back as the same number, never `-0`, and null for what JSON can't hold. */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return 'null';
  if (Object.is(n, -0)) return '0';
  // JavaScript's own shortest round-trip form is the spec's: plain decimal from
  // 1e-6 up to 1e21, and a lowercase, signed exponent outside it (1e-7, 1e+21).
  return String(n);
}

function encodeKey(key: string): string {
  return UNQUOTED_KEY.test(key) ? key : quote(key);
}

function needsQuotes(value: string, delimiter: ToonDelimiter): boolean {
  return (
    value === '' ||
    /^[ \t]|[ \t]$/.test(value) ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    NUMERIC_LIKE.test(value) ||
    /[:"\\[\]{}]/.test(value) ||
    CONTROL.test(value) ||
    value.includes(delimiter) ||
    value.startsWith('-') ||
    value.startsWith('#')
  );
}

function quote(value: string): string {
  let out = '"';
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (CONTROL.test(ch)) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}
