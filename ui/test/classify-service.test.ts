// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute as toil } from '@imagile-dev/toil/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from '../../src/core/classify/engine.ts';
import { defaultScheme } from '../../src/core/classify/builtin.ts';
import { ClassifyRefusal, ClassifyService, jsonIn, type ClassifyAgents } from '../server/classify.ts';
import { itemsInPrompt, scriptedVerdict } from '../src/fixtures/classify.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';
import type { Envelope, Execute, WorkItem } from '../src/toil.ts';

/**
 * The Classify view's server (#566) on toil's own commands, in a throwaway home: what it asks toil for, the plan file it
 * hands `categorize`, and the three things that would quietly corrupt a person's ledger if they were wrong (the label
 * outranking a person's say, a confirmation with no verdict to confirm, and the record after Apply reversing the say).
 * The tracker's `categorize` is the one command faked, because it is the one that would reach a service.
 */

const execute = toil as unknown as Execute;
const fwd = (p: string): string => p.split('\\').join('/');
let home = '';
let data = '';

beforeEach(() => {
  home = realpathSync.native(mkdtempSync(join(tmpdir(), 'toil-ui-classify-')));
  data = join(home, '.toil-ui');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  mkdirSync(join(home, '.toil', 'projects'), { recursive: true });
  writeFileSync(join(home, '.toil', 'projects', 'team.json'), JSON.stringify({ name: 'team', description: 'A team' }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

/** Items from the sample team that no parent decides, so each is classified on its own. */
const standalone = (): WorkItem[] => {
  const items = SAMPLE_TEAM.owi.items as WorkItem[];
  const verdicts = new Map(classify({ scheme: defaultScheme(), items }).result.verdicts.map((v) => [v.id, v]));
  return items.filter((i) => !i.parent && verdicts.get(i.id)!.category !== null && !(SAMPLE_TEAM.owi.items as WorkItem[]).some((o) => o.parent === i.id));
};

const ok = (command: string, data: unknown): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 't', contractVersion: 1 } }) as Envelope;

/** toil for everything, except what would reach a tracker: connections are listed as the test says, and categorize is only recorded. */
function wrapped(writes: boolean) {
  const calls: Array<{ command: string; input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const run: Execute = async (command, input = {}, options = {}) => {
    if (command === 'connections list') return ok(command, { configFile: 'x', connections: [{ name: 'sample-jira', area: 'jira', isDefault: true, host: null, writes, values: {} }] });
    if (command.endsWith('categorize')) {
      calls.push({ command, input, options: options as Record<string, unknown> });
      return ok(command, { connection: 'sample-jira', changed: [{ id: 'x', key: 'SHOP-1', category: 'feature', labels: { added: ['feature'], removed: ['ktlo'] }, field: null }], unchanged: [], failed: [], skipped: [], counts: { planned: 1, changed: 1, unchanged: 0, failed: 0 } });
    }
    return execute(command, input, options);
  };
  return { run, calls };
}

const answers = (text: (prompt: string) => string): ClassifyAgents => ({
  list: async () => [{ name: 'scripted', label: 'Scripted', ready: true, problem: null }],
  run: async ({ prompt }) => ({ text: text(prompt), by: 'Scripted' }),
});
const signal = new AbortController().signal;
const service = (run: Execute, agents: ClassifyAgents | null = null) => new ClassifyService({ execute: run, dataDir: data, agents, uid: (() => { let n = 0; return () => `u${++n}`; })() });

describe('the ledger the page reads', () => {
  it('is an empty ledger with nothing checked, the built-in scheme, and no figure turned into 0', async () => {
    const view = await service(execute).ledger('team');
    expect(view.scheme.name).toBe('ktlo-feature');
    expect(view.kept).toBe('built-in');
    expect(view.standing).toEqual({});
    expect(view.stats?.agreement.overall).toBeNull();
    expect(view.stats?.ledger.lines).toBe(0);
  });

  it("records a person's word, with the verdict recorded first so a confirmation counts as agreement", async () => {
    const [item] = standalone();
    const verdict = classify({ scheme: defaultScheme(), items: [item!] }).result.verdicts[0]!;
    const s = service(execute);
    await s.correct('team', { item: item!, context: [], to: verdict.category, reason: 'Yes, that is right.' });
    const view = await s.ledger('team');
    expect(view.standing[item!.id]).toEqual({ category: verdict.category, reason: 'Yes, that is right.' });
    expect(view.stats?.ledger).toMatchObject({ verdicts: 1, confirmations: 1, corrections: 0 });
    expect(view.stats?.agreement).toMatchObject({ overall: 1, checked: 1 });
  });

  it('keeps a taking-back as a null say, so an item answered "unsure" is not shown as waiting', async () => {
    const [item] = standalone();
    const s = service(execute);
    await s.correct('team', { item: item!, context: [], to: null, reason: '' });
    expect((await s.ledger('team')).standing[item!.id]).toEqual({ category: null, reason: null });
  });
});

describe('the plan and Apply', () => {
  /** A ktlo-labelled item that a person says is Feature: the label would win without `recheck`. */
  const labelled = (): WorkItem => ({ ...standalone().find((i) => i.source.area === 'jira')!, labels: ['ktlo'] });

  it("plans what a person decided over a label already on the item: the label comes off and theirs goes on", async () => {
    const item = labelled();
    const { run } = wrapped(true);
    const s = service(run);
    await s.correct('team', { item, context: [], to: 'feature', reason: 'It adds a feature.' });
    const plan = await s.plan('team', { items: [item], accepted: [] });
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ area: 'jira', connection: 'sample-jira', writes: true, command: { name: 'jira issue categorize' } });
    expect(plan.groups[0]!.changes).toEqual([expect.objectContaining({ id: item.id, category: 'feature', labelsFrom: ['ktlo'], labelsAdd: ['feature'], labelsRemove: ['ktlo'], field: null })]);
  });

  it('applies through the tracker\'s own categorize, on a plan file in its own folder, with allowWrite, then leaves the person\'s say standing', async () => {
    const item = labelled();
    const { run, calls } = wrapped(true);
    const s = service(run);
    await s.correct('team', { item, context: [], to: 'feature', reason: 'It adds a feature.' });
    const result = await s.apply('team', { items: [item], accepted: [] }, signal);
    expect(result.outcomes[0]).toMatchObject({ connection: 'sample-jira', refused: null, changed: [{ key: 'SHOP-1' }] });
    expect(result.recorded).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: 'jira issue categorize', input: { connection: 'sample-jira', allowWrite: true }, options: { readOnly: false, caller: 'toil-ui' } });
    const file = String(calls[0]!.input.from);
    expect(fwd(file).startsWith(fwd(join(data, 'classify')))).toBe(true);
    const written = JSON.parse(readFileSync(file, 'utf8')) as { plan: Array<{ connection: string; items: Array<{ id: string; category: string; labels: { add: string[]; remove: string[] } }> }> };
    expect(written.plan).toHaveLength(1);
    expect(written.plan[0]!.items).toEqual([expect.objectContaining({ id: item.id, category: 'feature', labels: { add: ['feature'], remove: ['ktlo'] } })]);

    // The record after Apply ran on an item that still holds the old label, and must not have read that as someone changing it back.
    const view = await s.ledger('team');
    expect(view.standing[item.id]?.category).toBe('feature');
    const lines = readFileSync(join(home, '.toil', 'classify', 'ktlo-feature.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; item: string; via?: string; to?: string });
    expect(lines.filter((l) => l.via === 'tracker')).toEqual([]);
    expect(lines.filter((l) => l.kind === 'correction' && l.item === item.id).map((l) => l.to)).toEqual(['feature']);
  });

  it("reports that writes are off for the connection, from toil's own list, without writing anything", async () => {
    const item = labelled();
    const { run, calls } = wrapped(false);
    const s = service(run);
    await s.correct('team', { item, context: [], to: 'feature', reason: '' });
    const plan = await s.plan('team', { items: [item], accepted: [] });
    expect(plan.groups[0]!.writes).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does a second Apply with nothing to run twice at once', async () => {
    const item = labelled();
    const { run } = wrapped(true);
    const s = service(run);
    await s.correct('team', { item, context: [], to: 'feature', reason: '' });
    const first = s.apply('team', { items: [item], accepted: [] }, signal);
    await expect(s.apply('team', { items: [item], accepted: [] }, signal)).rejects.toMatchObject({ status: 409 });
    await first;
  });

  it('refuses an accepted answer for an item that is not in the plan', async () => {
    const [item] = standalone();
    await expect(service(execute).plan('team', { items: [item!], accepted: [{ id: 'sample-jira:NOPE-1', category: 'feature', reason: 'x' }] })).rejects.toBeInstanceOf(ClassifyRefusal);
  });
});

