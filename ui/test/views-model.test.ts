import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { columns, proposeMove, statusFor } from '../src/model/board.ts';
import { burnup } from '../src/model/burnup.ts';
import { age, aging, cycleTime, cycleTimes, doneAt, percentile, throughput, weekStart } from '../src/model/flow.ts';
import { dependencyGraph } from '../src/model/graph.ts';
import { insights, needsAttention, prepare, type Context } from '../src/model/insights.ts';
import { commandLine } from '../src/proposal.ts';
import type { ChangeRef, Deployment, StatusCategory, Transition, WorkItem } from '../src/toil.ts';
import { healthOf } from './harness.ts';

/**
 * The models behind the board, the flow panels, the dependency graph and the
 * insights (#252, #253): on each dossier as the dashboard loads it, and on
 * small items made here for the edges the fixture doesn't reach.
 */

const t = (fromCategory: StatusCategory | null, toCategory: StatusCategory, at: string): Transition => ({ from: fromCategory, to: toCategory, fromCategory, toCategory, at, by: null });

function item(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    owi: '0.1', source: { area: 'jira', connection: 'corp-jira', key: over.id.split(':')[1]!, command: 'jira search' }, url: null, type: 'STORY', typeName: 'Story',
    title: over.id, body: null, status: null, statusCategory: 'TODO', resolution: null, assignee: null, reporter: null, priority: null, estimate: null, labels: [], team: null,
    iteration: null, parent: null, children: [], links: [], created: null, updated: null, resolved: null, dueDate: null, history: { transitions: [], iterations: [] }, unmapped: [], native: {},
    ...over,
  };
}
const NOW = '2026-10-13T08:00:00.000Z';
const ctx = (items: WorkItem[], more: Partial<Context> = {}): Context => ({ items, changes: [], deployments: [], health: null, now: NOW, ...more });

describe('cycle time', () => {
  it('runs from the first move into In progress to the last move into Done', () => {
    const i = item({ id: 'c:A-1', statusCategory: 'DONE', history: { iterations: [], transitions: [t('TODO', 'IN_PROGRESS', '2026-10-01T00:00:00Z'), t('IN_PROGRESS', 'TODO', '2026-10-02T00:00:00Z'), t('TODO', 'IN_PROGRESS', '2026-10-03T00:00:00Z'), t('IN_PROGRESS', 'DONE', '2026-10-05T12:00:00Z')] } });
    expect(cycleTime(i)).toEqual({ id: 'c:A-1', start: '2026-10-01T00:00:00Z', end: '2026-10-05T12:00:00Z', days: 4.5 });
  });

  it('is unknown, with the reason, when the history cannot show it, and not applicable to open work', () => {
    expect(cycleTime(item({ id: 'c:A-2', statusCategory: 'DONE', history: null }))).toMatchObject({ days: null, reason: 'No history synced' });
    expect(cycleTime(item({ id: 'c:A-3', statusCategory: 'DONE' }))).toMatchObject({ days: null, reason: 'No move into Done recorded' });
    expect(cycleTime(item({ id: 'c:A-4', statusCategory: 'DONE', history: { iterations: [], transitions: [t('TODO', 'DONE', '2026-10-05T00:00:00Z')] } }))).toMatchObject({ days: null, reason: 'Never recorded as In progress before Done' });
    expect(cycleTime(item({ id: 'c:A-5', statusCategory: 'IN_PROGRESS' }))).toBeNull();
  });

  it("on the fixture: Jira's and Azure DevOps' histories time their items; GitHub's open and closed events can't", async () => {
    const card = cycleTimes((await healthOf('card-payments')).data.items);
    expect(card.known.map((c) => [c.id, Math.round(c.days * 100) / 100])).toEqual([
      ['corp-jira:PAY-92', 8.17], ['corp-jira:PAY-95', 3.04], ['corp-jira:PAY-97', 7.29], ['corp-jira:PAY-98', 11.04], ['corp-jira:PAY-106', 1.1], ['corp-jira:PAY-105', 3.19],
    ]);
    const settle = cycleTimes((await healthOf('settlement')).data.items);
    expect(settle.unknown).toEqual([{ id: 'corp-ado:2307', reason: 'Never recorded as In progress before Done' }]);
    const web = cycleTimes((await healthOf('checkout-web')).data.items);
    expect(web.known).toEqual([]);
    expect(web.unknown.map((u) => u.id)).toEqual(['github:imagile/payments-web#36', 'github:imagile/payments-web#38', 'github:imagile/payments-web#44']);
  });

  it('takes the nearest-rank percentile', () => {
    expect(percentile([], 85)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 85)).toBe(9);
    expect(percentile([5], 85)).toBe(5);
  });
});

