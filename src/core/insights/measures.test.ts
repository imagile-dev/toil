import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../owi/types.js';
import { computeMeasure, estimateUnit, percentile, personDays, type MeasureContext } from './measures.js';
import { AS_OF, history, item, move, points } from './testkit.js';

const period = { from: '2026-11-02', to: '2026-11-10' }; // A Monday to the Tuesday asOf falls on.
const mctx = (items: WorkItem[], extra: Partial<MeasureContext> = {}): MeasureContext => ({
  asOf: AS_OF, period, unit: estimateUnit(items), days: personDays(items, period, AS_OF), ...extra,
});
const run = (m: Parameters<typeof computeMeasure>[0], items: WorkItem[], c = mctx(items)) => computeMeasure(m, items, c);

const sam = { id: 'sam', name: 'Sam', email: null };
const pat = { id: 'pat', name: 'Pat', email: null };
const span = (from: string, to: string | null) => history(move(from, 'IN_PROGRESS', 'TODO'), ...(to ? [move(to, 'DONE', 'IN_PROGRESS')] : []));

describe('percentiles', () => {
  it('are nearest-rank on sorted values', () => {
    const v = [1, 2, 3, 4, 10];
    expect([percentile(v, 0.5), percentile(v, 0.85), percentile([7], 0.85)]).toEqual([3, 10, 7]);
  });
});

describe('items, wip, throughput', () => {
  const a = item('A', { statusCategory: 'DONE', resolved: '2026-11-05T10:00:00Z' });
  const b = item('B', { statusCategory: 'DONE', resolved: '2026-09-05T10:00:00Z' });
  const c = item('C');
  it('count items, and an empty set is a real 0', () => {
    expect(run('items', [a, b, c])).toMatchObject({ value: 3, measured: 3, of: 3 });
    expect(run('items', [])).toMatchObject({ value: 0, measured: 0, of: 0 });
    expect(run('wip', [a, c])).toMatchObject({ value: 1, of: 2 });
    expect(run('wip', [a]).value).toBe(0);
  });
  it('throughput counts items resolved inside the period and says what had no date', () => {
    expect(run('throughput', [a, b, c], mctx([a, b, c])).value).toBe(1);
    expect(run('throughput', []).value).toBe(0);
    const nodate = item('D', { statusCategory: 'DONE', resolved: null });
    const t = run('throughput', [a, nodate]);
    expect(t).toMatchObject({ value: 1, measured: 1, of: 2 });
    expect(t.reason).toMatch(/1 finished item has no resolved date/);
  });
});

describe('estimate', () => {
  const items = [item('A', { estimate: points(2) }), item('B', { estimate: points(3) }), item('C', { estimate: { value: 4, unit: 'hours', field: 'h' } }), item('D')];
  it('adds up in the unit most items use and counts the rest', () => {
    expect(estimateUnit(items)).toBe('points');
    const cell = run('estimate', items, mctx(items));
    expect(cell).toMatchObject({ value: 5, measured: 2, of: 4 });
    expect(cell.reason).toBe('2 of 4 items have an estimate in points; the other 2 are left out.');
  });
  it('is null, with a reason, where nothing has an estimate, and 0 for an empty cell', () => {
    const none = run('estimate', [items[3]!], mctx(items));
    expect(none).toMatchObject({ value: null, measured: 0, of: 1 });
    expect(none.reason).toBe('None of the 1 item has an estimate in points.');
    expect(run('estimate', [], mctx(items))).toMatchObject({ value: 0, of: 0 });
  });
});

