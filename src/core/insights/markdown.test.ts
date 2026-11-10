import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../owi/types.js';
import { pivotMarkdown } from './markdown.js';
import { pivot } from './pivot.js';
import { AS_OF, item, points } from './testkit.js';
import type { PivotSpec } from './types.js';

const run = (items: WorkItem[], spec: PivotSpec) => pivotMarkdown(pivot({ items, spec, asOf: AS_OF }));

describe('pivotMarkdown', () => {
  const items = [item('A', { type: 'BUG', estimate: points(3) }), item('B', { type: 'STORY' }), item('C', { type: 'STORY', estimate: points(5) })];

  it('writes the title, period, a table with dashes for unread figures, and shares', () => {
    const md = run(items, { measure: 'estimate', split: 'type', across: 'statusCategory', share: true, where: [{ dimension: 'priority', op: '!=', values: ['Low'] }] });
    expect(md).toBe([
      '**Estimate (points) by Type across Status category**, where Priority is not Low',
      'Period: 2026-08-13 to 2026-11-10, counted as of 2026-11-10T12:00:00Z.',
      '',
      '| Type | In progress | Total |',
      '| --- | ---: | ---: |',
      '| Story | 5 (63%) | 5 |',
      '| Bug | 3 (38%) | 3 |',
      '| Total | 8 | 8 |',
      '',
      'Coverage:',
      '- 2 of 3 items have an estimate in points; the other 1 are left out.',
      '',
    ].join('\n'));
  });
  it('shows a null as a dash', () => {
    const md = run([item('B', { type: 'STORY' })], { measure: 'estimate', split: 'type' });
    expect(md).toContain('| Story | – |');
  });
  it('says plainly when a dimension was not read, with no table', () => {
    const md = run(items, { measure: 'items', split: 'release' });
    expect(md).not.toContain('| ---');
    expect(md).toContain("- Fix versions weren't read for any of the 3 items.");
  });
  it('lists notable changes', () => {
    const many = (n: number, type: 'BUG' | 'STORY', created: string) => Array.from({ length: n }, (_, i) => item(`${type}${created}${i}`, { type, created }));
    const md = run([...many(3, 'STORY', '2026-10-28T10:00:00Z'), ...many(1, 'BUG', '2026-10-28T10:00:00Z'), ...many(1, 'STORY', '2026-11-03T10:00:00Z'), ...many(3, 'BUG', '2026-11-03T10:00:00Z')],
      { measure: 'items', split: 'type', across: 'created:week', from: '2026-10-19', to: '2026-11-10' });
    expect(md).toContain('Notable changes:\n- Bug went from 25% of 2026-W44 to 75% of 2026-W45, up 50 points.');
  });
  it('cuts at 24 columns and says so', () => {
    const md = run([item('A')], { measure: 'items', across: 'created:week', from: '2025-01-01', to: '2026-11-10' });
    expect(md).toContain('Showing the first 24 of 98 columns; the rest are left out.');
    expect(md.split('\n').find((l) => l.startsWith('| All items'))!.split('|')).toHaveLength(24 + 1 + 3);
  });
  it('escapes pipes in labels and ends with a newline', () => {
    const md = run([item('A', { labels: ['a|b'] })], { measure: 'items', split: 'label' });
    expect(md).toContain('| a\\|b |');
    expect(md.endsWith('\n')).toBe(true);
  });
});
