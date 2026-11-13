import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../owi/types.js';
import { pivot } from './pivot.js';
import { releaseScope } from './release-scope.js';
import { AS_OF, history, item, move } from './testkit.js';
import type { PivotSpec } from './types.js';

const W44 = '2026-10-28T10:00:00Z';
const W45 = '2026-11-03T10:00:00Z';
const W46 = '2026-11-10T09:00:00Z';
let n = 0;
const made = (type: 'BUG' | 'STORY', created: string, extra: Partial<WorkItem> = {}) => item(`N${++n}`, { type, created, ...extra });
const many = (count: number, type: 'BUG' | 'STORY', created: string) => Array.from({ length: count }, () => made(type, created));
const spec: PivotSpec = { measure: 'items', split: 'type', across: 'created:week', from: '2026-10-19', to: '2026-11-10', top: 0 };
const run = (items: WorkItem[], s: PivotSpec = spec) => pivot({ items, spec: s, asOf: AS_OF });
const kinds = (items: WorkItem[], s?: PivotSpec) => run(items, s).notable.map((x) => x.kind);

describe('share-moved', () => {
  it('fires for a row whose share of its column moved 10 points between the last two complete columns', () => {
    const r = run([...many(3, 'STORY', W44), ...many(1, 'BUG', W44), ...many(1, 'STORY', W45), ...many(3, 'BUG', W45)]);
    const moved = r.notable.filter((x) => x.kind === 'share-moved');
    expect(moved.map((x) => [x.row, x.column, Math.round(x.delta * 100)])).toEqual([['v:BUG', 'v:2026-11-02', 50], ['v:STORY', 'v:2026-11-02', -50]]);
    expect(moved[0]!.message).toBe('Bug went from 25% of 2026-W44 to 75% of 2026-W45, up 50 points.');
    expect(moved[0]!.items).toHaveLength(3);
  });
  it('does not fire when shares hold, or when the move is only in the bucket still filling', () => {
    expect(kinds([...many(2, 'STORY', W44), ...many(2, 'BUG', W44), ...many(2, 'STORY', W45), ...many(2, 'BUG', W45)])).toEqual([]);
    expect(kinds([...many(2, 'STORY', W44), ...many(2, 'BUG', W44), ...many(2, 'STORY', W45), ...many(2, 'BUG', W45), ...many(5, 'BUG', W46)])).toEqual([]);
  });
  it('compares the last two columns when there are only two', () => {
    const two = { ...spec, from: '2026-11-02' };
    expect(kinds([...many(3, 'STORY', W45), ...many(1, 'BUG', W45), ...many(1, 'STORY', W46), ...many(3, 'BUG', W46)], two)).toContain('share-moved');
  });
  it('needs a time across with two columns', () => {
    expect(kinds([...many(3, 'STORY', W44)], { ...spec, across: 'statusCategory' })).toEqual([]);
    expect(kinds([...many(3, 'STORY', W45)], { ...spec, from: '2026-11-04', to: '2026-11-08' })).toEqual([]);
  });
  it('skips a column with nothing to take a share of', () => {
    expect(kinds([...many(3, 'STORY', W45)])).toEqual([]);
  });
});

describe('grew-fastest', () => {
  it('fires for the row that at least doubled the average growth and added 3 or more items', () => {
    const r = run([...many(1, 'BUG', W44), ...many(3, 'STORY', W44), ...many(5, 'BUG', W45), ...many(3, 'STORY', W45)]);
    const g = r.notable.find((x) => x.kind === 'grew-fastest')!;
    expect(g).toMatchObject({ row: 'v:BUG', column: 'v:2026-11-02', delta: 4 });
    expect(g.message).toBe('Bug grew fastest: from 1 to 5 items between 2026-W44 and 2026-W45, up 4 against 2 on average across rows.');
    expect(g.items).toHaveLength(5);
  });
  it('does not fire for a small gain, or when growth is even', () => {
    expect(kinds([...many(1, 'BUG', W44), ...many(3, 'STORY', W44), ...many(3, 'BUG', W45), ...many(3, 'STORY', W45)])).not.toContain('grew-fastest');
    expect(kinds([...many(1, 'BUG', W44), ...many(1, 'STORY', W44), ...many(5, 'BUG', W45), ...many(5, 'STORY', W45)])).not.toContain('grew-fastest');
  });
  it('is not offered for cycle time, where a higher median is not more work', () => {
    expect(kinds([...many(1, 'BUG', W44), ...many(5, 'BUG', W45), ...many(1, 'STORY', W44)], { ...spec, measure: 'cycleTime' })).not.toContain('grew-fastest');
  });
});