describe('days in progress (person-days)', () => {
  // Pat: A Mon 09:00 to Wed 09:00, B Tue 10:00 to Thu 10:00. Mon is A alone; Tue and Wed are split; Thu is B alone.
  const A = item('A', { assignee: pat, history: span('2026-11-02T09:00:00Z', '2026-11-04T09:00:00Z'), statusCategory: 'DONE' });
  const B = item('B', { assignee: pat, history: span('2026-11-03T10:00:00Z', '2026-11-05T10:00:00Z'), statusCategory: 'DONE' });
  // Sam: Fri 08:00 to Mon 08:00, so the weekend is not worked.
  const C = item('C', { assignee: sam, history: span('2026-11-06T08:00:00Z', '2026-11-09T08:00:00Z'), statusCategory: 'DONE' });
  // Nobody on it: its own person, so no one shares its day.
  const D = item('D', { assignee: null, history: span('2026-11-02T12:00:00Z', '2026-11-03T12:00:00Z'), statusCategory: 'DONE' });
  const E = item('E', { assignee: pat });
  const all = [A, B, C, D, E];

  it('splits a person-day across their items and skips weekends', () => {
    const d = personDays(all, period, AS_OF);
    expect([d.get(A.id), d.get(B.id), d.get(C.id), d.get(D.id), d.get(E.id)]).toEqual([2, 2, 2, 2, null]);
  });
  it('sums a cell and keeps unmeasured items out of it', () => {
    expect(run('days', [A, B], mctx(all))).toMatchObject({ value: 4, measured: 2, of: 2 });
    const mixed = run('days', [A, E], mctx(all));
    expect(mixed).toMatchObject({ value: 2, measured: 1, of: 2 });
    expect(mixed.reason).toMatch(/was not read for 1 of 2 items/);
  });
  it('is null where no history was read, and 0 where a history shows no days', () => {
    expect(run('days', [E], mctx(all))).toMatchObject({ value: null, measured: 0, of: 1 });
    const early = item('F', { assignee: sam, history: span('2026-09-01T09:00:00Z', '2026-09-03T09:00:00Z'), statusCategory: 'DONE' });
    expect(run('days', [early], mctx([early]))).toMatchObject({ value: 0, measured: 1, of: 1 });
    expect(run('days', [], mctx(all)).value).toBe(0);
  });
  it('runs to asOf for work still open, and clips to the period', () => {
    const open = item('G', { assignee: sam, history: span('2026-10-20T09:00:00Z', null) });
    // Mon 2 to Tue 10 inside the period: Nov 2-6 and 9-10 are seven working days.
    expect(personDays([open], period, AS_OF).get(open.id)).toBe(7);
  });
  it('leaves out an item in progress now whose history never saw it start', () => {
    expect(personDays([item('H', { history: history() })], period, AS_OF).get('corp-jira:H')).toBeNull();
  });
});

describe('cycle time and aging', () => {
  const done = (key: string, started: string, resolved: string) => item(key, { statusCategory: 'DONE', resolved, history: span(started, resolved) });
  const finished = [
    done('A', '2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z'),
    done('B', '2026-11-03T00:00:00Z', '2026-11-05T00:00:00Z'),
    done('C', '2026-11-02T00:00:00Z', '2026-11-05T00:00:00Z'),
    done('D', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z'),
    done('E', '2026-10-26T00:00:00Z', '2026-11-05T00:00:00Z'),
  ];
  it('is the median with p85 beside it', () => {
    expect(run('cycleTime', finished, mctx(finished))).toMatchObject({ value: 3, p85: 10, measured: 5, of: 5 });
  });
  it('is null when nothing finished, or no start could be read, never 0', () => {
    const todo = [item('T', { statusCategory: 'TODO' })];
    const none = run('cycleTime', todo, mctx(todo));
    expect(none).toMatchObject({ value: null, p85: null, measured: 0, of: 0 });
    expect(none.reason).toBe('No item was resolved in the period.');
    const nohist = item('N', { statusCategory: 'DONE', resolved: '2026-11-05T00:00:00Z' });
    const c = run('cycleTime', [nohist, finished[0]!], mctx([nohist]));
    expect(c).toMatchObject({ value: 1, measured: 1, of: 2 });
    expect(c.reason).toMatch(/1 of 2 finished items had a start date/);
    expect(run('cycleTime', [nohist], mctx([nohist])).reason).toMatch(/No start date could be read/);
  });
  it('ages open work from its start to asOf', () => {
    const open = [item('A', { history: span('2026-11-09T12:00:00Z', null) }), item('B', { history: span('2026-11-05T12:00:00Z', null) }), item('C')];
    const a = run('aging', open, mctx(open));
    expect(a).toMatchObject({ value: 1, p85: 5, measured: 2, of: 3 });
    expect(a.reason).toMatch(/2 of 3 items in progress had a start date/);
    expect(run('aging', [], mctx([])).value).toBeNull();
  });
});
