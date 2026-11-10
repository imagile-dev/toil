import { describe, expect, it } from 'vitest';
import { bucketLabel, bucketStart, bucketsBetween, DIMENSION_MENU, parseDimension, projectOf, valuesOf } from './dimensions.js';
import { AS_OF, ctx, history, item, move, points } from './testkit.js';

const vals = (spec: string, i = item('PAY-1'), c = ctx()) => valuesOf(i, parseDimension(spec), c);
const labels = (spec: string, i = item('PAY-1'), c = ctx()) => {
  const v = vals(spec, i, c);
  return v.unread ? 'unread' : v.values.map((x) => x.label);
};

describe('parseDimension', () => {
  it('reads every base, with and without its argument', () => {
    expect(parseDimension('release')).toMatchObject({ base: 'release', arg: null, kind: 'multi', label: 'Fix version', noneLabel: 'No fix version' });
    expect(parseDimension('area:3')).toMatchObject({ base: 'area', arg: '3', kind: 'single' });
    expect(parseDimension('parent:Epic')).toMatchObject({ kind: 'parent', label: 'Parent › Epic' });
    expect(parseDimension('created')).toMatchObject({ kind: 'time', label: 'Created, by week', noneLabel: null });
    expect(parseDimension('resolved:quarter').label).toBe('Resolved, by quarter');
    expect(parseDimension('dim:customer')).toMatchObject({ base: 'dim', arg: 'customer', label: 'customer', noneLabel: 'No customer' });
    expect(parseDimension('label:team').label).toBe('Label › team');
  });

  it('names the bad part and what is allowed', () => {
    expect(() => parseDimension('colour')).toThrow(/Unknown dimension "colour".*category/);
    expect(() => parseDimension('created:day')).toThrow(/Unknown grain "day".*week, month, quarter/);
    expect(() => parseDimension('dim:')).toThrow(/dim:<name>/);
    expect(() => parseDimension('dim')).toThrow(/needs a name/);
    expect(() => parseDimension('area:0')).toThrow(/whole number of 1 or more/);
    expect(() => parseDimension('status:Done')).toThrow(/takes no argument/);
    expect(() => parseDimension('label:')).toThrow(/nothing after the colon/);
  });

  it('offers a menu of every base with a default, in an order', () => {
    const specs = DIMENSION_MENU.map((m) => m.spec);
    expect(specs.slice(0, 3)).toEqual(['category', 'type', 'statusCategory']);
    expect(specs).toContain('release');
    expect(specs).toContain('resolved:month');
    expect(new Set(specs).size).toBe(specs.length);
    for (const m of DIMENSION_MENU) expect(parseDimension(m.spec).label).toBe(m.label);
  });
});

describe('calendar buckets', () => {
  it('starts weeks on Monday and labels the ISO week, month and quarter', () => {
    expect(bucketStart('2026-11-10', 'week')).toBe('2026-11-09');
    expect(bucketStart('2026-11-08', 'week')).toBe('2026-11-02');
    expect(bucketLabel('2026-11-09', 'week')).toBe('2026-W46');
    expect(bucketLabel('2025-12-29', 'week')).toBe('2026-W01');
    expect(bucketLabel('2026-11-01', 'month')).toBe('Nov 2026');
    expect(bucketLabel(bucketStart('2026-11-10', 'quarter'), 'quarter')).toBe('Q4 2026');
    expect(bucketsBetween('2026-10-01', '2026-11-10', 'month')).toEqual(['2026-10-01', '2026-11-01']);
  });
});

