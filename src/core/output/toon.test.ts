import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeToon, type ToonOptions } from './toon.js';

/**
 * The TOON spec's encode fixtures (v4.4.0, commit d09c3d33), vendored
 * unchanged under test/fixtures/toon/ (MIT; see the LICENSE beside them and
 * NOTICE). Every case runs and is compared exactly.
 */
const dir = join(import.meta.dirname, '..', '..', '..', 'test', 'fixtures', 'toon');

interface Case {
  name: string;
  input: unknown;
  expected: string;
  options?: ToonOptions;
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('TOON encode fixtures', () => {
  it('are all there', () => {
    expect(files).toHaveLength(9);
  });

  for (const file of files) {
    const { tests } = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { tests: Case[] };
    describe(file, () => {
      for (const c of tests) {
        it(c.name, () => {
          expect(encodeToon(c.input, c.options)).toBe(c.expected);
        });
      }
    });
  }
});

describe('encodeToon on what JSON.stringify would print', () => {
  it('reads a Date as its ISO string, drops undefined fields, and prints undefined as null', () => {
    expect(encodeToon({ at: new Date('2026-01-02T03:04:05.000Z'), gone: undefined })).toBe('at: "2026-01-02T03:04:05.000Z"');
    expect(encodeToon(undefined)).toBe('null');
  });

  it('turns NaN and Infinity into null, and -0 into 0', () => {
    expect(encodeToon([Number.NaN, Number.POSITIVE_INFINITY, -0])).toBe('[3]: null,null,0');
  });

  it('writes a uniform list of rows as one header and one line per row', () => {
    expect(encodeToon({ issues: [{ key: 'A-1', points: 3 }, { key: 'A-2', points: 5 }] })).toBe('issues[2]{key,points}:\n  A-1,3\n  A-2,5');
  });
});