describe('aging work in progress', () => {
  it('counts from the start of the current spell in progress', () => {
    const i = item({ id: 'c:B-1', statusCategory: 'IN_PROGRESS', history: { iterations: [], transitions: [t('TODO', 'IN_PROGRESS', '2026-10-01T08:00:00Z'), t('IN_PROGRESS', 'TODO', '2026-10-02T08:00:00Z'), t('TODO', 'IN_PROGRESS', '2026-10-10T08:00:00Z'), t('IN_PROGRESS', 'IN_PROGRESS', '2026-10-11T08:00:00Z')] } });
    expect(age(i, NOW)).toEqual({ id: 'c:B-1', since: '2026-10-10T08:00:00Z', days: 3 });
  });

  it('is unknown without a recorded start, and leaves out containers', () => {
    const list = aging([item({ id: 'c:B-2', statusCategory: 'IN_PROGRESS' }), item({ id: 'c:B-3', statusCategory: 'IN_PROGRESS', type: 'EPIC' }), item({ id: 'c:B-4', statusCategory: 'IN_PROGRESS', history: null })], NOW);
    expect(list).toEqual({ known: [], unknown: [{ id: 'c:B-2', reason: 'No move into In progress recorded' }, { id: 'c:B-4', reason: 'No history synced' }] });
  });

  it('on the fixture, oldest first, with GitHub In Review unknown', async () => {
    const days = async (name: string) => aging((await healthOf(name)).data.items, FIXTURE_NOW);
    expect((await days('card-payments')).known.map((a) => [a.id, Math.round(a.days * 10) / 10])).toEqual([['corp-jira:PAY-104', 13.9], ['corp-jira:PAY-101', 6.9]]);
    expect((await days('settlement')).known.map((a) => a.id)).toEqual(['corp-ado:2304', 'corp-ado:2302']);
    expect(await days('checkout-web')).toEqual({ known: [], unknown: [{ id: 'github:imagile/payments-web#42', reason: 'No move into In progress recorded' }] });
  });
});

