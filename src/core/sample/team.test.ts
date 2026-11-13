import { describe, expect, it } from 'vitest';
import { Verifier } from '../../areas/util/kit/verify.js';
import { checkAgainstSchema } from '../../areas/util/owi/run.js';
import { areas } from '../../registry.js';
import { builtinScheme } from '../classify/builtin.js';
import { classify } from '../classify/engine.js';
import { outstandingQuestions } from '../owi/comment.js';
import { pivot, releaseScope } from '../insights/index.js';
import { findSecrets } from '../secret-shapes.js';
import { validateToilProject } from '../toil-project.js';
import { sampleTeam } from './team.js';

/**
 * The sample team holds the thirty questions of docs/work-insights-seats.md
 * and the pipeline that answers them, so these tests are the inventory:
 * each says which question a figure is there for. A sample nobody checks
 * decays into a sample nobody trusts, which is the usual lifecycle of a
 * demo environment.
 */

const AS_OF = '2026-11-10T08:00:00Z';
const team = sampleTeam(AS_OF);
const { items, changes } = team.owi;
const facts = team.facts;
const DAYS = 86_400_000;

const classified = () => classify({ scheme: builtinScheme('ktlo-feature')!, items }).result;

/** Every date-time and calendar date in the text, moved by `days`. */
function shifted(text: string, days: number): string {
  return text.replace(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+0000))?/g, (found) => {
    const hasTime = found.length > 10;
    const ms = Date.parse(hasTime ? found.replace('+0000', 'Z') : `${found}T00:00:00Z`) + days * DAYS;
    const iso = new Date(ms).toISOString();
    if (!hasTime) return iso.slice(0, 10);
    const out = found.includes('.') ? iso : iso.replace('.000Z', 'Z');
    return found.endsWith('+0000') ? out.replace('Z', '+0000') : out;
  });
}

describe('the generator', () => {
  it('is deterministic: the same day twice is the same bytes', () => {
    expect(JSON.stringify(sampleTeam(AS_OF))).toBe(JSON.stringify(team));
    expect(sampleTeam(AS_OF)).toEqual(team);
  });

  it('is relative: a day two weeks later moves every date by two weeks and nothing else', () => {
    const later = sampleTeam('2026-11-24T08:00:00Z');
    expect(JSON.stringify(later)).toBe(shifted(JSON.stringify(team), 14));
  });

  it('reads only the day: the time of day given does not change a byte but the asOf it reports', () => {
    const noon = sampleTeam('2026-11-10T12:30:00Z');
    expect(JSON.stringify({ ...noon, asOf: '', facts: { ...noon.facts, asOf: '' } })).toBe(JSON.stringify({ ...team, asOf: '', facts: { ...team.facts, asOf: '' } }));
  });

  it('has nothing later than the sample\'s now', () => {
    const now = Date.parse(AS_OF);
    const stamps = JSON.stringify(team).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+0000)/g)!;
    const late = stamps.filter((s) => Date.parse(s.replace('+0000', 'Z')) > now && !/startDate|endDate/.test(s));
    // Future sprint ends and release dates are future by design; everything an event wrote down is not.
    const events = [...items.flatMap((i) => [i.created, i.updated, i.resolved, ...(i.history?.transitions.map((t) => t.at) ?? []), ...(i.history?.iterations.map((t) => t.at) ?? [])]), ...changes.flatMap((c) => [c.created, c.updated, c.mergedAt, c.firstReviewAt])];
    expect(events.filter((t): t is string => t !== null && Date.parse(t) > now)).toEqual([]);
    expect(late.length).toBeGreaterThan(0);
  });
});

