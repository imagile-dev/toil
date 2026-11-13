import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../owi/types.js';
import { pivot } from './pivot.js';
import { AS_OF, history, item, move, points } from './testkit.js';
import { NONE_KEY, OTHER_KEY, type PivotInput, type PivotSpec } from './types.js';

const run = (items: WorkItem[], spec: PivotSpec, extra: Partial<PivotInput> = {}) => pivot({ items, spec, asOf: AS_OF, ...extra });
const comps = (key: string, components?: string[], extra: Partial<WorkItem> = {}) => item(key, { components, ...extra });
const rowKeys = (r: ReturnType<typeof run>) => r.rows.map((x) => x.label);

describe('a pivot with no split and no across', () => {
  const items = [item('B'), item('A'), item('C')];
  it('is one row and one column holding every item, sorted by id', () => {
    const r = run(items, { measure: 'items' });
    expect(r.rows).toEqual([{ key: '(all)', label: 'All items', kind: 'value' }]);
    expect(r.columns).toHaveLength(1);
    expect(r.cells[0]![0]).toMatchObject({ value: 3, measured: 3, of: 3, items: ['corp-jira:A', 'corp-jira:B', 'corp-jira:C'] });
    expect(r.total.value).toBe(3);
    expect(r.split).toBeNull();
    expect(r.across).toBeNull();
    expect(r.measure).toEqual({ id: 'items', unit: 'items', label: 'Items' });
  });
  it('defaults the period to the 90 days up to asOf', () => {
    expect(run(items, { measure: 'items' }).period).toEqual({ from: '2026-08-13', to: '2026-11-10' });
    expect(run(items, { measure: 'items', from: '2026-01-01', to: '2026-02-01' }).period).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(() => run(items, { measure: 'items', from: '2026-03-01', to: '2026-02-01' })).toThrow(/starts after it ends/);
  });
  it('an empty input is a computed 0, not null', () => {
    expect(run([], { measure: 'items' }).cells[0]![0]).toMatchObject({ value: 0, of: 0 });
  });
});

describe('splitting by a multi-valued dimension', () => {
  const items = [
    comps('A', ['API', 'Web']), comps('B', ['API']), comps('C', ['Web']), comps('D', ['DB']), comps('E', ['Ops']), comps('F', []), comps('G'),
  ];
  const spec: PivotSpec = { measure: 'items', split: 'component', top: 2 };

  it('folds the rest into Other, keeps a none row, and leaves out what was never read', () => {
    const r = run(items, spec);
    expect(r.rows.map((x) => [x.kind, x.label])).toEqual([['value', 'API'], ['value', 'Web'], ['other', 'Other'], ['none', 'No component']]);
    expect(r.rows.map((x) => x.key)).toEqual(['v:api', 'v:web', OTHER_KEY, NONE_KEY]);
    expect(r.cells.map((c) => c[0]!.value)).toEqual([2, 2, 2, 1]);
    expect(r.cells[2]![0]!.items).toEqual(['corp-jira:D', 'corp-jira:E']);
    expect(r.allValues.map((v) => [v.label, v.items])).toEqual([['API', 2], ['Web', 2], ['DB', 1], ['Ops', 1]]);
  });
  it('counts an item once in the totals however many values it holds', () => {
    const r = run(items, spec);
    expect(r.total.value).toBe(6);
    expect(r.rowTotals.reduce((s, c) => s + (c.value ?? 0), 0)).toBe(7);
    expect(r.coverage).toMatchObject({ items: 7, unreadSplit: 1, multi: true, measured: 6 });
    expect(r.coverage.notes).toContain('Components weren\'t read for 1 of the 7 items; they are left out of the table.');
    expect(r.coverage.notes.some((n) => /more than one component/.test(n))).toBe(true);
  });
  it('keeps pinned values, in order, ahead of the largest, and counts them toward the top', () => {
    const r = run(items, { ...spec, pin: ['ops', 'Nothing'] });
    expect(rowKeys(r)).toEqual(['Ops', 'API', 'Other', 'No component']);
    expect(r.cells[2]![0]!.items).toEqual(['corp-jira:A', 'corp-jira:C', 'corp-jira:D']);
  });
  it('keeps every value with top 0, and has no Other row when nothing folded', () => {
    expect(rowKeys(run(items, { ...spec, top: 0 }))).toEqual(['API', 'Web', 'DB', 'Ops', 'No component']);
    expect(rowKeys(run(items, { ...spec, top: 4 }))).toEqual(['API', 'Web', 'DB', 'Ops', 'No component']);
    expect(rowKeys(run(items.slice(0, 2), { ...spec, top: 0 }))).toEqual(['API', 'Web']);
  });
  it('has no none row when nothing is in it', () => {
    expect(run([comps('A', ['API'])], spec).rows.map((x) => x.kind)).toEqual(['value']);
  });
});