describe('asking the AI agent', () => {
  const unsure = (): WorkItem[] => {
    const items = SAMPLE_TEAM.owi.items as WorkItem[];
    const verdicts = new Map(classify({ scheme: defaultScheme(), items }).result.verdicts.map((v) => [v.id, v]));
    return items.filter((i) => verdicts.get(i.id)!.category === null);
  };
  const fenced = (list: unknown) => `Here is my answer.\n\n\`\`\`json\n${JSON.stringify(list)}\n\`\`\`\nHope that helps.`;

  it("gives toil's own question, with no tool, and returns the answers it checked", async () => {
    const seen: string[] = [];
    const agent = answers((prompt) => {
      seen.push(prompt);
      return fenced(itemsInPrompt(prompt).map((i) => scriptedVerdict(i.id, i.title)));
    });
    const got = await service(execute, agent).ask('team', unsure().slice(0, 4), undefined, signal);
    expect(seen[0]).toContain('Classify each work item below into one category of the scheme "ktlo-feature"');
    expect(got.by).toBe('Scripted');
    expect(got.answers).toHaveLength(4);
    expect(got.answers.every((a) => ['ktlo', 'feature', 'unsure'].includes(a.category))).toBe(true);
  });

  it('refuses an answer with an id that was not asked about, and one with a category the scheme lacks, proposing nothing', async () => {
    const items = unsure().slice(0, 2);
    await expect(service(execute, answers(() => fenced([{ id: 'sample-jira:NOPE-9', category: 'feature', reason: 'x' }]))).ask('team', items, undefined, signal)).rejects.toThrow(/not one of the items/);
    await expect(service(execute, answers(() => fenced([{ id: items[0]!.id, category: 'chore', reason: 'x' }]))).ask('team', items, undefined, signal)).rejects.toThrow(/not a category/);
    await expect(service(execute, answers(() => 'I could not decide.')).ask('team', items, undefined, signal)).rejects.toThrow(/no list/);
  });

  it('says so, plainly, when no agent is set up', async () => {
    await expect(service(execute, null).ask('team', unsure().slice(0, 2), undefined, signal)).rejects.toMatchObject({ status: 404 });
  });

  it('finds a JSON list or object in prose, fenced or bare', () => {
    expect(jsonIn('Sure: [{"id":"a"}] done', '[')).toBe('[{"id":"a"}]');
    expect(jsonIn('```json\n{"a":[1,2]}\n```\n[1]', '{')).toBe('{"a":[1,2]}');
    expect(jsonIn('no json here', '[')).toBeNull();
  });
});

