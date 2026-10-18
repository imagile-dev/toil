import { describe, expect, it } from 'vitest';
import { included, mentioned } from '../src/model/delivery.ts';
import { entry } from '../src/model/sprint.ts';
import { trace } from '../src/model/trace.ts';
import { healthOf, loaded } from './harness.ts';

/** The models, on each dossier as the dashboard loads it through the fixture `execute()`. */

const ids = (h: Awaited<ReturnType<typeof healthOf>>['h'], kind: string) => h.items.filter((i) => h.entries.get(i.id)!.kind === kind).map((i) => i.id);
const reasons = (h: Awaited<ReturnType<typeof healthOf>>['h']) => Object.fromEntries(h.risks.map((r) => [r.id, r.reasons.map((x) => x.code)]));

describe('card-payments: Jira, Bitbucket, Jenkins, OpenShift', () => {
  it("works out Sprint 42 from Jira's own dates", async () => {
    const { h } = await healthOf('card-payments');
    expect(h.sprint.name).toBe('Sprint 42');
    expect(h.days).toEqual({ gone: 7, total: 10 });
    expect(h.items).toHaveLength(7); // The epic sits outside any sprint.
    expect(ids(h, 'carried')).toEqual(['corp-jira:PAY-104']);
    expect(ids(h, 'added')).toEqual(['corp-jira:PAY-107']);
    expect(h.done).toEqual({ count: 2, points: 3 });
    expect(h.remaining).toEqual({ count: 5, points: 18 });
  });

  it('flags each risk, the failing Jenkins build included', async () => {
    const { h } = await healthOf('card-payments');
    expect(reasons(h)).toEqual({
      'corp-jira:PAY-101': ['failing-build'],
      'corp-jira:PAY-102': ['blocked'],
      'corp-jira:PAY-103': ['blocked'],
      'corp-jira:PAY-104': ['carried'],
      'corp-jira:PAY-107': ['unestimated'],
    });
    expect(h.risks[0]!.reasons[0]).toEqual({ code: 'failing-build', change: 'corp-jenkins:payments-core/PR-311#2' });
  });

  it('joins pull requests to items by key, builds by job, deployments by image tag', async () => {
    const { data } = await loaded('card-payments');
    const pr = data.changes.find((c) => c.id === 'corp-bitbucket:PAY/payments-core#311')!;
    expect(pr.items).toEqual(['corp-jira:PAY-101', 'corp-jira:PAY-100']);
    expect(data.changes.filter((c) => c.builds === pr.id).map((c) => c.outcome)).toEqual(['failed', 'failed']);
    expect(data.deployments.map((d) => [d.environment, d.commit, d.items])).toEqual([
      ['dev', '4e1d2a9', ['corp-jira:PAY-106', 'corp-jira:PAY-105']],
      ['prod', '1a2b3c4', []],
    ]);
  });
});

describe('settlement: Azure DevOps Server Boards, Repos and Pipelines', () => {
  it("works out Sprint 42 from the iteration's dates, leaving hours out of the points", async () => {
    const { h } = await healthOf('settlement');
    expect(h.days).toEqual({ gone: 7, total: 9 });
    expect(ids(h, 'carried')).toEqual(['corp-ado:2304']);
    // 2305 is a task created inside the sprint, which is scope added.
    expect(ids(h, 'added')).toEqual(['corp-ado:2305', 'corp-ado:2306']);
    expect(h.otherUnits).toEqual(['corp-ado:2305']);
    expect(h.done).toEqual({ count: 2, points: 1 });
    expect(h.remaining).toEqual({ count: 4, points: 15 });
    expect(reasons(h)).toEqual({ 'corp-ado:2303': ['blocked'], 'corp-ado:2304': ['carried'] });
  });

  it('says what each entry rests on', async () => {
    const { byId } = await healthOf('settlement');
    expect(entry(byId.get('corp-ado:2304')!)).toMatchObject({ kind: 'carried', from: 'Payments\\Sprint 41', evidence: 'history.iterations' });
    // Moving from the area path into the sprint before it started is planning, not scope added.
    expect(entry(byId.get('corp-ado:2302')!)).toMatchObject({ kind: 'planned', at: '2026-09-30T15:00:00.000Z' });
  });

  it('joins CI runs by pull request and deployments by source version, per environment', async () => {
    const { data } = await loaded('settlement');
    expect(data.changes.filter((c) => c.kind === 'build').map((c) => [c.builds, c.outcome])).toEqual([
      ['corp-ado:Payments/settlement#87', 'running'],
      ['corp-ado:Payments/settlement#84', 'passed'],
      ['corp-ado:Payments/settlement#80', 'passed'],
    ]);
    expect(data.deployments.map((d) => [d.environment, d.commit, d.includes.length, d.items])).toEqual([
      ['test', 'c84e5f0', 2, ['corp-ado:2305']],
      ['prod', 'b80a1d2', 1, []],
    ]);
  });
});