describe('throughput', () => {
  it('weeks start on Monday, UTC', () => {
    expect(weekStart('2026-10-13T08:00:00.000Z')).toBe('2026-10-12T00:00:00.000Z');
    expect(weekStart('2026-10-18T23:59:00.000Z')).toBe('2026-10-12T00:00:00.000Z');
    expect(weekStart('2026-10-12T00:00:00.000Z')).toBe('2026-10-12T00:00:00.000Z');
  });

  it('counts each item in the week of its last move into Done, the last week marked as running', async () => {
    const { data } = await healthOf('card-payments');
    const tp = throughput(data.items, FIXTURE_NOW);
    expect(tp.weeks.map((w) => [w.start.slice(0, 10), w.items.length, w.partial])).toEqual([
      ['2026-09-07', 0, false], ['2026-09-14', 1, false], ['2026-09-21', 1, false], ['2026-09-28', 2, false], ['2026-10-05', 2, false], ['2026-10-12', 0, true],
    ]);
    expect(tp.weeks[4]!.items).toEqual(['corp-jira:PAY-105', 'corp-jira:PAY-106']);
    expect(tp.unknown).toEqual([]);
  });

  it('lists a done item with no recorded finish as unknown, and counts ones before the window', () => {
    const items = [item({ id: 'c:T-1', statusCategory: 'DONE' }), item({ id: 'c:T-2', statusCategory: 'DONE', history: { iterations: [], transitions: [t('IN_PROGRESS', 'DONE', '2026-01-05T00:00:00Z')] } })];
    expect(throughput(items, NOW, 2)).toMatchObject({ unknown: [{ id: 'c:T-1', reason: 'No move into Done recorded' }], earlier: 1 });
  });

  it('reads Done from the last move into it, after a reopen', () => {
    const i = item({ id: 'c:T-3', statusCategory: 'DONE', history: { iterations: [], transitions: [t('IN_PROGRESS', 'DONE', '2026-10-01T00:00:00Z'), t('DONE', 'IN_PROGRESS', '2026-10-02T00:00:00Z'), t('IN_PROGRESS', 'DONE', '2026-10-06T00:00:00Z')] } });
    expect(doneAt(i)).toBe('2026-10-06T00:00:00Z');
  });
});

describe('the burn-up', () => {
  it("grows its scope when work is added, and its done line when work finishes, day by day to now", async () => {
    const { h } = await healthOf('settlement');
    const b = burnup(h, FIXTURE_NOW);
    expect(b.days.map((d) => [d.at.slice(0, 10), d.scope, d.done])).toEqual([
      ['2026-10-05', 11, 0], ['2026-10-06', 11, 0], ['2026-10-07', 11, 1], ['2026-10-08', 11, 1], ['2026-10-09', 16, 1], ['2026-10-10', 16, 1], ['2026-10-11', 16, 1], ['2026-10-12', 16, 1], ['2026-10-13', 16, 1],
    ]);
    expect(b.days.at(-1)!.at).toBe(FIXTURE_NOW);
    expect(b.ahead).toBe(3);
    expect(b.unplaced).toEqual([]);
  });

  it('agrees with the sprint figures at the end of its line', async () => {
    for (const name of ['card-payments', 'settlement', 'checkout-web']) {
      const { h } = await healthOf(name);
      const last = burnup(h, FIXTURE_NOW).days.at(-1)!;
      expect(last.done, name).toBe(h.done.points);
      expect(last.scope, name).toBe(h.done.points + h.remaining.points);
    }
  });
});

describe('the dependency graph', () => {
  it('keeps one edge per linked pair, each pointing the way the link reads, and ranks blocking chains', async () => {
    const g = dependencyGraph((await healthOf('card-payments')).data.items);
    expect(g.edges.map((e) => `${e.source} ${e.type} ${e.target} (${e.name})`)).toEqual([
      'corp-jira:PAY-101 blocks corp-jira:PAY-102 (blocks)',
      'corp-jira:PAY-102 blocks corp-jira:PAY-103 (blocks)',
      'corp-jira:PAY-103 relates corp-jira:PAY-107 (relates to)',
    ]);
    expect(g.nodes.map((n) => [n.id, n.rank, n.row, n.blocked, n.blocking])).toEqual([
      ['corp-jira:PAY-101', 0, 0, false, true],
      ['corp-jira:PAY-102', 1, 0, true, true],
      ['corp-jira:PAY-103', 2, 0, true, false],
      ['corp-jira:PAY-107', 0, 1, false, false],
    ]);
    expect(g.cycle).toBe(false);
  });

  it("names Azure DevOps' own wording, and draws nothing for a dossier without links", async () => {
    expect(dependencyGraph((await healthOf('settlement')).data.items).edges).toEqual([{ id: 'blocks:corp-ado:2302->corp-ado:2303', type: 'blocks', source: 'corp-ado:2302', target: 'corp-ado:2303', name: 'Successor' }]);
    expect(dependencyGraph((await healthOf('checkout-web')).data.items)).toEqual({ nodes: [], edges: [], cycle: false });
  });

  it('keeps a link to an item outside the dossier, marked unknown, and stops on a cycle', () => {
    const a = item({ id: 'c:G-1', links: [{ type: 'blocks', direction: 'outward', target: 'c:G-2', name: 'blocks' }, { type: 'blocks', direction: 'outward', target: 'other:X-9', name: 'blocks' }] });
    const b = item({ id: 'c:G-2', links: [{ type: 'blocks', direction: 'outward', target: 'c:G-1', name: 'blocks' }] });
    const g = dependencyGraph([a, b]);
    expect(g.nodes.find((n) => n.id === 'other:X-9')).toMatchObject({ known: false });
    expect(g.cycle).toBe(true);
  });
});

