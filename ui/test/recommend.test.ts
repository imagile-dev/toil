import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { prepare } from '../src/model/insights.ts';
import { BASE_WEIGHT, MAX_TICKETS, recommend, type RecommendInput } from '../src/model/recommend.ts';
import { readReadiness } from '../src/model/readiness.ts';
import { health } from '../src/model/sprint.ts';
import type { Change, StatusCategory, WorkItem } from '../src/toil.ts';
import { NAMES, loaded } from './harness.ts';

/**
 * The Overview's recommendation (#394): worked out by code from blockers,
 * builds, the sprint's pace, pull requests, aging work and readiness, the
 * heaviest kind first, on the sample dossiers and on small cases made here.
 */

const NOW = '2026-10-13T08:00:00.000Z';
function item(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    owi: '0.2', source: { area: 'jira', connection: 'corp-jira', key: id, command: 'jira issue search' }, url: null, type: 'STORY', typeName: 'Story',
    title: `Title of ${id}`, body: { format: 'markdown', content: `## Acceptance criteria\n\n${Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')}` }, status: null, statusCategory: 'TODO' as StatusCategory, resolution: null, assignee: null, reporter: null, priority: null, estimate: null, labels: [], team: null,
    iteration: null, parent: null, children: [], links: [], created: null, updated: NOW, resolved: null, dueDate: null, history: { transitions: [], iterations: [] }, unmapped: [], native: {},
    ...over,
    id: `jira:${id}`,
  };
}
const SETTINGS = readReadiness({ repos: [{ name: 'payments-core' }], jira: { project: 'PAY' } });
function input(items: WorkItem[], pullRequests: Change[] = []): RecommendInput {
  return { items, pullRequests, prepared: prepare({ items, changes: [], deployments: [], health: null, now: NOW }), health: null, readiness: SETTINGS, now: NOW };
}

describe('recommend', () => {
  it('says to keep going, and why, when nothing is wrong', () => {
    const r = recommend(input([item('A-1'), item('D-1', { statusCategory: 'DONE' })]));
    expect(r.issues).toEqual([]);
    expect(r.headline).toMatch(/^Keep going/);
    expect(r.derivedFrom).toContain('no agent call');
    expect(r.derivedFrom).toContain('2 work items');
  });

  it('puts the blocker that holds most first, naming every item behind it', () => {
    const blocks = (target: string) => ({ type: 'blocks' as const, direction: 'inward' as const, target: `jira:${target}`, name: 'is blocked by' });
    const r = recommend(input([item('A-1'), item('A-2', { links: [blocks('A-1')] }), item('A-3', { links: [blocks('A-1')] }), item('B-1'), item('B-2', { links: [blocks('B-1')] })]));
    const top = r.issues[0]!;
    expect(top).toMatchObject({ kind: 'blockers', title: '3 items blocked', tab: 'dependencies', count: 5 });
    expect(top.tickets).toEqual(['jira:A-1', 'jira:A-2', 'jira:A-3']);
    expect(top.tickets.length).toBe(MAX_TICKETS);
    expect(r.headline).toBe('Unblock [[jira:A-1]] first: 2 items wait on it.');
    expect(top.detail).toBe('[[jira:A-1]] blocks [[jira:A-2]], [[jira:A-3]]; [[jira:B-1]] blocks [[jira:B-2]].');
  });

  it('flags work not ready to start, blocked before thin, and ranks it under everything that has started', () => {
    const r = recommend(input([item('D-1', { statusCategory: 'DONE' }), item('A-1', { body: null }), item('A-2', { statusCategory: 'IN_PROGRESS', updated: '2026-09-01T00:00:00.000Z' })]));
    expect(r.issues.map((i) => i.kind)).toEqual(['aging', 'readiness']);
    expect(r.issues[0]).toMatchObject({ title: '1 item gone quiet', tickets: ['jira:A-2'] });
    expect(r.issues[1]).toMatchObject({ title: '1 item not ready to start', tickets: ['jira:A-1'] });
    expect(r.issues[1]!.action).toMatch(/^Firm up \[\[jira:A-1\]\] before anyone picks it up: /);
  });

  it('weighs kinds in a fixed order, so a blocker always outranks a review and a review outranks aging', () => {
    expect(BASE_WEIGHT.blockers).toBeGreaterThan(BASE_WEIGHT.builds);
    expect(BASE_WEIGHT.builds).toBeGreaterThan(BASE_WEIGHT.scope);
    expect(BASE_WEIGHT.scope).toBeGreaterThan(BASE_WEIGHT.review);
    expect(BASE_WEIGHT.review).toBeGreaterThan(BASE_WEIGHT.aging);
    expect(BASE_WEIGHT.aging).toBeGreaterThan(BASE_WEIGHT.readiness);
    // However many tickets a lighter kind holds, it never outweighs a heavier kind.
    const kinds = Object.values(BASE_WEIGHT).sort((a, b) => a - b);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i - 1]! + 9).toBeLessThan(kinds[i]!);
  });

  it.each(NAMES)('on the sample %s: at most three issues, each citing only tickets the dossier holds', async (name) => {
    const { data } = await loaded(name);
    const h = health(data.items, data.changes, FIXTURE_NOW);
    const r = recommend({ items: data.items, pullRequests: data.pullRequests, prepared: prepare({ items: data.items, changes: data.changes, deployments: data.deployments, health: h, now: FIXTURE_NOW }), health: h, readiness: data.readiness, now: FIXTURE_NOW });
    expect(r.issues.length).toBeLessThanOrEqual(3);
    const known = new Set([...data.items.map((i) => i.id), ...data.pullRequests.map((c) => c.id)]);
    for (const i of r.issues) {
      for (const id of i.tickets) expect(known.has(id), `${i.kind} names ${id}`).toBe(true);
      for (const [, id] of `${i.detail} ${i.action}`.matchAll(/\[\[([^\]]+)\]\]/g)) expect(known.has(id!), `${i.kind} cites ${id}`).toBe(true);
    }
    expect([...r.issues].sort((a, b) => b.weight - a.weight)).toEqual(r.issues);
    expect(r.headline).toBe(r.issues[0]?.action ?? r.headline);
  });

  it('says what card-payments should do first, from its blockers', async () => {
    const { data } = await loaded('card-payments');
    const h = health(data.items, data.changes, FIXTURE_NOW);
    const r = recommend({ items: data.items, pullRequests: data.pullRequests, prepared: prepare({ items: data.items, changes: data.changes, deployments: data.deployments, health: h, now: FIXTURE_NOW }), health: h, readiness: data.readiness, now: FIXTURE_NOW });
    expect(r.headline).toBe('Unblock [[corp-jira:PAY-101]] first: 2 items wait on it, directly or down a chain.');
    expect(r.issues.map((i) => [i.kind, i.title, i.tickets])).toEqual([
      ['blockers', '2 items blocked', ['corp-jira:PAY-101', 'corp-jira:PAY-102', 'corp-jira:PAY-103']],
      ['builds', '1 build failing', ['corp-jira:PAY-101']],
      ['scope', '18 points left, 3 days to go', ['corp-jira:PAY-103', 'corp-jira:PAY-102', 'corp-jira:PAY-107']],
    ]);
  });
});
