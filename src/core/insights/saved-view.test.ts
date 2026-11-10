import { describe, expect, it } from 'vitest';
import { readSavedView, specFromQuery, specToQuery, viewToSpec } from './saved-view.js';
import type { PivotSpec } from './types.js';

describe('readSavedView', () => {
  const good = {
    title: 'Release mix', measure: 'estimate', split: 'category', across: 'release', where: [{ dimension: 'status', op: '!=', values: ['Done'] }],
    from: '2026-08-01', to: '2026-11-01', share: true, top: 5, pin: ['KTLO'], includeParents: false, chart: 'heatmap',
  };
  it('accepts a full view and turns it into a spec without title and chart', () => {
    const r = readSavedView(good, 'views.release-mix');
    expect(r.problems).toEqual([]);
    expect(r.view).toEqual(good);
    const spec = viewToSpec(r.view!);
    expect(spec).not.toHaveProperty('title');
    expect(spec).not.toHaveProperty('chart');
    expect(spec.measure).toBe('estimate');
  });
  it('accepts the smallest view', () => {
    expect(readSavedView({ measure: 'items' }, 'v').view).toEqual({ measure: 'items' });
  });
  it('names each problem with where it is', () => {
    const r = readSavedView({
      measure: 'speed', split: 'colour', across: 7, where: [{ dimension: 'status', op: '~', values: [] }, 'x'], from: '2026-13-01', to: '11/01',
      share: 'yes', top: 51, pin: Array.from({ length: 21 }, (_, i) => `p${i}`), title: 'a\nb', chart: 'pie', extra: 1,
    }, 'views.x');
    expect(r.view).toBeUndefined();
    const text = r.problems.join('\n');
    for (const part of ['views.x.measure', 'views.x.split: Unknown dimension "colour"', 'views.x.across', 'views.x.where[0].op', 'views.x.where[0].values', 'views.x.where[1]', 'views.x.from', 'views.x.to', 'views.x.share', 'views.x.top', 'views.x.pin', 'views.x.title', 'views.x.chart', 'unknown key "extra"']) expect(text).toContain(part);
  });
  it('rejects a non-object, a long title, a backwards period and an array of pins that are not strings', () => {
    expect(readSavedView([], 'v').problems[0]).toMatch(/must be an object/);
    expect(readSavedView({ measure: 'items', title: 'x'.repeat(81) }, 'v').problems[0]).toMatch(/at most 80/);
    expect(readSavedView({ measure: 'items', from: '2026-11-02', to: '2026-11-01' }, 'v').problems[0]).toMatch(/after/);
    expect(readSavedView({ measure: 'items', pin: [1] }, 'v').problems[0]).toMatch(/list of value names/);
    expect(readSavedView({ measure: 'items', top: 0 }, 'v').problems).toEqual([]);
  });
});

describe('the address bar', () => {
  it('round-trips a spec through query keys', () => {
    const specs: PivotSpec[] = [
      { measure: 'items' },
      { measure: 'estimate', split: 'category', across: 'created:month', share: true, top: 0 },
      { measure: 'cycleTime', split: 'team', where: [{ dimension: 'status', op: '!=', values: ['Done', 'Won\'t do'] }, { dimension: 'label:team', op: '=', values: ['blue, green; red', 'say "hi"'] }], from: '2026-08-01', to: '2026-11-01', pin: ['Keep the lights on', 'a, b'], includeParents: true },
    ];
    for (const spec of specs) expect(specFromQuery(specToQuery(spec))).toEqual(spec);
  });
  it('joins filters with a semicolon and leaves defaults out', () => {
    const q = specToQuery({ measure: 'items', split: 'release', where: [{ dimension: 'status', op: '=', values: ['A'] }, { dimension: 'type', op: '!=', values: ['Bug'] }], share: false });
    expect(q).toEqual({ measure: 'items', split: 'release', where: 'status = A;type != Bug' });
  });
  it('defaults the measure, ignores other keys and rejects bad ones with a message', () => {
    expect(specFromQuery({ split: 'type', view: 'x' })).toEqual({ measure: 'items', split: 'type' });
    expect(() => specFromQuery({ measure: 'speed' })).toThrow(/Unknown measure "speed"/);
    expect(() => specFromQuery({ split: 'colour' })).toThrow(/Unknown dimension/);
    expect(() => specFromQuery({ top: '99' })).toThrow(/"top"/);
    expect(() => specFromQuery({ from: 'yesterday' })).toThrow(/"from"/);
    expect(() => specFromQuery({ where: 'status' })).toThrow(/Cannot read the filter/);
  });
});
