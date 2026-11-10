import { describe, expect, it } from 'vitest';
import { applyFilters, formatFilter, matches, parseWhere } from './filter.js';
import { ctx, item } from './testkit.js';

describe('parseWhere', () => {
  it('reads one value, a list, quotes and either operator', () => {
    expect(parseWhere('status != Done')).toEqual({ dimension: 'status', op: '!=', values: ['Done'] });
    expect(parseWhere('release=1.4, 1.5')).toEqual({ dimension: 'release', op: '=', values: ['1.4', '1.5'] });
    expect(parseWhere('label:team = "blue, green", red')).toEqual({ dimension: 'label:team', op: '=', values: ['blue, green', 'red'] });
    expect(parseWhere('priority = "say \\"hi\\""').values).toEqual(['say "hi"']);
  });
  it('throws a clear message for a bad filter', () => {
    expect(() => parseWhere('status')).toThrow(/Write <dimension> = value/);
    expect(() => parseWhere('status =')).toThrow(/names no value/);
    expect(() => parseWhere('colour = red')).toThrow(/Unknown dimension "colour"/);
    expect(() => parseWhere('area:0 = x')).toThrow(/depth/);
  });
  it('formats back to what it reads', () => {
    for (const t of ['status != Done', 'label:team = "blue, green", red']) expect(parseWhere(formatFilter(parseWhere(t)))).toEqual(parseWhere(t));
  });
});

describe('matching', () => {
  const rel = (name: string) => ({ id: null, name, released: false, date: null });
  const a = item('A', { status: 'Done', releases: [rel('1.4'), rel('1.5')], components: [] });
  const b = item('B', { status: 'Open' });
  it('compares case-insensitively against labels, keys and the none bucket', () => {
    expect(matches(a, [parseWhere('status = done')], ctx())).toBe(true);
    expect(matches(a, [parseWhere('status != done')], ctx())).toBe(false);
    expect(matches(a, [parseWhere('release = 1.5')], ctx())).toBe(true);
    expect(matches(a, [parseWhere('release != 1.4, 9')], ctx())).toBe(false);
    expect(matches(a, [parseWhere('component = none')], ctx())).toBe(true);
    expect(matches(a, [parseWhere('component = "No component"')], ctx())).toBe(true);
    expect(matches(b, [parseWhere('assignee = pat example')], ctx())).toBe(true);
  });
  it('lets an item whose dimension was never read fail "=" and pass "!=", and counts it', () => {
    const r = applyFilters([a, b], [parseWhere('release = 1.4')], ctx());
    expect(r.kept).toEqual([a]);
    expect(r.unjudged).toEqual([{ filter: parseWhere('release = 1.4'), count: 1 }]);
    const n = applyFilters([a, b], [parseWhere('release != 1.4')], ctx());
    expect(n.kept).toEqual([b]);
    expect(n.unjudged[0]!.count).toBe(1);
    expect(applyFilters([a], [parseWhere('release = 1.4')], ctx()).unjudged).toEqual([]);
  });
  it('needs every filter to pass', () => {
    expect(matches(a, [parseWhere('status = Done'), parseWhere('release = 2.0')], ctx())).toBe(false);
    expect(matches(a, [], ctx())).toBe(true);
  });
});
