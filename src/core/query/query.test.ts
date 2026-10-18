import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileQuery, pointAt, QueryError, search } from './index.js';

/**
 * The JMESPath compliance suite, vendored unchanged under
 * test/fixtures/jmespath/ (MIT; see the LICENSE beside it and NOTICE). Every
 * case runs: a result is compared exactly, an error by its kind.
 */
const dir = join(import.meta.dirname, '..', '..', '..', 'test', 'fixtures', 'jmespath');

interface Case {
  expression: string;
  result?: unknown;
  error?: string;
  bench?: string;
  comment?: string;
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('JMESPath compliance suite', () => {
  it('is all there', () => {
    expect(files).toHaveLength(16);
  });

  for (const file of files) {
    const groups = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Array<{ given: unknown; cases: Case[] }>;
    describe(file, () => {
      groups.forEach((group, g) => {
        group.cases.forEach((c, i) => {
          it(`${g + 1}.${i + 1}: ${c.expression}${c.comment ? ` (${c.comment})` : ''}`, () => {
            if (c.error !== undefined) {
              let thrown: unknown;
              try {
                search(group.given, c.expression);
              } catch (err) {
                thrown = err;
              }
              expect(thrown, 'should fail').toBeInstanceOf(QueryError);
              expect((thrown as QueryError).kind).toBe(c.error);
            } else if ('result' in c) {
              expect(search(group.given, c.expression)).toEqual(c.result);
            } else {
              // A parse-only benchmark: it has to compile and run, whatever it gives.
              expect(() => search(group.given, c.expression)).not.toThrow();
            }
          });
        });
      });
    });
  }
});

describe('compileQuery', () => {
  it('refuses a bad expression before any data, with where it went wrong', () => {
    const err = (() => {
      try {
        compileQuery('items[?state == `open`].{key: key, owner: owner.name');
      } catch (e) {
        return e as QueryError;
      }
    })();
    expect(err?.kind).toBe('syntax');
    expect(err?.position).toBe(52);
    expect(pointAt('items[?state == `open`].{key: key, owner: owner.name', err!)).toContain('owner.name>>>');
  });

  it('knows an unknown function and a wrong argument count at compile time', () => {
    expect(() => compileQuery('nope(@)')).toThrow(expect.objectContaining({ kind: 'unknown-function', position: 0 }));
    expect(() => compileQuery('a | length(@, @)')).toThrow(expect.objectContaining({ kind: 'invalid-arity', position: 4 }));
    expect(() => compileQuery('toString(@)')).toThrow(expect.objectContaining({ kind: 'unknown-function' }));
  });

  it('reads only data: prototype names are missing fields, and __proto__ is an ordinary key', () => {
    expect(search({}, 'constructor')).toBeNull();
    expect(search({ a: 1 }, '__proto__')).toBeNull();
    const built = search({ a: 1 }, '{"__proto__": a}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(built)).toBe(Object.prototype);
    expect(Object.keys(built)).toEqual(['__proto__']);
    const merged = search({ x: JSON.parse('{"__proto__": {"polluted": true}}') }, 'merge(x)') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(merged)).toEqual(['__proto__']);
  });

  it('refuses an expression nested more than 500 levels deep, however it nests, before any data', () => {
    const deep = [
      '('.repeat(10_000) + 'a' + ')'.repeat(10_000),
      'a' + '.b'.repeat(10_000),
      '['.repeat(600) + 'a' + ']'.repeat(600),
      '!'.repeat(600) + 'a',
      '('.repeat(300) + 'a' + '.b'.repeat(300) + ')'.repeat(300),
    ];
    for (const expression of deep) {
      expect(() => compileQuery(expression), expression.slice(0, 20)).toThrow(expect.objectContaining({ kind: 'syntax', message: expect.stringContaining('more than 500 levels') }));
    }
  });

  it('still takes deep and wide expressions inside the limit', () => {
    expect(search({ a: 1 }, '('.repeat(400) + 'a' + ')'.repeat(400))).toBe(1);
    expect(search({ a: { a: 2 } }, 'a' + '.a'.repeat(400))).toBeNull();
    const keys = Array.from({ length: 2000 }, (_, i) => `k${i}: a`).join(', ');
    expect(Object.keys(search({ a: 1 }, `{${keys}}`) as object)).toHaveLength(2000);
  });

  it('never hands back an expression reference, only data', () => {
    expect(search({ a: 1 }, '&a')).toBeNull();
    expect(JSON.stringify(search({ a: 1 }, '[&a]'))).toBe('[null]');
  });

  it('treats a field set to undefined as missing, as JSON would', () => {
    expect(search({ a: undefined, b: 1 }, '[a, b]')).toEqual([null, 1]);
  });
});
