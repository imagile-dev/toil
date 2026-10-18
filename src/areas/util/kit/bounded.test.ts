import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOUNDED_TIMEOUT_MS, matchBounded, runBounded, validateBounded } from './bounded.js';

/**
 * The bounded worker, on the inputs that made it necessary: diamonds of refs
 * a validator would try 2^n ways, patterns that backtrack without end, a
 * value too big for its memory and too deep for its stack, and a Node that
 * doesn't allow worker threads. Each must come back quickly as unchecked with
 * the right reason, and ordinary work must still pass. A clock on the wall is
 * only useful if someone checks it works.
 */

/** S0…Sn, each sending one value to two refs to the next (`nested`: under property `a`, with a value nested to match). */
function diamond(keyword: 'anyOf' | 'oneOf', n: number, nested: boolean) {
  const definitions: Record<string, unknown> = { [`S${n}`]: { type: 'string' } };
  for (let i = 0; i < n; i++) {
    const branches = { [keyword]: [{ $ref: `#/definitions/S${i + 1}` }, { $ref: `#/definitions/S${i + 1}` }] };
    definitions[`S${i}`] = nested ? { type: 'object', properties: { a: branches } } : branches;
  }
  let value: unknown = 'x';
  if (nested) for (let i = 0; i < n; i++) value = { a: value };
  return { schema: { $schema: 'http://json-schema.org/draft-07/schema#', $ref: '#/definitions/S0', definitions }, value };
}

/** Well under vitest's own timeout, with room for a slow runner: the deadline plus a worker's start and teardown. */
const QUICKLY = BOUNDED_TIMEOUT_MS + 3_000;

describe('validateBounded', () => {
  it('stops the property-nested anyOf diamond (n=22) at the deadline and says so', async () => {
    const { schema, value } = diamond('anyOf', 22, true);
    const started = performance.now();
    const result = await validateBounded(schema as never, value);
    expect(performance.now() - started).toBeLessThan(QUICKLY);
    expect(result).toMatchObject({ valid: false, problems: [], unchecked: expect.stringMatching(/took longer than 2 s/) });
  }, 20_000);

  it('turns the oneOf diamond (n=18) running out of stack into unchecked, never a crash', async () => {
    const { schema, value } = diamond('oneOf', 18, true);
    const started = performance.now();
    const result = await validateBounded(schema as never, value);
    expect(performance.now() - started).toBeLessThan(QUICKLY);
    expect(result).toMatchObject({ valid: false, unchecked: expect.stringMatching(/stack|took longer than/) });
  }, 20_000);

  it.each(['^a*a*a*a*a*a*a*a*a*a*$', '^(a+)+$', '(a|aa)*$', '^(.*a){12}$'])('stops the pattern %s against 40 a\'s and a ! at the deadline', async (pattern) => {
    const started = performance.now();
    const result = await validateBounded({ type: 'string', pattern }, `${'a'.repeat(40)}!`);
    expect(performance.now() - started).toBeLessThan(QUICKLY);
    expect(result).toMatchObject({ valid: false, unchecked: expect.stringMatching(/took longer than 2 s/) });
  }, 20_000);

  it('still validates ordinary work, passes and failures alike, with every problem', async () => {
    expect(await validateBounded({ type: 'string', pattern: '^[A-Z]{3}-\\d+$' }, 'ABC-1')).toEqual({ valid: true, problems: [], total: 0 });
    const failed = await validateBounded({ type: 'object', required: ['a', 'b'] }, {});
    expect(failed.valid).toBe(false);
    expect(failed.problems).toContainEqual(expect.objectContaining({ pointer: '', keyword: 'required' }));
    expect(failed.unchecked).toBeUndefined();
  });
});

describe('runBounded', () => {
  afterEach(() => vi.doUnmock('node:worker_threads'));

  it('stops a task that needs more memory than it may use, and says so', async () => {
    const value = Array.from({ length: 2_000_000 }, (_, i) => ({ i }));
    const outcome = await runBounded({ kind: 'validate', schema: { type: 'array' }, value }, { maxMemoryMb: 16 });
    expect(outcome).toEqual({ ok: false, cause: 'memory', reason: 'it needed more than 16 MB of memory, the most one check may use, and was stopped' });
  }, 20_000);

  it("says plainly when Node's permission model forbids worker threads", async () => {
    vi.resetModules();
    vi.doMock('node:worker_threads', () => ({
      Worker: class {
        constructor() {
          throw Object.assign(new Error('Access to this API has been restricted'), { code: 'ERR_ACCESS_DENIED' });
        }
      },
    }));
    const { runBounded: denied } = await import('./bounded.js');
    expect(await denied({ kind: 'match', patterns: [{ pattern: 'a', candidates: ['a'] }] })).toMatchObject({ ok: false, cause: 'denied', reason: expect.stringContaining('--allow-worker') });
  });

  it('matches patterns against candidates: the first that fits, -1 for none, -2 for a pattern that does not compile', async () => {
    expect(await matchBounded([
      { pattern: '^[A-Z]{3}-\\d+$', candidates: ['string', 'ABC-123'] },
      { pattern: '^z+$', candidates: ['a'] },
      { pattern: '(', candidates: ['a'] },
    ])).toEqual({ ok: true, value: [1, -1, -2] });
  });

  it('stops a backtracking pattern while matching candidates, too', async () => {
    const started = performance.now();
    const outcome = await matchBounded([{ pattern: '^(a+)+$', candidates: [`${'a'.repeat(40)}!`] }]);
    expect(performance.now() - started).toBeLessThan(QUICKLY);
    expect(outcome).toMatchObject({ ok: false, cause: 'timeout' });
  }, 20_000);
});