describe('improving the categories', () => {
  it("runs the agent's revision through toil's reader, scores it on held-back corrections, and applies it only as a person's command", async () => {
    const s0 = service(execute);
    const items = standalone().slice(0, 16);
    // Sixteen people's words, each the opposite of what the scheme said, so some are held back and the tune has something to learn from.
    for (const item of items) {
      const v = classify({ scheme: defaultScheme(), items: [item] }).result.verdicts[0]!;
      await s0.correct('team', { item, context: [], to: v.category === 'ktlo' ? 'feature' : 'ktlo', reason: 'People disagree.' });
    }
    const agent = answers((prompt) => {
      if (prompt.startsWith('Sharpen the classification scheme')) {
        const scheme = defaultScheme();
        return JSON.stringify({ ...scheme, guidance: [...scheme.guidance, 'A fix that adds a capability is Feature.'] });
      }
      return JSON.stringify(itemsInPrompt(prompt).map((i) => ({ id: i.id, category: 'feature', reason: 'It adds something.' })));
    });
    const s = service(execute, agent);
    const tuned = await s.tune('team', items, undefined, signal);
    expect(tuned.changes).toEqual(['Adds the guidance: A fix that adds a capability is Feature.']);
    expect(tuned.backtest).toMatchObject({ worse: expect.any(Boolean) });
    expect(tuned.backtest!.heldBack).toBeGreaterThan(0);
    // Nothing was written by asking: the scheme is still the built-in one.
    expect(existsSync(join(home, '.toil', 'classify', 'ktlo-feature.json'))).toBe(false);

    const saved = await s.applyRevision(tuned.id);
    expect(saved).toMatchObject({ revision: 2, kept: 'yours' });
    expect(JSON.parse(readFileSync(join(home, '.toil', 'classify', 'ktlo-feature.json'), 'utf8')).revision).toBe(2);
  });

  it('shows a revision that scores worse as worse', async () => {
    const s0 = service(execute);
    const items = standalone().slice(0, 16);
    const was = new Map(items.map((i) => [i.id, classify({ scheme: defaultScheme(), items: [i] }).result.verdicts[0]!.category!]));
    // People confirm every verdict but one, so the scheme as it is agrees with them; a revision that answers the opposite scores worse.
    for (const [n, item] of items.entries()) await s0.correct('team', { item, context: [], to: n === 0 ? (was.get(item.id) === 'ktlo' ? 'feature' : 'ktlo') : was.get(item.id)!, reason: '' });
    const agent = answers((prompt) => {
      if (prompt.startsWith('Sharpen the classification scheme')) return JSON.stringify({ ...defaultScheme(), guidance: ['Everything is the other thing.'] });
      return JSON.stringify(itemsInPrompt(prompt).map((i) => ({ id: i.id, category: was.get(i.id) === 'ktlo' ? 'feature' : 'ktlo', reason: 'The other one.' })));
    });
    const tuned = await service(execute, agent).tune('team', items, undefined, signal);
    expect(tuned.backtest!.heldBack).toBeGreaterThan(0);
    expect(tuned.backtest!.after.agreement!).toBeLessThan(tuned.backtest!.before.agreement!);
    expect(tuned.backtest!.worse).toBe(true);
  });

  it('refuses a revised scheme toil would not read, proposing nothing', async () => {
    const s0 = service(execute);
    const [item] = standalone();
    await s0.correct('team', { item: item!, context: [], to: 'feature', reason: '' });
    const bad = answers(() => '{"categories": []}');
    await expect(service(execute, bad).tune('team', [item!], undefined, signal)).rejects.toThrow(/can't be used/);
  });
});

describe("saving the editor's scheme", () => {
  it('writes it as the first revision of your own copy, through the file service and the person\'s command', async () => {
    const scheme = { ...defaultScheme(), rules: [{ id: 'epics', when: { title: ['epic'] }, then: 'feature' }] };
    const saved = await service(execute).saveScheme('team', scheme);
    expect(saved).toMatchObject({ revision: 2, kept: 'yours' });
    const kept = JSON.parse(readFileSync(join(home, '.toil', 'classify', 'ktlo-feature.json'), 'utf8'));
    expect(kept.rules).toEqual([{ id: 'epics', when: { title: ['epic'] }, then: 'feature' }]);
  });

  it('refuses a scheme toil would refuse, and one named for another scheme', async () => {
    await expect(service(execute).saveScheme('team', { name: 'ktlo-feature', categories: [] })).rejects.toBeInstanceOf(ClassifyRefusal);
    await expect(service(execute).saveScheme('team', { ...defaultScheme(), name: 'other' })).rejects.toThrow(/uses the scheme ktlo-feature/);
  });
});
