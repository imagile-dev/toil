import { describe, expect, it } from 'vitest';
import { CHANGES } from '../src/fixtures/changes.ts';
import { FIXTURE_ITEMS, FIXTURE_NOW } from '../src/fixtures/store.ts';
import { currentSprint, entry, health } from '../src/model/sprint.ts';
import { trace } from '../src/model/trace.ts';

const byId = new Map(FIXTURE_ITEMS.map((i) => [i.id, i]));
const h = health(FIXTURE_ITEMS, CHANGES, FIXTURE_NOW)!;
const ids = (kind: string) => h.items.filter((i) => h.entries.get(i.id)!.kind === kind).map((i) => i.id);

describe('sprint health on the fixture sprint', () => {
  it("finds Sprint 42 across all three trackers, with each one's own dates", () => {
    expect(currentSprint(FIXTURE_ITEMS, FIXTURE_NOW)!.name).toBe('Sprint 42');
    expect(h.sprint.sources.map((s) => s.connection)).toEqual(['corp-jira', 'corp-ado', 'github']);
    expect(h.sprint.start).toBe('2026-10-05T00:00:00.000Z');
    expect(h.sprint.end).toBe('2026-10-17T00:00:00.000Z');
    expect(h.items).toHaveLength(18); // The epic and the feature sit outside any sprint.
    expect(h.days).toEqual({ gone: 7, total: 10 });
  });

  it('tells planned work from scope added and work carried over', () => {
    expect(ids('carried')).toEqual(['corp-jira:PAY-104', 'corp-ado:2304']);
    expect(ids('added')).toEqual(['corp-jira:PAY-107', 'corp-ado:2306', 'github:imagile/payments-web#43', 'github:imagile/payments-web#45']);
    expect(h.planned).toEqual({ count: 12, points: 37 });
    expect(h.added).toEqual({ count: 4, points: 7 });
    expect(h.carried).toEqual({ count: 2, points: 4 });
    expect(h.done).toEqual({ count: 5, points: 5 });
    expect(h.remaining).toEqual({ count: 13, points: 43 });
  });

  it('says what each entry rests on', () => {
    expect(entry(byId.get('corp-jira:PAY-104')!)).toMatchObject({ kind: 'carried', from: 'Sprint 41', evidence: 'history.iterations' });
    expect(entry(byId.get('corp-ado:2304')!)).toMatchObject({ kind: 'carried', from: 'Payments\\Sprint 41' });
    // Moving from the area path into the sprint before it started is planning, not scope added.
    expect(entry(byId.get('corp-ado:2302')!)).toMatchObject({ kind: 'planned', at: '2026-09-30T15:00:00.000Z' });
    // GitHub Projects keeps no iteration history; the board item's createdAt stands in, and says so.
    expect(entry(byId.get('github:imagile/payments-web#43')!)).toEqual({
      kind: 'added', at: '2026-10-07T09:00:00.000Z', from: null, evidence: 'github projects list-items: createdAt',
    });
  });

  it('leaves hour estimates out of the points totals, and says which', () => {
    expect(h.otherUnits).toEqual(['corp-ado:2305']);
  });

  it('flags each risk with its reasons', () => {
    expect(Object.fromEntries(h.risks.map((r) => [r.id, r.reasons]))).toEqual({
      'corp-jira:PAY-101': [{ code: 'failing-build', change: 'corp-jenkins:payments-core/PR-311#1290' }],
      'corp-jira:PAY-102': [{ code: 'blocked', by: 'corp-jira:PAY-101' }],
      'corp-jira:PAY-103': [{ code: 'blocked', by: 'corp-jira:PAY-102' }],
      'corp-jira:PAY-104': [{ code: 'carried', from: 'Sprint 41' }],
      'corp-jira:PAY-107': [{ code: 'unestimated' }],
      'corp-ado:2303': [{ code: 'blocked', by: 'corp-ado:2302' }],
      'corp-ado:2304': [{ code: 'carried', from: 'Payments\\Sprint 41' }],
      'github:imagile/payments-web#43': [{ code: 'failing-build', change: 'github:imagile/payments-web#53/checks' }],
      'github:imagile/payments-web#45': [{ code: 'unestimated' }],
    });
  });

  it('counts a sub-task of an estimated story as covered, not unestimated', () => {
    expect(h.unestimated).toEqual(['corp-jira:PAY-107', 'github:imagile/payments-web#45']);
  });

  it('has no sprint to report when nothing has started', () => {
    expect(health(FIXTURE_ITEMS, CHANGES, '2020-01-01T00:00:00.000Z')).toBeNull();
  });
});

describe('traceability on the fixture sprint', () => {
  const rows = new Map(trace(h.items, CHANGES).map((r) => [r.item.id, r]));

  it('joins each item to its changes and builds', () => {
    expect(rows.get('corp-jira:PAY-105')!.changes.map((c) => c.id)).toEqual(['corp-bitbucket:PAY/payments-core#298']);
    expect(rows.get('corp-jira:PAY-105')!.builds.map((c) => c.id)).toEqual(['corp-jenkins:payments-core/PR-298#1281']);
    expect(rows.has('github:imagile/payments-web#41')).toBe(false); // Features and epics are containers.
  });

  it('flags the gaps', () => {
    const flagged = Object.fromEntries([...rows].filter(([, r]) => r.flags.length).map(([id, r]) => [id, r.flags]));
    expect(flagged).toEqual({
      'corp-jira:PAY-101': ['failing-build'],
      'corp-ado:2307': ['done-without-change'],
      'github:imagile/payments-web#43': ['failing-build'],
    });
  });

  it('cites only items the Store holds', () => {
    for (const c of CHANGES) for (const id of c.items) expect(byId.has(id), `${c.id} mentions ${id}`).toBe(true);
    for (const c of CHANGES.filter((c) => c.builds)) expect(CHANGES.some((p) => p.id === c.builds), `${c.id} builds ${c.builds}`).toBe(true);
  });
});