describe('single-valued dimensions', () => {
  it('reads type, status, priority, assignee and the key-derived ones', () => {
    expect(labels('type', item('PAY-1', { type: 'BUG' }))).toEqual(['Bug']);
    expect(labels('statusCategory')).toEqual(['In progress']);
    expect(labels('status', item('PAY-1', { status: null }))).toEqual([]);
    expect(labels('priority')).toEqual(['Medium']);
    expect(labels('assignee')).toEqual(['Pat Example']);
    expect(labels('assignee', item('PAY-1', { assignee: null }))).toEqual([]);
    expect(labels('project')).toEqual(['PAY']);
    expect(labels('tracker')).toEqual(['jira']);
    expect(labels('connection')).toEqual(['corp-jira']);
    expect(labels('iteration', item('PAY-1', { iteration: { id: 's1', name: 'Sprint 7', path: null, start: null, end: null, state: null } }))).toEqual(['Sprint 7']);
  });

  it('derives the project from the key of each tracker', () => {
    expect(projectOf(item('PAY-12'))).toBe('PAY');
    expect(projectOf(item('imagile/payments-web#41', { source: { area: 'github', connection: 'gh', key: 'imagile/payments-web#41', command: 'x' } }))).toBe('imagile/payments-web');
    expect(projectOf(item('2302', { source: { area: 'ado', connection: 'corp-ado', key: '2302', command: 'x' } }))).toBe('ado');
  });

  it('cuts an area path at a depth, unread when the read never fetched it', () => {
    const i = item('PAY-1', { area: { path: 'Imagile\\Payments\\Web' } });
    expect(labels('area', i)).toEqual(['Imagile › Payments']);
    expect(labels('area:3', i)).toEqual(['Imagile › Payments › Web']);
    expect(labels('area:1', i)).toEqual(['Imagile']);
    expect(labels('area', item('PAY-1', { area: null }))).toEqual([]);
    expect(labels('area')).toBe('unread');
  });
});

describe('multi-valued dimensions: unread, none and values', () => {
  const rel = (name: string, released: boolean | null = false) => ({ id: null, name, released, date: null });
  it('release and affects: absent is unread, [] is none', () => {
    expect(labels('release')).toBe('unread');
    expect(labels('release', item('PAY-1', { releases: [] }))).toEqual([]);
    expect(labels('release', item('PAY-1', { releases: [rel('1.4'), rel('1.5'), rel('1.4')] }))).toEqual(['1.4', '1.5']);
    expect(labels('affects')).toBe('unread');
    expect(labels('affects', item('PAY-1', { affects: [rel('1.3')] }))).toEqual(['1.3']);
  });

  it('component and sprint and dim', () => {
    expect(labels('component')).toBe('unread');
    expect(labels('component', item('PAY-1', { components: ['API', 'Web'] }))).toEqual(['API', 'Web']);
    expect(labels('component', item('PAY-1', { components: [] }))).toEqual([]);
    expect(labels('sprint')).toBe('unread');
    const s = (name: string, start: string | null) => ({ id: name, name, path: null, start, end: null, state: null });
    const v = vals('sprint', item('PAY-1', { sprints: [s('S1', '2026-10-01T00:00:00Z'), s('S2', null)] }));
    expect(v).toMatchObject({ unread: false, values: [{ label: 'S1', order: '2026-10-01' }, { label: 'S2' }] });
    expect(labels('dim:customer')).toBe('unread');
    expect(labels('dim:customer', item('PAY-1', { dims: { region: ['EU'] } }))).toBe('unread');
    expect(labels('dim:customer', item('PAY-1', { dims: { customer: ['Acme', 'Globex'] } }))).toEqual(['Acme', 'Globex']);
    expect(labels('dim:customer', item('PAY-1', { dims: { customer: [] } }))).toEqual([]);
  });

  it('labels: all of them, or a family without its prefix', () => {
    const i = item('PAY-1', { labels: ['bug', 'team:blue', 'Team:red', 'ops'] });
    expect(labels('label', i)).toEqual(['bug', 'team:blue', 'Team:red', 'ops']);
    expect(labels('label:team', i)).toEqual(['blue', 'red']);
    expect(labels('label:cost', i)).toEqual([]);
    expect(labels('label', item('PAY-1'))).toEqual([]);
  });
});