describe('a dimension nobody read', () => {
  const items = [comps('A'), comps('B'), comps('C')];
  it('comes back empty with a sentence saying so', () => {
    const r = run(items, { measure: 'items', split: 'component' });
    expect(r.split).toMatchObject({ spec: 'component', read: false });
    expect([r.rows, r.columns, r.cells, r.rowTotals, r.columnTotals]).toEqual([[], [], [], [], []]);
    expect(r.total).toMatchObject({ value: null, measured: 0 });
    expect(r.coverage.notes[0]).toBe('Components weren\'t read for any of the 3 items.');
    expect(r.coverage.unreadSplit).toBe(3);
  });
  it('is the same for the across axis, and uses the dimension\'s own noun', () => {
    const r = run(items, { measure: 'items', across: 'release' });
    expect(r.across!.read).toBe(false);
    expect(r.coverage.notes[0]).toBe('Fix versions weren\'t read for any of the 3 items.');
  });
});

describe('across time', () => {
  const at = (key: string, created: string, extra: Partial<WorkItem> = {}) => item(key, { created, ...extra });
  const items = [at('A', '2026-10-21T10:00:00Z'), at('B', '2026-10-22T10:00:00Z'), at('C', '2026-11-03T10:00:00Z'), at('D', '2026-09-01T10:00:00Z')];
  const spec: PivotSpec = { measure: 'items', across: 'created:week', from: '2026-10-19', to: '2026-11-10' };
  it('has a column for every bucket in the period, in order, and an empty one is a real 0', () => {
    const r = run(items, spec);
    expect(r.columns.map((c) => c.label)).toEqual(['2026-W43', '2026-W44', '2026-W45', '2026-W46']);
    expect(r.cells[0]!.map((c) => c.value)).toEqual([2, 0, 1, 0]);
    expect(r.cells[0]![1]).toMatchObject({ items: [], measured: 0, of: 0 });
  });
  it('says how many items fall outside the period and leaves them out of the totals', () => {
    const r = run(items, spec);
    expect(r.total.value).toBe(3);
    expect(r.coverage.notes).toContain('1 item has no created date between 2026-10-19 and 2026-11-10, so it is not in the table.');
  });
  it('treats an unread start (no history) as unread, not as a gap', () => {
    const r = run(items, { ...spec, across: 'started:week' });
    expect(r.across!.read).toBe(false);
    expect(r.coverage.notes[0]).toBe('Start dates weren\'t read for any of the 4 items.');
  });
});