describe('the board', () => {
  it('has a column per status category, across trackers, and leaves containers off', async () => {
    const { h } = await healthOf('checkout-web');
    expect(columns(h.items).map((c) => [c.category, c.items.map((i) => i.source.key)])).toEqual([
      ['TODO', ['imagile/payments-web#43', 'imagile/payments-web#45']],
      ['IN_PROGRESS', ['imagile/payments-web#42']],
      ['DONE', ['imagile/payments-web#44']],
    ]);
    expect(columns([item({ id: 'c:U-1', statusCategory: 'UNKNOWN' })]).map((c) => c.category)).toEqual(['TODO', 'IN_PROGRESS', 'DONE', 'UNKNOWN']);
  });

  it("proposes the tracker's own write command, with the status word its items use, and never one for no move", async () => {
    const { data, byId } = await healthOf('card-payments');
    const pay102 = byId.get('corp-jira:PAY-102')!;
    expect(proposeMove(pay102, 'TODO', data.items, 'card-payments')).toBeNull();
    const p = proposeMove(pay102, 'IN_PROGRESS', data.items, 'card-payments')!;
    expect(p).toMatchObject({ from: 'board', item: 'corp-jira:PAY-102', title: 'Move PAY-102 to In progress', command: 'jira transition-issue', input: { dossier: 'card-payments', key: 'PAY-102', transition: 'In Progress' } });
    expect(commandLine(p)).toBe('toil jira transition-issue --dossier card-payments --key PAY-102 --transition "In Progress" --allow-write');
    const settle = await healthOf('settlement');
    expect(commandLine(proposeMove(settle.byId.get('corp-ado:2303')!, 'IN_PROGRESS', settle.data.items, 'settlement')!)).toBe('toil ado work transition --dossier settlement --id 2303 --state Active --allow-write');
  });

  it("says where toil has no command, rather than inventing one", async () => {
    const { data, byId } = await healthOf('checkout-web');
    const p = proposeMove(byId.get('github:imagile/payments-web#43')!, 'DONE', data.items, 'checkout-web')!;
    expect(p.command).toBeNull();
    expect(commandLine(p)).toBeNull();
    expect(p.note).toMatch(/no command that sets a GitHub Projects status/);
    const lone = item({ id: 'c:L-1' });
    expect(statusFor(lone, 'DONE', [lone])).toBeNull();
    expect(proposeMove(lone, 'DONE', [lone], 'd')!.note).toMatch(/toil jira list-transitions --dossier d --key L-1/);
  });
});

