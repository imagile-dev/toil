import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, pageKey, toJsonValue, toPage, windowFor } from './paging.js';

describe('db paging', () => {
  const key = pageKey('db query', 'SELECT 1');

  it('round-trips a cursor, and starts at 0 without one', () => {
    expect(decodeCursor(encodeCursor(200, key), key)).toBe(200);
    expect(decodeCursor(undefined, key)).toBe(0);
  });

  it("refuses a cursor for another query, or one toil didn't make", () => {
    expect(() => decodeCursor(encodeCursor(5, pageKey('db query', 'SELECT 2')), key)).toThrow(/different query/);
    expect(() => decodeCursor('garbage', key)).toThrow(/not one toil issued/);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ o: -1, k: key })).toString('base64url'), key)).toThrow(/not one toil issued/);
  });

  it('asks for one row more than the page, and trims it into a next cursor', () => {
    expect(windowFor(10, 5)).toEqual({ offset: 10, max: 6 });
    const full = toPage({ columns: [{ name: 'x', type: null }], rows: [[1], [2], [3]] }, 10, 2, key);
    expect(full.data.rows).toEqual([[1], [2]]);
    expect(decodeCursor(full.page.nextCursor!, key)).toBe(12);
    expect(toPage({ columns: [], rows: [[1]] }, 0, 2, key).page).toEqual({ nextCursor: null, limit: 2 });
  });

  it('makes driver values JSON-safe', () => {
    expect(toJsonValue(5n)).toBe(5);
    expect(toJsonValue(2n ** 60n)).toBe('1152921504606846976');
    expect(toJsonValue(new Uint8Array([1, 2]))).toBe('AQI=');
    expect(toJsonValue(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(toJsonValue('text')).toBe('text');
    expect(toJsonValue(null)).toBeNull();
  });
});
