import { describe, expect, it } from 'vitest';
import { releaseScope } from './release-scope.js';
import { AS_OF, item } from './testkit.js';

const rel = (start: string | null | undefined, date: string | null = null) => [{ id: null, name: '1.4', released: false, date, ...(start === undefined ? {} : { start }) }];

describe('releaseScope', () => {
  it('lists what was added and what is past due when the start and the date are known', () => {
    const items = [
      item('A', { created: '2026-10-02T09:00:00Z', releases: rel('2026-10-01', '2026-11-05') }),
      item('B', { created: '2026-09-20T09:00:00Z', releases: rel('2026-10-01', '2026-11-05'), statusCategory: 'DONE' }),
    ];
    expect(releaseScope(items, '1.4', AS_OF)).toMatchObject({ added: 1, addedItems: ['corp-jira:A'], pastDue: ['corp-jira:A'], done: 1, open: 1, unknownStatus: 0 });
  });

  it('says a known empty list is [] and an unknown basis is null', () => {
    const known = releaseScope([item('A', { created: '2026-09-20T09:00:00Z', releases: rel('2026-10-01', '2026-12-01'), statusCategory: 'DONE' })], '1.4', AS_OF);
    expect(known).toMatchObject({ added: 0, addedItems: [], pastDue: [] });
    const unknown = releaseScope([item('A', { releases: rel(undefined, null) })], '1.4', AS_OF);
    expect(unknown).toMatchObject({ start: null, added: null, addedItems: null, pastDue: null });
  });

  it('counts an item of unknown status as neither open nor done, and as past due never', () => {
    const items = [
      item('A', { releases: rel('2026-10-01', '2026-11-05'), statusCategory: 'UNKNOWN' }),
      item('B', { releases: rel('2026-10-01', '2026-11-05'), statusCategory: 'TODO' }),
    ];
    const s = releaseScope(items, '1.4', AS_OF);
    expect(s).toMatchObject({ total: 2, done: 0, open: 1, unknownStatus: 1, pastDue: ['corp-jira:B'] });
  });
});