describe('parents', () => {
  const index = new Map([['corp-jira:PAY-9', item('PAY-9', { title: 'The epic' })]]);
  it('names the direct parent by key and title when it is in the input, else by id', () => {
    expect(labels('parent', item('PAY-1', { parent: 'corp-jira:PAY-9' }), ctx({ index }))).toEqual(['PAY-9 The epic']);
    expect(labels('parent', item('PAY-1', { parent: 'corp-jira:PAY-77' }), ctx({ index }))).toEqual(['PAY-77']);
    expect(labels('parent', item('PAY-1'))).toEqual([]);
  });

  it('needs the ancestors for the top and for a type', () => {
    const chain = [
      { id: 'corp-jira:PAY-5', type: 'STORY' as const, typeName: 'Feature', title: 'The feature' },
      { id: 'corp-jira:PAY-9', type: 'EPIC' as const, typeName: 'Epic', title: 'The epic' },
    ];
    const child = item('PAY-1', { parent: 'corp-jira:PAY-5', ancestors: chain });
    expect(labels('parent:top', child, ctx({ index }))).toEqual(['PAY-9 The epic']);
    expect(labels('parent:epic', child, ctx({ index }))).toEqual(['PAY-9 The epic']);
    expect(labels('parent:Feature', child)).toEqual(['PAY-5 The feature']);
    expect(labels('parent:Initiative', child)).toEqual([]);
    expect(labels('parent:top', item('PAY-1', { parent: 'corp-jira:PAY-5' }))).toBe('unread');
    expect(labels('parent:Epic', item('PAY-1', { parent: 'corp-jira:PAY-5' }))).toBe('unread');
    expect(labels('parent:top', item('PAY-1'))).toEqual([]);
    expect(labels('parent:top', item('PAY-1', { parent: 'corp-jira:PAY-5', ancestors: [] }))).toEqual(['PAY-5']);
  });

  it('hasEpic reads the chain, or knows a root has none', () => {
    expect(labels('hasEpic', item('PAY-1'))).toEqual([]);
    expect(labels('hasEpic', item('PAY-1', { parent: 'corp-jira:PAY-5' }))).toBe('unread');
    expect(labels('hasEpic', item('PAY-1', { parent: 'x:1', ancestors: [{ id: 'x:1', type: 'EPIC', typeName: null, title: 't' }] }))).toEqual(['Has an epic']);
    expect(labels('hasEpic', item('PAY-1', { parent: 'x:1', ancestors: [] }))).toEqual([]);
  });
});

describe('team', () => {
  const people = [{ name: 'Pat Example', team: 'Blue', email: 'pat@example.com', ids: { jira: 'pat.e' } }, { name: 'Sam', email: 'sam@example.com' }];
  it('uses the item team first, then the assignee matched to a person', () => {
    expect(labels('team', item('PAY-1', { team: 'Red' }), ctx({ people }))).toEqual(['Red']);
    expect(labels('team', item('PAY-1'), ctx({ people }))).toEqual(['Blue']);
    expect(labels('team', item('PAY-1', { assignee: { id: 'PAT.E', name: null, email: null } }), ctx({ people }))).toEqual(['Blue']);
    expect(labels('team', item('PAY-1', { assignee: { id: 'sam', name: 'SAM', email: null } }), ctx({ people }))).toEqual([]);
    expect(labels('team', item('PAY-1', { assignee: { id: 'zed', name: 'Zed', email: null } }), ctx({ people }))).toEqual([]);
  });
  it('is unread for an assignee nobody told us the team of, and none for no assignee', () => {
    expect(labels('team', item('PAY-1'))).toBe('unread');
    expect(labels('team', item('PAY-1', { assignee: null }))).toEqual([]);
  });
});

describe('category', () => {
  const scheme = { name: 'Investment', revision: 1, categories: [{ id: 'ktlo', name: 'Keep the lights on', short: 'KTLO' }, { id: 'growth', name: 'Growth', short: 'GRO' }] };
  const i = item('PAY-1');
  it('is unread without a map or without the item in it', () => {
    expect(labels('category', i)).toBe('unread');
    expect(labels('category', i, ctx({ categories: {}, scheme }))).toBe('unread');
  });
  it('names a verdict with the scheme, and a null verdict is none', () => {
    expect(vals('category', i, ctx({ categories: { [i.id]: 'growth' }, scheme }))).toEqual({ unread: false, values: [{ key: 'v:growth', label: 'Growth', short: 'GRO', order: '0001' }] });
    expect(labels('category', i, ctx({ categories: { [i.id]: null }, scheme }))).toEqual([]);
    expect(parseDimension('category').noneLabel).toBe('Unsure');
    expect(labels('category', i, ctx({ categories: { [i.id]: 'gone' } }))).toEqual(['gone']);
  });
});

describe('time dimensions', () => {
  it('buckets inside the period only, with no none bucket', () => {
    const i = item('PAY-1', { created: '2026-11-04T10:00:00Z', resolved: '2026-11-10T09:00:00Z' });
    expect(vals('created', i)).toEqual({ unread: false, values: [{ key: 'v:2026-11-02', label: '2026-W45', order: '2026-11-02' }] });
    expect(labels('created:month', i)).toEqual(['Nov 2026']);
    expect(labels('resolved:quarter', i)).toEqual(['Q4 2026']);
    expect(labels('created', item('PAY-1', { created: '2026-01-01T00:00:00Z' }))).toEqual([]);
    expect(labels('resolved', item('PAY-1'))).toEqual([]);
  });
  it('started is unread without a history, and a gap with one that never moved in', () => {
    expect(labels('started', item('PAY-1'))).toBe('unread');
    expect(labels('started', item('PAY-1', { history: history() }))).toEqual([]);
    expect(labels('started:month', item('PAY-1', { history: history(move('2026-10-20T08:00:00Z', 'IN_PROGRESS', 'TODO')) }))).toEqual(['Oct 2026']);
  });
});