describe('null versus 0 in the cells', () => {
  const items = [
    item('A', { type: 'BUG', estimate: points(3) }), item('B', { type: 'BUG', estimate: points(2) }),
    item('C', { type: 'STORY' }), item('D', { type: 'TASK', estimate: points(5), assignee: { id: 'sam', name: 'Sam', email: null } }),
  ];
  it('is null with a reason where cell items carry no estimate, and 0 where the cell holds nothing', () => {
    const r = run(items, { measure: 'estimate', split: 'type', across: 'assignee', top: 0 });
    const row = (label: string) => r.rows.findIndex((x) => x.label === label);
    const col = (label: string) => r.columns.findIndex((x) => x.label === label);
    const story = r.cells[row('Story')]![col('Pat Example')]!;
    expect(story).toMatchObject({ value: null, measured: 0, of: 1 });
    expect(story.reason).toBe('None of the 1 item has an estimate in points.');
    expect(r.cells[row('Bug')]![col('Pat Example')]).toMatchObject({ value: 5, measured: 2, of: 2 });
    expect(r.cells[row('Bug')]![col('Sam')]).toMatchObject({ value: 0, measured: 0, of: 0, items: [] });
    expect(r.total).toMatchObject({ value: 10, measured: 3, of: 4 });
    expect(r.coverage.notes).toContain('3 of 4 items have an estimate in points; the other 1 are left out.');
    expect(r.measure.unit).toBe('points');
  });
});

describe('parents', () => {
  const parent = item('E1', { type: 'EPIC', title: 'The epic', children: ['corp-jira:C1', 'corp-jira:C2'] });
  const c1 = item('C1', { parent: parent.id }); const c2 = item('C2', { parent: parent.id }); const lone = item('L');
  const items = [parent, c1, c2, lone];
  it('leaves parents out when splitting by a parent dimension, and says so', () => {
    const r = run(items, { measure: 'items', split: 'parent' });
    expect(r.rows.map((x) => x.label)).toEqual(['E1 The epic', 'No parent']);
    expect(r.cells.map((c) => c[0]!.value)).toEqual([2, 1]);
    expect(r.coverage.parentsLeftOut).toBe(1);
    expect(r.coverage.items).toBe(3);
    expect(r.coverage.notes[0]).toMatch(/1 parent item is left out/);
  });
  it('puts them back on request', () => {
    const r = run(items, { measure: 'items', split: 'parent', includeParents: true });
    expect(r.cells.map((c) => c[0]!.value)).toEqual([2, 2]);
    expect(r.coverage.parentsLeftOut).toBe(0);
  });
  it('does not leave parents out for other dimensions', () => {
    expect(run(items, { measure: 'items', split: 'type' }).total.value).toBe(4);
  });
});

describe('share, filters and categories', () => {
  const items = [item('A', { type: 'BUG' }), item('B', { type: 'BUG' }), item('C', { type: 'STORY' }), item('D', { type: 'STORY' }), item('E', { type: 'STORY' }), item('F', { type: 'STORY' })];
  it('gives each cell its share of the column, and null where the column is empty or unmeasured', () => {
    const r = run(items, { measure: 'items', split: 'type', across: 'statusCategory', share: true, top: 0 });
    expect(r.cells.map((c) => c[0]!.share)).toEqual([4 / 6, 2 / 6].map((x) => Math.round(x * 10000) / 10000));
    const e = run(items, { measure: 'estimate', split: 'type', share: true });
    expect(e.cells.map((c) => c[0]!.share)).toEqual([null, null]);
  });
  it('applies filters and says how many items a filter could not judge', () => {
    const r = run(items, { measure: 'items', where: [{ dimension: 'type', op: '=', values: ['bug'] }] });
    expect(r.total.value).toBe(2);
    const u = run(items, { measure: 'items', where: [{ dimension: 'release', op: '!=', values: ['1.4'] }] });
    expect(u.total.value).toBe(6);
    expect(u.coverage.notes[0]).toBe('The filter "release != 1.4" could not judge 6 items because fix versions weren\'t read; they are kept in.');
  });
  it('orders categories by the scheme, with their short form, and Unsure last', () => {
    const scheme = { name: 'Investment', revision: 1, categories: [{ id: 'ktlo', name: 'Keep the lights on', short: 'KTLO' }, { id: 'growth', name: 'Growth', short: 'GRO' }] };
    const categories = { [items[0]!.id]: 'growth', [items[1]!.id]: 'ktlo', [items[2]!.id]: 'ktlo', [items[3]!.id]: null };
    const r = run(items, { measure: 'items', split: 'category' }, { categories, scheme });
    expect(r.rows.map((x) => [x.label, x.short, x.kind])).toEqual([['Keep the lights on', 'KTLO', 'value'], ['Growth', 'GRO', 'value'], ['Unsure', undefined, 'none']]);
    expect(r.coverage.unreadSplit).toBe(2);
    const none = run(items, { measure: 'items', split: 'category' });
    expect(none.split!.read).toBe(false);
  });
});