describe('checkout-web: GitHub with Projects and Actions, OpenShift', () => {
  it('takes scope added from the board item, and says so', async () => {
    const { h, byId } = await healthOf('checkout-web');
    expect(ids(h, 'added')).toEqual(['github:imagile/payments-web#43', 'github:imagile/payments-web#45']);
    expect(entry(byId.get('github:imagile/payments-web#43')!)).toEqual({
      kind: 'added', at: '2026-10-07T09:00:00.000Z', from: null, evidence: 'github projects list-items: createdAt',
    });
    expect(reasons(h)).toEqual({ 'github:imagile/payments-web#43': ['failing-build'], 'github:imagile/payments-web#45': ['unestimated'] });
  });

  it("makes one build of a head's checks: failed if any check failed", async () => {
    const { data } = await loaded('checkout-web');
    const build = data.changes.find((c) => c.id === 'github:imagile/payments-web#53/checks')!;
    expect(build).toMatchObject({ outcome: 'failed', state: 'failure (e2e-safari)', title: 'test, e2e-safari', items: ['github:imagile/payments-web#43'] });
    expect(data.deployments.map((d) => [d.environment, d.version, d.items])).toEqual([
      ['staging', '2026.10.12', ['github:imagile/payments-web#44']],
      ['prod', '2026.10.02', []],
    ]);
  });
});

describe('traceability', () => {
  it('flags the gaps and says where each item runs', async () => {
    const { data, h } = await healthOf('card-payments');
    const rows = new Map(trace(h.items, data.changes, data.deployments).map((r) => [r.item.id, r]));
    expect(rows.get('corp-jira:PAY-101')!.flags).toEqual(['failing-build']);
    expect(rows.get('corp-jira:PAY-105')!.deployedTo.map((d) => d.environment)).toEqual(['dev']);
    expect(rows.get('corp-jira:PAY-104')!.deployedTo).toEqual([]);
    const settlement = await healthOf('settlement');
    const flagged = trace(settlement.h.items, settlement.data.changes).filter((r) => r.flags.length);
    expect(flagged.map((r) => [r.item.id, r.flags])).toEqual([['corp-ado:2307', ['done-without-change']]]);
  });
});

describe('the delivery rules', () => {
  it("names only the dossier's own items, by key or by #number in the same repository", async () => {
    const { data } = await loaded('checkout-web');
    expect(mentioned('Closes #42. Part of #41. See #999 and imagile/other#42.', data.items, 'imagile/payments-web')).toEqual([
      'github:imagile/payments-web#42',
      'github:imagile/payments-web#41',
    ]);
    expect(mentioned('Fixes #42', data.items, 'imagile/other')).toEqual([]);
  });

  it('calls a commit no merged pull request made unknown, rather than guessing', async () => {
    const { data } = await loaded('card-payments');
    expect(included('deadbee', data.changes)).toEqual({ includes: [], items: [], unknownCommit: true });
  });
});