describe('insights', () => {
  it('ranks what needs attention on the fixture, each insight with its source', async () => {
    const { data, h } = await healthOf('card-payments');
    const ranked = needsAttention(prepare({ items: data.items, changes: data.changes, deployments: data.deployments, health: h, now: FIXTURE_NOW }));
    expect(ranked.map((a) => [a.id, a.score, a.insights.map((i) => i.code)])).toEqual([
      ['corp-jira:PAY-102', 7, ['blocked', 'blocking', 'stale']],
      ['corp-jira:PAY-104', 7, ['aging', 'carried', 'stale']],
      ['corp-jira:PAY-101', 5, ['failing-build', 'blocking']],
      ['corp-jira:PAY-103', 5, ['blocked', 'stale']],
      ['corp-jira:PAY-107', 2, ['unestimated', 'added']],
    ]);
    const pay104 = ranked[1]!.insights[0]!;
    expect(pay104.text).toBe("In progress for 13.9 days, longer than 85% of this dossier's finished items took (11 days)");
    expect(pay104.evidence).toBe('history.transitions, against 6 cycle times');
    expect(ranked.flatMap((a) => a.insights).every((i) => i.evidence.length > 0)).toBe(true);
  });

  it("raises nothing on done work, and no aging without three cycle times to compare against", async () => {
    const { data, h, byId } = await healthOf('checkout-web');
    const p = prepare({ items: data.items, changes: data.changes, deployments: data.deployments, health: h, now: FIXTURE_NOW });
    expect(p.p85).toBeNull();
    expect(insights(byId.get('github:imagile/payments-web#44')!, p)).toEqual([]);
    expect(needsAttention(p).flatMap((a) => a.insights).some((i) => i.code === 'aging')).toBe(false);
  });

  it('flags an open PR with no build, a merged one not deployed, and work deployed but still open', () => {
    const a = item({ id: 'c:I-1', statusCategory: 'IN_PROGRESS', status: 'In Review' });
    const b = item({ id: 'c:I-2', statusCategory: 'IN_PROGRESS', status: 'In Progress' });
    const pr = (id: string, items: string[], outcome: ChangeRef['outcome']): ChangeRef => ({ id, kind: 'pull-request', source: 'bitbucket', command: 'bitbucket list-prs', items, title: `#${id}`, url: null, state: outcome, outcome, builds: null, mergeCommit: null, at: NOW });
    const dep: Deployment = { id: 'd1', environment: 'dev', source: 'openshift', command: 'openshift deployments', name: 'app', commit: 'abc1234', version: null, state: 'Available', outcome: 'passed', url: null, includes: ['m2'], items: ['c:I-2'], unknownCommit: false };
    const p = prepare(ctx([a, b], { changes: [pr('o1', ['c:I-1'], 'open'), pr('m1', ['c:I-1'], 'merged'), pr('m2', ['c:I-2'], 'merged')], deployments: [dep] }));
    expect(insights(a, p).map((i) => i.code)).toEqual(['pr-no-build', 'built-not-deployed', 'unestimated']);
    expect(insights(b, p).map((i) => [i.code, i.text])).toEqual([['deployed-not-closed', 'Running in dev, but still In Progress'], ['unestimated', 'No estimate']]);
  });

  it('calls work stale after five quiet days, and only open work', () => {
    const quiet = item({ id: 'c:S-1', estimate: { value: 1, unit: 'points', field: 'Story Points' }, updated: '2026-10-07T08:00:00Z' });
    const fresh = item({ id: 'c:S-2', estimate: { value: 1, unit: 'points', field: 'Story Points' }, updated: '2026-10-09T08:00:00Z' });
    const p = prepare(ctx([quiet, fresh]));
    expect(insights(quiet, p)).toEqual([{ code: 'stale', weight: 2, text: 'No update for 6 days', evidence: 'updated' }]);
    expect(insights(fresh, p)).toEqual([]);
  });
});

describe('a proposal', () => {
  it('reads as one command line, dossier first, quoted where it must be, with --allow-write', () => {
    expect(commandLine({ command: 'jira update-issue', input: { key: 'PAY-107', dossier: 'card-payments', field: ['Story Points=3'] } })).toBe('toil jira update-issue --dossier card-payments --key PAY-107 --field "Story Points=3" --allow-write');
    expect(commandLine({ command: null, input: null })).toBeNull();
  });
});