describe('other measures through the pivot', () => {
  it('carries p85 for cycle time and counts wip as real counts', () => {
    const done = (key: string, from: string, to: string) => item(key, { statusCategory: 'DONE', resolved: to, history: history(move(from, 'IN_PROGRESS', 'TODO'), move(to, 'DONE', 'IN_PROGRESS')) });
    const items = [done('A', '2026-11-02T00:00:00Z', '2026-11-04T00:00:00Z'), done('B', '2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z'), item('C')];
    const r = run(items, { measure: 'cycleTime' });
    expect(r.total).toMatchObject({ value: 2, p85: 3, measured: 2, of: 2 });
    expect(r.cells[0]![0]!.p85).toBe(3);
    expect(run(items, { measure: 'wip', split: 'statusCategory' }).cells.map((c) => c[0]!.value)).toEqual([1, 0]);
  });
  it('lists pull requests it does not count', () => {
    const r = run([item('A')], { measure: 'items' }, { changes: [{ id: 'x' } as never] });
    expect(r.coverage.notes).toContain('1 pull request in the input is not counted: no measure reads them yet.');
  });
});

describe('determinism', () => {
  it('gives deep-equal results for the same input, with asOf passed in', () => {
    const items = [comps('A', ['API', 'Web'], { created: '2026-11-02T00:00:00Z' }), comps('B', ['API'], { created: '2026-10-05T00:00:00Z' }), comps('C', [])];
    const input: PivotInput = { items, spec: { measure: 'items', split: 'component', across: 'created:month', share: true }, asOf: AS_OF };
    expect(pivot(input)).toEqual(pivot(input));
    expect(JSON.parse(JSON.stringify(pivot(input)))).toEqual(JSON.parse(JSON.stringify(pivot(input))));
    expect(() => pivot({ ...input, asOf: 'soon' })).toThrow(/asOf must be an ISO/);
    expect(() => pivot({ ...input, spec: { measure: 'speed' as never } })).toThrow(/Unknown measure/);
  });
});

describe('a release axis', () => {
  const rel = (name: string, date: string | null) => ({ id: null, name, released: false, date });
  const releases = [rel('1.1', '2026-01-10'), rel('1.2', '2026-03-10'), rel('1.3', '2026-06-10'), rel('1.4', '2026-09-10'), rel('1.5', '2026-10-10'), rel('next', null)];
  const items = releases.flatMap((r, i) => Array.from({ length: releases.length - i }, (_, n) => item(`R${i}-${n}`, { releases: [r] })));
  it('reads in date order, undated last, and keeps every value when top is 0', () => {
    expect(rowKeys(run(items, { measure: 'items', split: 'release', top: 0 }))).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', 'next']);
  });
  it('folds to the latest top values, in order, with the rest in Other', () => {
    const r = run(items, { measure: 'items', split: 'release', top: 3 });
    expect(rowKeys(r)).toEqual(['1.4', '1.5', 'next', 'Other']);
    expect(r.rows.at(-1)!.kind).toBe('other');
    expect(r.rowTotals.at(-1)!.value).toBe(6 + 5 + 4);
  });
  it('keeps a pinned release even when it is old, and counts it inside top', () => {
    const r = run(items, { measure: 'items', split: 'release', top: 3, pin: ['1.1'] });
    expect(rowKeys(r)).toEqual(['1.1', '1.5', 'next', 'Other']);
  });
  it('never folds a time axis', () => {
    const r = run(items, { measure: 'items', across: 'created:month', top: 1 });
    expect(r.columns.every((c) => c.kind === 'value')).toBe(true);
  });
});
