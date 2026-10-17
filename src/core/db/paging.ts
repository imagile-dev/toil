import { createHash } from 'node:crypto';
import { ToilError } from '../errors.js';
import type { Page } from '../envelope.js';
import type { RowSet, RowWindow } from './provider.js';

/**
 * Row caps, cursors and JSON-safe values for every engine. Providers return
 * "at most this many rows from here"; this file turns that into a page with a
 * cursor, so paging behaves the same on SQLite as it will on Oracle.
 */

/** Rows per page when the caller doesn't say. */
export const DEFAULT_LIMIT = 100;
/** The most a caller can ask for in one page. A thousand rows is a report; more is an export. */
export const MAX_LIMIT = 1000;

interface CursorBody {
  /** Rows already returned. */
  o: number;
  /** Which query the cursor belongs to, so a cursor can't be replayed against a different one. */
  k: string;
}

/** A short fingerprint of what's being paged: the command and the SQL or table it reads. */
export function pageKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('base64url').slice(0, 12);
}

export function encodeCursor(offset: number, key: string): string {
  return Buffer.from(JSON.stringify({ o: offset, k: key } satisfies CursorBody)).toString('base64url');
}

/** The offset a cursor points at; 0 with no cursor. A cursor from another query is refused rather than quietly misapplied. */
export function decodeCursor(cursor: string | undefined, key: string): number {
  if (cursor === undefined) return 0;
  let body: Partial<CursorBody> | undefined;
  try {
    body = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorBody>;
  } catch {
    body = undefined;
  }
  if (!body || typeof body.o !== 'number' || !Number.isInteger(body.o) || body.o < 0 || typeof body.k !== 'string') {
    throw new ToilError('INVALID_INPUT', 'The cursor is not one toil issued.', { fix: 'Pass meta.page.nextCursor from the previous page unchanged, or leave --cursor off to start again.' });
  }
  if (body.k !== key) {
    throw new ToilError('INVALID_INPUT', 'The cursor belongs to a different query or table.', { fix: 'Use a cursor with the same SQL or table it came from, or leave --cursor off to start again.' });
  }
  return body.o;
}

/** The window to ask a provider for: one row more than the page, to learn whether another page exists. */
export function windowFor(offset: number, limit: number): RowWindow {
  return { offset, max: limit + 1 };
}

/** Trims the extra row, converts values, and says where the next page starts. */
export function toPage(result: RowSet, offset: number, limit: number, key: string): { data: RowSet; page: Page } {
  const more = result.rows.length > limit;
  const rows = (more ? result.rows.slice(0, limit) : result.rows).map((row) => row.map(toJsonValue));
  return {
    data: { columns: result.columns, rows },
    page: { nextCursor: more ? encodeCursor(offset + limit, key) : null, limit },
  };
}

/**
 * Driver values to JSON. Integers past 2^53 become strings rather than
 * silently different numbers; binary becomes base64; dates become ISO strings.
 */
export function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  if (value instanceof Date) return value.toISOString();
  return value;
}