describe('what it hands out', () => {
  it('maps cleanly: no unmapped field, no skipped record, every item and change valid against docs/owi/schema.json', async () => {
    expect([...items, ...changes].filter((r) => r.unmapped.length > 0).map((r) => `${r.id}: ${r.unmapped.map((u) => u.field).join(',')}`)).toEqual([]);
    const v = new Verifier(() => undefined);
    await checkAgainstSchema(v, items, [], undefined, changes);
    const done = v.done();
    expect(done.passed).toBe(true);
    expect(done.checks.map((c) => [c.check, c.status, c.checked])).toEqual([
      ['items.schema', 'passed', items.length],
      ['changes.schema', 'passed', changes.length],
    ]);
  });

  it('is a toil project the real reader loads, with nothing to warn about', () => {
    const { toilProject, problems } = validateToilProject(team.toilProject, areas.map((a) => ({ name: a.name, context: Object.keys(a.context), ...(a.siteApis ? { siteApis: a.siteApis } : {}) })));
    expect(problems).toEqual([]);
    expect(toilProject).toMatchObject({ name: 'sample-team', wipLimit: 3, classify: { scheme: 'ktlo-feature' }, dimensions: { customer: { jira: 'customfield_10500' } } });
    expect(toilProject!.people).toHaveLength(9);
    expect(new Set(toilProject!.people.map((p) => p.team))).toEqual(new Set(['Storefront', 'Platform']));
    expect(toilProject!.people.filter((p) => p.kind === 'agent')).toHaveLength(1);
    expect(toilProject!.sections.jira).toMatchObject({ connection: 'sample-jira', project: 'SHOP' });
    expect(toilProject!.sections.github).toMatchObject({ connection: 'sample-github', owner: 'imagile', repo: 'shop' });
  });

  it('holds no host but the placeholders, no address but the reserved one, and nothing shaped like a secret', () => {
    const text = JSON.stringify(team);
    const hosts = new Set([...text.matchAll(/https?:\/\/([^/\s"'\\]+)/g)].map((m) => m[1]));
    expect([...hosts].sort()).toEqual(['github.imagile.dev', 'jira.imagile.dev']);
    expect(new Set([...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0]))).toEqual(new Set(['you@example.com']));
    expect(findSecrets(text)).toEqual([]);
  });
});

describe('its figures', () => {
  it('has a team of nine people in two teams, one an AI agent', () => {
    expect(facts.people).toEqual({ total: 9, teams: 2, agents: 1 });
    expect(facts.wipLimit).toBe(3);
  });

  it('has the sizes the documentation quotes', () => {
    expect(facts.items).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(130);
    expect(facts.byType).toMatchObject({ Initiative: 1, Epic: 5 });
    expect(facts.pullRequests).toMatchObject({ total: 16, bots: 2, agents: 1, failingMoreThanADay: 1 });
    expect(facts.pullRequests.open).toBeGreaterThanOrEqual(5);
  });

  it('M1-M4, P6: classifies to about 55 percent feature, a third upkeep and a tenth unsure, upkeep in two components, settled by every kind of source', () => {
    const { summary, verdicts } = classified();
    const share = (id: string) => (summary.byCategory[id] ?? 0) / items.length;
    expect(share('feature')).toBeGreaterThan(0.48);
    expect(share('feature')).toBeLessThan(0.6);
    expect(share('ktlo')).toBeGreaterThan(0.28);
    expect(share('ktlo')).toBeLessThan(0.4);
    expect(share('unsure')).toBeGreaterThanOrEqual(0.05);
    expect(share('unsure')).toBeLessThanOrEqual(0.2);
    expect(Object.keys(summary.bySource)).toEqual(expect.arrayContaining(['label', 'parent', 'unsure', 'signal:type', 'signal:title', 'signal:security-id', 'signal:bot-author']));
    const upkeepByComponent: Record<string, number> = {};
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const v of verdicts) if (v.category === 'ktlo') for (const c of byId.get(v.id)!.components ?? []) upkeepByComponent[c] = (upkeepByComponent[c] ?? 0) + 1;
    const [first, second, third] = Object.values(upkeepByComponent).sort((a, b) => b - a);
    expect(first! + second!).toBeGreaterThan(0.6 * Object.values(upkeepByComponent).reduce((a, b) => a + b, 0));
    expect(second!).toBeGreaterThan(third! * 1.3);
  });

  it('M2, S4: has both categories in every closed sprint, and a rising share of upkeep to the last two sprints', () => {
    const closed = facts.sprints.filter((s) => s.state === 'closed');
    expect(closed).toHaveLength(5);
    for (const s of facts.sprints) {
      expect(s.keepTheLightsOn, s.name).toBeGreaterThan(0);
      expect(s.feature, s.name).toBeGreaterThan(0);
    }
    const upkeep = facts.sprints.map((s) => s.keepTheLightsOn / (s.keepTheLightsOn + s.feature + s.unsure));
    expect(Math.min(upkeep[4]!, upkeep[5]!)).toBeGreaterThan(Math.max(upkeep[0]!, upkeep[1]!, upkeep[2]!) + 0.05);
  });

  it('S2, S3: has five closed sprints and a current one, with carried and added work and a velocity that varies', () => {
    expect(facts.sprints.map((s) => s.name)).toEqual(['Sprint 21', 'Sprint 22', 'Sprint 23', 'Sprint 24', 'Sprint 25', 'Sprint 26']);
    expect(facts.sprints.at(-1)!.state).toBe('active');
    for (const s of facts.sprints.slice(0, 5)) expect(s.done, s.name).toBeGreaterThan(10);
    expect(facts.sprints.filter((s) => s.added > 0).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...facts.sprints.map((s) => s.added))).toBeGreaterThanOrEqual(3);
    expect(facts.sprints.filter((s) => s.carriedIn > 0).length).toBeGreaterThanOrEqual(4);
    expect(new Set(facts.sprints.slice(0, 5).map((s) => s.donePoints)).size).toBeGreaterThanOrEqual(4);
    expect(facts.inSeveralSprints).toBeGreaterThanOrEqual(10);
    expect(items.filter((i) => (i.sprints?.length ?? 0) > 1 && i.typeName !== 'Sub-task').every((i) => i.history?.iterations.length)).toBe(true);
  });

  it('S1: puts the current sprint on its seventh working day of ten, with its end still ahead', () => {
    const current = items.find((i) => i.iteration?.state === 'current')!.iteration!;
    expect(current.name).toBe('Sprint 26');
    const asOf = Date.parse(AS_OF);
    expect(Date.parse(current.start!)).toBe(Date.parse('2026-11-02T09:00:00.000Z'));
    expect(Date.parse(current.end!)).toBeGreaterThan(asOf);
    // 2 to 10 November, Monday to Tuesday: the seventh working day.
    expect(Math.round((Date.UTC(2026, 10, 10) - Date.UTC(2026, 10, 2)) / DAYS)).toBe(8);
  });

  it('P1, P2, P3, P5, P9: has a released 2.3, a 2.4 due in eleven days that grew after it started, and a 2.5 ahead', () => {
    const [r23, r24, r25] = facts.releases;
    expect(facts.releases.map((r) => r.name)).toEqual(['2.3', '2.4', '2.5']);
    expect(r23).toMatchObject({ released: true, date: '2026-10-06', done: r23!.items });
    expect(r24).toMatchObject({ released: false, date: '2026-11-21' });
    expect(r25!.released).toBe(false);
    expect(r24!.growth).toBeGreaterThanOrEqual(0.1);
    expect(r24!.scopeAdded).toBeGreaterThanOrEqual(5);
    expect(r24!.open).toBeGreaterThanOrEqual(8);
    expect(r24!.carriedIn).toBeGreaterThanOrEqual(2);
    const overdueOpen = items.filter((i) => i.statusCategory !== 'DONE' && i.dueDate !== null && i.dueDate < '2026-11-10');
    expect(overdueOpen.length).toBeGreaterThanOrEqual(2);
    expect(facts.withNoFixVersion).toBeGreaterThan(5);
    expect(items.filter((i) => (i.affects?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
    for (const v of ['2.3', '2.4', '2.5']) expect(items.some((i) => i.releases?.some((r) => r.name === v && r.date !== null)), v).toBe(true);
  });

  it('P2: the items alone say 2.4 grew by what the facts count, from the Jira version start date, and 2.5 (not yet started) says nothing', () => {
    const r24 = facts.releases.find((r) => r.name === '2.4')!;
    const scope = releaseScope(items, '2.4', AS_OF);
    expect(scope).toMatchObject({ start: '2026-10-06', total: r24.items, added: r24.scopeAdded, done: r24.done, open: r24.open, pastDue: [], carriedIn: null });
    expect(scope.addedItems).toHaveLength(8);
    // 2.5 starts on a day after the sample's now, so nothing was created after it started: honest, and below the threshold.
    expect(releaseScope(items, '2.5', AS_OF)).toMatchObject({ start: '2026-11-22', added: 0 });
    const categories = Object.fromEntries(classified().verdicts.map((v) => [v.id, v.category]));
    const view = pivot({ items, spec: { measure: 'items', split: 'category', across: 'release' }, asOf: AS_OF, categories });
    const scopes = view.notable.filter((n) => n.kind === 'scope-added');
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({ column: 'v:' + (items.flatMap((i) => i.releases ?? []).find((x) => x.name === '2.4')!.id ?? '2.4') });
    expect(scopes[0]!.message).toBe('2.4: 8 items were added after it started on 2026-10-06, 19% more than the 43 it started with.');
  });

  it('P6, P4, P7: has five components, items with none and with two, five epics under an initiative, and items with no epic', () => {
    expect(Object.keys(facts.components).sort()).toEqual(['Accounts', 'Catalog', 'Checkout', 'Platform', 'Search']);
    expect(facts.withNoComponent).toBeGreaterThanOrEqual(3);
    expect(facts.withTwoComponents).toBeGreaterThanOrEqual(5);
    const epics = items.filter((i) => i.type === 'EPIC');
    expect(epics).toHaveLength(5);
    expect(items.filter((i) => i.typeName === 'Initiative')).toHaveLength(1);
    expect(items.filter((i) => i.ancestors?.some((a) => a.typeName === 'Initiative') && i.type === 'EPIC')).toHaveLength(2);
    expect(epics.map((e) => e.title)).toEqual(expect.arrayContaining(['Platform upkeep', 'Checkout redesign']));
    const share = facts.withNoEpic / (items.length - 6);
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.2);
    expect(items.filter((i) => i.type === 'TASK' && i.typeName === 'Sub-task').length).toBeGreaterThanOrEqual(5);
  });

  it('S5, S6, S7, S8, M6, M7: has blocked work, aging work, unassigned work and one person over the limit', () => {
    expect(facts.blockedByLinks).toBe(6);
    expect(facts.blockedNow).toBe(2);
    expect(facts.unassignedInCurrentSprint).toBe(3);
    expect(facts.aging).toBe(2);
    expect(facts.overTheLimit).toEqual(['S. Garcia']);
    expect(facts.reopened).toBe(2);
    expect(facts.incidents).toBeGreaterThanOrEqual(4);
    expect(facts.withNoEstimate).toBeGreaterThanOrEqual(5);
    expect(facts.medianCycleDays).toBeGreaterThanOrEqual(3);
    expect(facts.medianCycleDays).toBeLessThanOrEqual(5.5);
    expect(items.filter((i) => i.statusCategory === 'IN_PROGRESS').some((i) => i.history?.transitions.some((t) => t.to === 'In Review'))).toBe(true);
  });

  it('S4: has incidents added to sprints after they started, as unplanned work', () => {
    const incidents = items.filter((i) => i.type === 'INCIDENT' || i.labels.includes('incident'));
    expect(incidents.length).toBeGreaterThanOrEqual(4);
    for (const i of incidents) {
      const sprint = i.sprints!.at(0)!;
      expect(i.history!.iterations.some((c) => Date.parse(c.at) > Date.parse(sprint.start!)), i.id).toBe(true);
    }
  });

  it('M9, M5: has about a fifth of the items for a customer, and pull requests of every kind', () => {
    expect(facts.withACustomer / items.length).toBeGreaterThan(0.12);
    expect(facts.withACustomer / items.length).toBeLessThan(0.28);
    expect(new Set(items.flatMap((i) => i.dims?.customer ?? []))).toEqual(new Set(['Acme', 'Globex', 'Initech']));
    expect(changes.filter((c) => c.state === 'MERGED').every((c) => c.firstReviewAt !== null && c.mergedAt !== null)).toBe(true);
    expect(changes.every((c) => c.workItems.length === 1)).toBe(true);
    const open = changes.filter((c) => c.state === 'OPEN');
    expect(open.some((c) => c.checks === 'FAILING')).toBe(true);
    expect(changes.some((c) => c.authorKind === 'AGENT')).toBe(true);
  });
});

describe('the comments', () => {
  const day = (iso: string) => iso.slice(0, 10);
  const today = AS_OF.slice(0, 10);
  const withComments = items.filter((i) => (i.comments?.length ?? 0) > 0);

  it('are read for every item, none or some, and counted in the facts', () => {
    expect(items.every((i) => Array.isArray(i.comments))).toBe(true);
    expect(facts.comments).toEqual({ total: 14, items: withComments.length, outstandingQuestions: 2 });
  });

  it('leave two questions open, one from days ago and one from yesterday, and one answered', () => {
    const open = items.flatMap((i) => outstandingQuestions(i.comments ?? []).map((c) => ({ item: i.source.key, who: c.author!.name, day: day(c.at) })));
    expect(open.map((o) => o.who).sort()).toEqual(['A. Chen', 'D. Okafor']);
    const asked = (who: string) => Date.parse(`${today}T00:00:00Z`) - Date.parse(`${open.find((o) => o.who === who)!.day}T00:00:00Z`);
    expect(asked('D. Okafor') / DAYS).toBeGreaterThanOrEqual(2);
    expect(asked('A. Chen') / DAYS).toBe(1);
    // R. Patel's question about the postcode has J. Smith's answer under it.
    const answered = items.find((i) => i.title === 'Checkout fails for postcodes with a trailing space')!;
    expect(answered.comments!.map((c) => c.author!.name)).toEqual(['R. Patel', 'J. Smith']);
    expect(outstandingQuestions(answered.comments!)).toEqual([]);
  });

  it('include one person with several comments and one from the AI agent, as plain text with a link', () => {
    const by = (name: string) => items.flatMap((i) => (i.comments ?? []).filter((c) => c.author?.name === name));
    expect(by('K. Nakamura').length).toBeGreaterThan(3);
    expect(by('Copilot').length).toBeGreaterThan(0);
    for (const c of items.flatMap((i) => i.comments ?? [])) {
      expect(c.text).not.toMatch(/[<>]/);
      expect(c.url).toMatch(/^https:\/\/jira\.imagile\.dev\/browse\/SHOP-\d+\?focusedCommentId=\d+$/);
    }
  });
});
