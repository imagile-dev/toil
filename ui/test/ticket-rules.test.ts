// @vitest-environment node
/**
 * Ticket rules in Toil UI (#657): the rule rows the readiness gate adds, the
 * Command Center's lines and drill, the server's check over the cache and its
 * route, "Fix with AI agent" in the queue (refused unless the item misses the
 * rule now), and the refine-to-rule prompt. The rules themselves are toil's,
 * tested in src/core/standards; these test that Toil UI reads them faithfully.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execute as toilExecute } from '@imagile-dev/toil/api';
import { fixtureAgent } from '../server/agent.ts';
import { modePromptText, readPrompt } from '../server/assign/prompts.ts';
import { memoryKeeper } from '../server/assign/files.ts';
import { createUiServer } from '../server/server.ts';
import { StandardsService } from '../server/standards.ts';
import { fixtureStore } from '../server/store.ts';
import type { AssignedRule } from '../src/assign/model.ts';
import { AssignmentQueue, type RunResult } from '../src/assign/queue.ts';
import { ruleFix, sampleQueue } from '../src/fixtures/assignments.ts';
import { fixtureExecute } from '../src/fixtures/execute.ts';
import { fixtureStandards } from '../src/fixtures/standards.ts';
import { loadToilProject } from '../src/load.ts';
import { readiness, readReadiness, RULES_UNREAD, type RulesReading } from '../src/model/readiness.ts';
import { missing, readingOf, ruleIn, ruleLines, ruleName } from '../src/rules.ts';
import type { RuleResult } from '../../src/core/standards/types.ts';
import type { Execute, WorkItem } from '../src/toil.ts';
import { letIn } from './let-in.ts';

const cards = await loadToilProject(fixtureExecute().execute, 'card-payments');
const byId = new Map(cards.items.map((i) => [i.id, i]));
const item = (id: string) => byId.get(id)!;
const rules = fixtureStandards();
const view = await rules.check('card-payments');
const result = view.result!;

const read = (results: Record<string, RuleResult[]>): RulesReading => ({ state: 'read', byItem: new Map(Object.entries(results)), message: null });
const res = (state: RuleResult['state'], rule = 'scenarios'): RuleResult => ({ standard: 'gherkin', rule, name: `Rule ${rule}`, state, reason: `It is ${state}.`, source: 'description' });

describe('the rule rows (#657)', () => {
  const settings = { ...readReadiness({ name: 'p', repos: [{ name: 'r' }], jira: {}, standards: { use: ['gherkin'] } }), standards: ['gherkin'] };
  const ready = item('corp-jira:PAY-101');

  it('reads the toil project\'s rules, and never takes standards for a source', () => {
    const s = readReadiness({ name: 'p', jira: {}, standards: { use: ['gherkin', 'bug-repro'] }, archived: false, analyze: {}, classify: {}, dimensions: {}, views: {} });
    expect(s.standards).toEqual(['gherkin', 'bug-repro']);
    expect(s.sources).toEqual(['jira']);
  });

  it('adds one row a rule after the five checks; a thin one makes the item thin, a skipped one counts for nothing', () => {
    const r = readiness({ item: ready, settings: { ...settings, sources: ['jira'], rules: read({ [ready.id]: [res('pass', 'a'), res('skipped', 'b')] }) }, byId });
    expect(r.rows.slice(5).map((x) => [x.check, x.state, x.rule])).toEqual([
      ['rule:gherkin/a', 'pass', { standard: 'gherkin', rule: 'a' }],
      ['rule:gherkin/b', 'skipped', { standard: 'gherkin', rule: 'b' }],
    ]);
    expect(r.rows[5]!.source).toBe('description (ticket rules: gherkin)');
    expect(r.why.map((x) => x.check)).not.toContain('rule:gherkin/b');
    const thin = readiness({ item: ready, settings: { ...settings, sources: ['jira'], rules: read({ [ready.id]: [res('thin')] }) }, byId });
    expect(thin.verdict).toBe('thin');
    expect(thin.why.map((x) => x.check)).toContain('rule:gherkin/scenarios');
    const failed = readiness({ item: ready, settings: { ...settings, sources: ['jira'], rules: read({ [ready.id]: [res('fail')] }) }, byId });
    expect(failed.verdict).toBe('blocked');
  });

  it('says the rules were not read yet, or why they could not be, with one row that never passes', () => {
    const unread = readiness({ item: ready, settings: { ...settings, sources: ['jira'] }, byId });
    expect(unread.rows.slice(5)).toEqual([{ check: 'rules', label: 'Ticket rules', state: 'skipped', reason: 'Not read yet.', source: 'ticket rules: gherkin' }]);
    const failed = readiness({ item: ready, settings: { ...settings, sources: ['jira'], rules: readingOf(null, 'toil broke.') }, byId });
    expect(failed.rows[5]).toMatchObject({ state: 'skipped', reason: "Couldn't be checked: toil broke." });
    expect(failed.why).toEqual(unread.why);
  });

  it('shows nothing about rules for a toil project that names none', () => {
    const none = readiness({ item: ready, settings: { ...settings, standards: [], rules: RULES_UNREAD }, byId });
    expect(none.rows).toHaveLength(5);
  });
});

describe("the sample's rules and the Command Center's lines", () => {
  it('checks card-payments against gherkin and bug-repro: PAY-101 and PAY-102 meet Given/When/Then, the other stories miss it', () => {
    expect(ruleIn(result, 'corp-jira:PAY-101', 'gherkin', 'scenarios')).toMatchObject({ state: 'pass', text: expect.stringContaining('Given line') });
    expect(ruleIn(result, 'corp-jira:PAY-103', 'gherkin', 'scenarios')).toMatchObject({ state: 'thin' });
    expect(ruleIn(result, 'corp-jira:PAY-103', 'bug-repro', 'steps')).toBeNull();
  });

  it('gives a line a rule over the open items, in the words a person reads', () => {
    const open = cards.items.filter((i) => i.statusCategory !== 'DONE');
    const lines = ruleLines(result, open);
    const scenarios = lines.find((l) => l.ref === 'gherkin/scenarios')!;
    expect([scenarios.miss, scenarios.applies, scenarios.noun(scenarios.applies)]).toEqual([2, 4, 'stories']);
    const steps = lines.find((l) => l.ref === 'bug-repro/steps')!;
    expect([steps.miss, steps.applies, steps.noun(1)]).toEqual([1, 1, 'bug']);
    expect([...missing(result, 'gherkin/scenarios')!].sort()).toEqual(['corp-jira:PAY-103', 'corp-jira:PAY-107', ...['corp-jira:PAY-92', 'corp-jira:PAY-95', 'corp-jira:PAY-98', 'corp-jira:PAY-105'].filter((id) => missing(result, 'gherkin/scenarios')!.has(id))].sort());
    expect(missing(result, 'gherkin/nope')).toBeNull();
    expect(ruleName(result, 'gherkin/scenarios')).toBe('Acceptance criteria as Given/When/Then');
  });

  it('reads as not read yet until a check comes back, never as an empty one', () => {
    expect(readingOf(null)).toBe(RULES_UNREAD);
    expect(readingOf({ result: null, warnings: [] }).state).toBe('unread');
    expect(readingOf(view).byItem.get('corp-jira:PAY-103')!.map((r) => r.rule)).toEqual(['scenarios']);
  });
});

describe('the server (#657)', () => {
  it("runs toil's own standards check, read-only, over the synced items, and keeps the answer until the next sync", async () => {
    const calls: Array<{ command: string; options: unknown }> = [];
    let synced = 'one';
    const execute: Execute = async (command, input, options) => (calls.push({ command, options }), toilExecute(command, { text: input?.text, standard: ['gherkin', 'bug-repro'] }, options));
    const service = new StandardsService({ execute, items: (p) => (p === 'card-payments' ? cards.items : null), syncedAt: () => synced });
    const first = await service.check('card-payments');
    expect(first.result!.items.find((i) => i.id === 'corp-jira:PAY-103')!.results.find((r) => r.rule === 'scenarios')!.state).toBe('thin');
    expect(calls).toEqual([{ command: 'standards check', options: { readOnly: true, caller: 'toil-ui' } }]);
    await service.check('card-payments');
    expect(calls).toHaveLength(1);
    synced = 'two';
    await service.check('card-payments');
    expect(calls).toHaveLength(2);
    expect(await service.check('never-synced')).toEqual({ result: null, warnings: [] });
    expect((await service.ruleFor('card-payments', 'corp-jira:PAY-103', 'gherkin', 'scenarios'))!.state).toBe('thin');
  });

  it('says why when toil refuses, as a failed reading the agent tools carry', async () => {
    const execute: Execute = async (command) => ({ ok: false, data: null, error: { code: 'INVALID_INPUT', message: 'it broke.', fix: 'Mend it.' }, meta: { command, durationMs: 0, version: 't', contractVersion: 1 } }) as never;
    const service = new StandardsService({ execute, items: () => cards.items, syncedAt: () => 'x' });
    await expect(service.check('card-payments')).rejects.toThrow("toil couldn't check the ticket rules: it broke.");
    expect(await service.reading('card-payments')).toMatchObject({ state: 'failed', message: "toil couldn't check the ticket rules: it broke." });
  });

  describe('api/standards', () => {
    let dir = '';
    let close: (() => Promise<void>) | undefined;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'toil-ui-standards-'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    });
    afterEach(async () => {
      await close?.();
      rmSync(dir, { recursive: true, force: true });
    });

    it("answers with the toil project's check, and refuses a name that isn't one", async () => {
      const ui = createUiServer({ settings: { host: '127.0.0.1', port: 0, basePath: '/', dataDir: dir, retentionDays: 30, sample: true }, store: fixtureStore(), agent: fixtureAgent(), appDir: dir, version: '0.0.0-test', toil: { version: '0.0.0-test', contractVersion: 1 }, standards: fixtureStandards() });
      const { origin } = await ui.listen();
      close = () => ui.close();
      const cookie = await letIn(origin);
      const get = async (path: string) => {
        const r = await fetch(new URL(path, origin), { headers: { cookie, origin } });
        return { status: r.status, body: (await r.json()) as { result?: { standards: Array<{ name: string }> }; error?: { message: string } } };
      };
      const ok = await get('/api/standards?toilProject=card-payments');
      expect(ok.status).toBe(200);
      expect(ok.body.result!.standards.map((s) => s.name)).toEqual(['gherkin', 'bug-repro']);
      const bad = await get('/api/standards?toilProject=../etc');
      expect(bad.status).toBe(400);
    });
  });
});

describe('Fix with AI agent in the queue (#657)', () => {
  function queue(ruleFor = rules.ruleFor) {
    let n = 0;
    const runs: RunResult[] = [];
    const q = new AssignmentQueue({
      keeper: memoryKeeper(),
      runner: { adapters: () => [{ name: 'codex', label: 'Codex', problem: null, implement: null }], preferred: () => 'codex', run: () => new Promise<RunResult>(() => undefined) },
      items: () => cards.items,
      people: async () => [],
      repos: async () => [],
      apply: async () => ({}) as never,
      ruleFor,
      settings: () => ({ concurrent: 0, timeLimitMinutes: 20 }),
      now: () => '2026-10-13T08:00:00.000Z',
      newId: () => `fix-${String(++n).padStart(8, '0')}`,
    });
    return { q, runs };
  }

  it('queues a refine held to the rule, with its name, text and toil\'s reason', async () => {
    const { q } = queue();
    const a = await q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } });
    expect(a.standard).toMatchObject({ standard: 'gherkin', rule: 'scenarios', name: 'Acceptance criteria as Given/When/Then', text: expect.stringContaining('Given'), reason: expect.stringContaining('missing') });
    expect(q.get(a.id).transcript[0]!.title).toContain('to meet the ticket rule "Acceptance criteria as Given/When/Then"');
  });

  it("refuses when the rule already passes, doesn't apply, or the mode isn't refine", async () => {
    const { q } = queue();
    await expect(q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-101', mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already meets') });
    await expect(q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: 'bug-repro', rule: 'steps' } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("doesn't apply") });
    await expect(q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'investigate', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } })).rejects.toThrow('is a refine');
    await expect(q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: '../x', rule: 'scenarios' } as never })).rejects.toThrow('names one ticket rule');
    const skipped = queue(async () => ({ ...res('skipped'), text: 't' }));
    await expect(skipped.q.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } })).rejects.toThrow("couldn't check");
    const none = new AssignmentQueue({ keeper: memoryKeeper(), runner: { adapters: () => [{ name: 'codex', label: 'Codex', problem: null, implement: null }], preferred: () => 'codex', run: () => new Promise<RunResult>(() => undefined) }, items: () => cards.items, people: async () => [], repos: async () => [], apply: async () => ({}) as never, settings: () => ({ concurrent: 0, timeLimitMinutes: 20 }), now: () => 'x', newId: () => 'fix-none-0001' });
    await expect(none.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } })).rejects.toMatchObject({ status: 404 });
  });

  it("the sample's scripted run answers with one proposal that rewrites the criteria field, and asks about the gaps", async () => {
    const s = sampleQueue(fixtureExecute().execute, { delay: 0 });
    await s.ready;
    const a = await s.queue.assign({ toilProject: 'card-payments', item: 'corp-jira:PAY-103', mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } });
    for (let i = 0; i < 50 && s.queue.get(a.id).state !== 'needs-you'; i++) await new Promise((r) => setTimeout(r, 10));
    const done = s.queue.get(a.id);
    expect(done.proposals, JSON.stringify(done.proposals)).toHaveLength(1);
    expect(done.proposals[0], JSON.stringify(done.proposals[0])).toBeTruthy();
    expect(done.proposals[0]).toMatchObject({ command: 'jira issue update', input: { key: 'PAY-103', field: [expect.stringMatching(/^customfield_10500=Scenario: Charge a stored token\n {2}Given/)] } });
    expect(done.questions.length).toBeGreaterThan(0);
  });
});

describe('the refine-to-rule prompt (#657)', () => {
  const rule: AssignedRule = { standard: 'gherkin', rule: 'scenarios', name: 'Acceptance criteria as Given/When/Then', text: 'State the criteria as Given, When, Then lines.', reason: 'None of the 3 patterns was found in description.', source: 'field customfield_10500 (acceptanceCriteria)' };
  const p103: WorkItem = item('corp-jira:PAY-103');

  it("tells the agent the rule's name and text and toil's reason, asks for exactly one proposal, and to invent nothing", () => {
    const { prompt } = readPrompt('refine', 'card-payments', p103, 'now', rule);
    for (const part of [rule.name, rule.text, rule.reason, rule.source, 'exactly one change', 'Invent nothing', 'QUESTION:']) expect(prompt).toContain(part);
    expect(prompt).not.toContain('Suggest an estimate');
    expect(readPrompt('refine', 'card-payments', p103, 'now').prompt).toContain('Suggest an estimate');
  });

  it("is in refine's fingerprint with placeholders only, so a team's rule never moves the hash", () => {
    expect(modePromptText('refine')).toContain('<rule name>');
    expect(modePromptText('refine')).toContain('Invent nothing');
    expect(modePromptText('investigate')).not.toContain('<rule name>');
  });

  it("the sample's canned fix writes the description when toil read the description", () => {
    const fix = ruleFix('card-payments', p103, { ...rule, source: 'description' });
    expect(fix.proposal.input).toMatchObject({ key: 'PAY-103', description: expect.stringContaining('Given') });
  });
});
