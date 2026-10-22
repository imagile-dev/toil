import type { ColumnDesc, ColumnValues, Int64Like, ResultColumnData, RowSetData, TypeEntry } from './hs2.js';

/**
 * HiveServer2 results to rows. From protocol V6 on (Hive 0.13, every Impala
 * toil supports) a result is columnar: one array of values per column plus a
 * bitmap of which are null. This turns that back into rows, in column order,
 * as the db area returns them everywhere.
 *
 * Values keep the type the server sent: booleans and small integers as
 * numbers, BIGINT as a BigInt (paging makes it a number when it fits, text
 * when it doesn't), FLOAT and DOUBLE as numbers, BINARY as bytes (base64 in
 * the envelope). Everything else arrives as text and stays text: DECIMAL, so
 * no digit is lost; TIMESTAMP and DATE as the server wrote them, never shifted
 * into a time zone; ARRAY, MAP and STRUCT as the server's JSON-like text.
 * Columns were rotated ninety degrees for transport and are rotated back on
 * arrival, at no extra charge.
 */

/** The server's name for each TTypeId, as you'd write it in HiveQL. NULL_TYPE (16) has none. */
const TYPE_NAMES: Record<number, string | null> = {
  0: 'BOOLEAN',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'BIGINT',
  5: 'FLOAT',
  6: 'DOUBLE',
  7: 'STRING',
  8: 'TIMESTAMP',
  9: 'BINARY',
  10: 'ARRAY',
  11: 'MAP',
  12: 'STRUCT',
  13: 'UNIONTYPE',
  14: 'USER_DEFINED',
  15: 'DECIMAL',
  16: null,
  17: 'DATE',
  18: 'VARCHAR',
  19: 'CHAR',
  20: 'INTERVAL_YEAR_MONTH',
  21: 'INTERVAL_DAY_TIME',
  22: 'TIMESTAMP WITH LOCAL TIME ZONE',
};

/** A result column's type: `INT`, `VARCHAR(100)`, `DECIMAL(10,2)`; null for an untyped NULL. */
export function typeName(column: ColumnDesc): string | null {
  const entry: TypeEntry | undefined = column.typeDesc?.types?.[0];
  if (!entry) return null;
  if (entry.arrayEntry) return 'ARRAY';
  if (entry.mapEntry) return 'MAP';
  if (entry.structEntry) return 'STRUCT';
  if (entry.unionEntry) return 'UNIONTYPE';
  if (entry.userDefinedTypeEntry) return 'USER_DEFINED';
  const primitive = entry.primitiveEntry;
  if (!primitive) return null;
  const base = TYPE_NAMES[primitive.type];
  if (base === undefined) return `TYPE ${primitive.type}`;
  if (base === null) return null;
  const q = primitive.typeQualifiers?.qualifiers ?? {};
  const length = q.characterMaximumLength?.i32Value;
  if (typeof length === 'number' && (base === 'VARCHAR' || base === 'CHAR')) return `${base}(${length})`;
  const precision = q.precision?.i32Value;
  const scale = q.scale?.i32Value;
  if (base === 'DECIMAL' && typeof precision === 'number') return `DECIMAL(${precision},${scale ?? 0})`;
  return base;
}

/** The one set value array of a column, and whether it holds 64-bit integers. */
function valuesOf(column: ResultColumnData): { values: ColumnValues; int64: boolean } | undefined {
  if (column.i64Val) return { values: column.i64Val, int64: true };
  const values = column.boolVal ?? column.byteVal ?? column.i16Val ?? column.i32Val ?? column.doubleVal ?? column.stringVal ?? column.binaryVal;
  return values ? { values, int64: false } : undefined;
}

/** Bit `i` of a null bitmap, least significant bit first. */
export function isNull(nulls: Buffer | undefined | null, i: number): boolean {
  if (!nulls) return false;
  const byte = nulls[i >> 3];
  return byte !== undefined && (byte & (1 << (i & 7))) !== 0;
}

export function int64ToBigInt(value: Int64Like): bigint {
  return value.buffer.readBigInt64BE(value.offset);
}

/** How many rows a columnar result holds. */
export function rowCount(results: RowSetData | null | undefined): number {
  const first = results?.columns?.[0];
  return first ? (valuesOf(first)?.values.values.length ?? 0) : 0;
}

/** Rows from a columnar result, in column order. */
export function decodeRows(results: RowSetData | null | undefined): unknown[][] {
  const columns = (results?.columns ?? []).map(valuesOf);
  const count = rowCount(results);
  const rows: unknown[][] = [];
  for (let r = 0; r < count; r++) {
    rows.push(
      columns.map((column) => {
        if (!column || isNull(column.values.nulls, r)) return null;
        const value = column.values.values[r];
        if (value === undefined) return null;
        return column.int64 ? int64ToBigInt(value as Int64Like) : value;
      }),
    );
  }
  return rows;
}