describe('scope-added', () => {
  const rel = (released: boolean | null, start: string | null | 'absent') => [{ id: null, name: '1.4', released, date: null, ...(start === 'absent' ? {} : { start }) }];
  const inRelease = (key: string, created: string, released: boolean | null = false, start: string | null | 'absent' = '2026-10-01') =>
    item(key, { created, releases: rel(released, start) });
  const bySplit: PivotSpec = { measure: 'items', split: 'release' };
  const pv = (items: WorkItem[], s: PivotSpec = bySplit) => pivot({ items, spec: s, asOf: AS_OF }).notable;

  it('counts items created after the release start day, as a share of what it started with', () => {
    const items = [inRelease('A', '2026-09-20T00:00:00Z'), inRelease('B', '2026-09-21T00:00:00Z'), inRelease('C', '2026-10-15T00:00:00Z'), inRelease('D', '2026-10-20T00:00:00Z')];
    const [s] = pv(items);
    expect(s).toMatchObject({ kind: 'scope-added', row: 'v:1.4', column: '(all)', delta: 1, items: ['corp-jira:C', 'corp-jira:D'] });
    expect(s!.message).toBe('1.4: 2 items were added after it started on 2026-10-01, 100% more than the 2 it started with.');
  });
  it('works with the release across, pointing at its column', () => {
    const items = [inRelease('A', '2026-09-20T00:00:00Z'), inRelease('C', '2026-10-15T00:00:00Z'), inRelease('D', '2026-10-16T00:00:00Z')];
    expect(pv(items, { measure: 'items', across: 'release' })[0]).toMatchObject({ row: '(all)', column: 'v:1.4' });
  });
  it('does not fire for a released release, a small share, or fewer than two added', () => {
    expect(pv([inRelease('A', '2026-09-20T00:00:00Z', true), inRelease('C', '2026-10-15T00:00:00Z', true), inRelease('D', '2026-10-16T00:00:00Z', true)])).toEqual([]);
    const small = Array.from({ length: 30 }, (_, i) => inRelease(`S${i}`, '2026-09-20T00:00:00Z'));
    expect(pv([...small, inRelease('Late', '2026-10-15T00:00:00Z'), inRelease('Late2', '2026-10-16T00:00:00Z')])).toEqual([]);
    expect(pv([inRelease('A', '2026-09-20T00:00:00Z'), inRelease('B', '2026-10-22T00:00:00Z')])).toEqual([]);
  });
  it('says nothing about a release with no start day: unknown is not zero, and not a guess', () => {
    const late = [inRelease('A', '2026-09-20T00:00:00Z', false, 'absent'), inRelease('B', '2026-10-15T00:00:00Z', false, 'absent'), inRelease('C', '2026-10-16T00:00:00Z', false, 'absent')];
    expect(pv(late)).toEqual([]);
    expect(pv(late.map((i) => ({ ...i, releases: rel(false, null) })))).toEqual([]);
  });
  it('treats a release that does not say it was released as unreleased', () => {
    expect(pv([inRelease('A', '2026-09-20T00:00:00Z', null), inRelease('C', '2026-10-15T00:00:00Z', null), inRelease('D', '2026-10-16T00:00:00Z', null)])).toHaveLength(1);
  });
});

describe('releaseScope', () => {
  const r = (start: string | null | undefined, date: string | null = null) => [{ id: null, name: '1.4', released: false, date, ...(start === undefined ? {} : { start }) }];
  const done = { statusCategory: 'DONE' as const };
  it('counts what was added after the start, what is done, open and past due', () => {
    const items = [
      item('A', { created: '2026-09-20T09:00:00Z', releases: r('2026-10-01', '2026-11-05'), ...done }),
      item('B', { created: '2026-10-01T09:00:00Z', releases: r('2026-10-01', '2026-11-05') }),
      item('C', { created: '2026-10-02T09:00:00Z', releases: r('2026-10-01', '2026-11-05') }),
      item('X', { releases: [{ id: null, name: '1.5', released: false, date: null }] }),
    ];
    expect(releaseScope(items, '1.4', AS_OF)).toEqual({ start: '2026-10-01', total: 3, added: 1, addedItems: ['corp-jira:C'], done: 1, open: 2, unknownStatus: 0, pastDue: ['corp-jira:B', 'corp-jira:C'], carriedIn: null });
  });
  it('has no added list without a start, and an empty past-due list before the date', () => {
    const s = releaseScope([item('A', { releases: r(undefined, '2026-12-01') })], '1.4', AS_OF);
    expect(s).toMatchObject({ start: null, added: null, addedItems: null, pastDue: [] });
    expect(releaseScope([], '1.4', AS_OF)).toMatchObject({ total: 0, added: null });
  });
});

describe('order', () => {
  it('is share moved, scope added, then fastest growth, each in a fixed order', () => {
    const rel = [{ id: null, name: '1.4', released: false, date: null, start: '2026-10-30' }];
    const started = history(move('2026-10-01T09:00:00Z', 'IN_PROGRESS', 'TODO'));
    const items = [
      ...[...many(1, 'BUG', W44), ...many(3, 'STORY', W44), ...many(5, 'BUG', W45), ...many(3, 'STORY', W45)].map((i) => ({ ...i, releases: rel, history: started })),
    ];
    const r = pivot({ items, spec: { ...spec, across: 'created:week' }, asOf: AS_OF });
    expect(r.notable.map((x) => x.kind)).toEqual(['share-moved', 'share-moved', 'grew-fastest']);
    const r2 = pivot({ items, spec: { ...spec, split: 'release' }, asOf: AS_OF });
    expect(r2.notable.map((x) => x.kind)).toEqual(['scope-added']);
  });
});