describe('derived dimensions', () => {
  it('age buckets the days since started for work in progress', () => {
    const at = (iso: string) => item('PAY-1', { history: history(move(iso, 'IN_PROGRESS')) });
    expect(labels('age', at('2026-11-09T12:00:00Z'))).toEqual(['0-2 d']);
    expect(labels('age', at('2026-11-05T12:00:00Z'))).toEqual(['3-7 d']);
    expect(labels('age', at('2026-10-30T12:00:00Z'))).toEqual(['8-14 d']);
    expect(labels('age', at('2026-10-20T12:00:00Z'))).toEqual(['15-30 d']);
    expect(labels('age', at('2026-08-20T12:00:00Z'))).toEqual(['over 30 d']);
    expect(labels('age', item('PAY-1'))).toBe('unread');
    expect(labels('age', item('PAY-1', { statusCategory: 'DONE' }))).toEqual([]);
    const orders = ['2026-11-09', '2026-10-01'].map((d) => (vals('age', at(`${d}T12:00:00Z`)) as { values: Array<{ order: string }> }).values[0]!.order);
    expect(orders[0]! < orders[1]!).toBe(true);
  });
  it('size buckets the estimate by its unit, none without one', () => {
    const sized = (value: number, unit: 'points' | 'hours' | 'days' = 'points') => item('PAY-1', { estimate: { value, unit, field: 'f' } });
    expect([1, 3, 5, 8, 13].map((n) => labels('size', sized(n)))).toEqual([['1'], ['2-3'], ['5'], ['8'], ['13+']]);
    expect(labels('size', sized(3, 'hours'))).toEqual(['up to 4 h']);
    expect(labels('size', sized(3, 'days'))).toEqual(['up to 5 d']);
    expect(labels('size', item('PAY-1'))).toEqual([]);
    expect(labels('size', item('PAY-1', { estimate: points(2) }))).toEqual(['2-3']);
  });
  it('planned: late additions and incidents are unplanned', () => {
    const sprint = { id: 'S1', name: 'S1', path: null, start: '2026-11-02T00:00:00Z', end: '2026-11-13T00:00:00Z', state: 'current' as const };
    const added = (at: string) => item('PAY-1', { iteration: sprint, history: { transitions: [], iterations: [{ from: [], to: ['S1'], at, by: null }] } });
    expect(labels('planned', added('2026-10-28T00:00:00Z'))).toEqual(['Planned']);
    expect(labels('planned', added('2026-11-05T00:00:00Z'))).toEqual(['Unplanned']);
    expect(labels('planned', item('PAY-1', { type: 'INCIDENT' }))).toEqual(['Unplanned']);
    expect(labels('planned', item('PAY-1'))).toBe('unread');
    expect(labels('planned', item('PAY-1', { history: history() }))).toEqual([]);
  });
  it('carried uses the sprints, or the history without them', () => {
    const s = (n: string) => ({ id: n, name: n, path: null, start: null, end: null, state: null });
    expect(labels('carried', item('PAY-1', { sprints: [s('a'), s('b')] }))).toEqual(['Carried over']);
    expect(labels('carried', item('PAY-1', { sprints: [s('a')] }))).toEqual([]);
    const h = { transitions: [], iterations: [{ from: [], to: ['a'], at: AS_OF, by: null }, { from: ['a'], to: ['b'], at: AS_OF, by: null }] };
    expect(labels('carried', item('PAY-1', { history: h }))).toEqual(['Carried over']);
    expect(labels('carried', item('PAY-1'))).toBe('unread');
  });
  it('reopened needs a history', () => {
    expect(labels('reopened', item('PAY-1'))).toBe('unread');
    expect(labels('reopened', item('PAY-1', { history: history(move('2026-11-01T00:00:00Z', 'IN_PROGRESS', 'DONE')) }))).toEqual(['Reopened']);
    expect(labels('reopened', item('PAY-1', { history: history(move('2026-11-01T00:00:00Z', 'DONE', 'IN_PROGRESS')) }))).toEqual([]);
  });
});
