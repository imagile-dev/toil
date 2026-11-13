// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read a tool's JSON result and edit a context by key; its shape is what they check. */
import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { TOIL_PROJECTS } from '../src/fixtures/toil-projects.ts';
import { buildInsights } from '../src/model/work-insights.ts';
import { cacheTools, insightsTools, Ledger, MAX_CELL_ITEMS, type AgentData, type ToolSpec } from '../server/agents/tools.ts';
import { loaded } from './harness.ts';

/**
 * The agent's pivot and its dimension filters, on the sample team (#567): the
 * same pure pivot the screens run, the same categories, ids capped, an unread
 * figure left null, and a bad question answered with what is allowed. The
 * agent counts nothing the screens would count differently.
 */

const file = TOIL_PROJECTS.find((d) => d.name === 'sample-team')!;
const readToilProject = async () => ({ toilProject: file, error: null });
const now = () => FIXTURE_NOW;

async function setup() {
  const { data } = await loaded('sample-team');
  const agent: AgentData = { items: () => data.items, transitions: () => [], changes: () => [], syncedAt: () => FIXTURE_NOW };
  const ledger = new Ledger();
  const tools = [...cacheTools('sample-team', agent, ledger, readToilProject, now), ...insightsTools('sample-team', agent, ledger, readToilProject, now)];
  const run = async (name: string, input: Record<string, unknown>) => (await tools.find((t: ToolSpec) => t.name === name)!.run(input)) as Record<string, any>;
  return { data, ledger, run };
}

describe('insights_pivot', () => {
  it('splits category across release and agrees with the screens, cell for cell', async () => {
    const { data, ledger, run } = await setup();
    const r = await run('insights_pivot', { measure: 'items', split: 'category', across: 'release' });
    expect(r.error).toBeUndefined();
    const screen = buildInsights(data, FIXTURE_NOW).run({ measure: 'items', split: 'category', across: 'release' });
    expect(r.rows.map((x: { key: string }) => x.key)).toEqual(screen.rows.map((x) => x.key));
    expect(r.columns.map((x: { key: string }) => x.key)).toEqual(screen.columns.map((x) => x.key));
    expect(r.values).toEqual(screen.cells.map((row) => row.map((c) => c.value)));
    expect(r.total).toBe(screen.total.value);
    expect(r.scheme.name).toBe('ktlo-feature');
    expect(r.rows.length).toBeGreaterThan(1);
    // Every row and column pair can be cited, and the cells list at most MAX_CELL_ITEMS ids each, beside their count.
    for (const row of r.rows) for (const col of r.columns) expect(ledger.cells.has(`${col.key}/${row.key}`)).toBe(true);
    for (const c of r.cells) {
      expect(c.items.length).toBeLessThanOrEqual(MAX_CELL_ITEMS);
      expect(c.count).toBeGreaterThanOrEqual(c.items.length);
      for (const id of c.items) expect(ledger.ids.has(id)).toBe(true);
    }
    expect(r.cells.some((c: { count: number; items: string[] }) => c.count > MAX_CELL_ITEMS && c.items.length === MAX_CELL_ITEMS)).toBe(true);
  });

  it('returns no item, and never its native payload', async () => {
    const { run } = await setup();
    const text = JSON.stringify(await run('insights_pivot', { measure: 'items', split: 'category' }));
    expect(text).not.toContain('"native"');
    expect(text).not.toContain('"title"');
  });

  it('applies where, shares and top', async () => {
    const { run } = await setup();
    const all = await run('insights_pivot', { measure: 'items', split: 'category' });
    const open = await run('insights_pivot', { measure: 'items', split: 'category', where: ['statusCategory != DONE'], share: true });
    expect(open.total).toBeLessThan(all.total);
    expect(open.shares).toBeDefined();
    const one = await run('insights_pivot', { measure: 'items', split: 'assignee', top: 1 });
    expect(one.rows.length).toBeLessThanOrEqual(3);
  });

  it('leaves a figure nobody read null, not 0', async () => {
    const { run } = await setup();
    const r = await run('insights_pivot', { measure: 'estimate', split: 'release', where: ['type = Epic'] });
    const flat = (r.values as Array<Array<number | null>>).flat();
    expect(r.error).toBeUndefined();
    // Epics carry no estimate: a computed zero would claim someone read them.
    expect(flat.every((v) => v === null || v > 0 || r.coverage.items === 0)).toBe(true);
  });

  it('refuses a bad measure, dimension, filter or day with what is allowed', async () => {
    const { run } = await setup();
    const measure = await run('insights_pivot', { measure: 'velocity' });
    expect(measure.error).toContain('isn\'t a measure');
    expect(measure.measures).toContain('throughput');
    const dimension = await run('insights_pivot', { measure: 'items', split: 'mood' });
    expect(dimension.error).toContain('split');
    expect(dimension.dimensionGrammar).toContain('release');
    expect(dimension.dimensionGrammar).toContain('dim:<name>');
    const where = await run('insights_pivot', { measure: 'items', where: ['nonsense'] });
    expect(where.error).toContain('where');
    expect(where.whereGrammar).toContain('!=');
    expect((await run('insights_pivot', { measure: 'items', from: '2026-13-45' })).error).toContain('isn\'t a day');
    expect((await run('insights_pivot', { measure: 'items', from: '2026-10-10', to: '2026-10-01' })).error).toContain('starts after it ends');
  });

  it('is a read: it has no write field and takes no unknown one', async () => {
    const { data } = await loaded('sample-team');
    const agent: AgentData = { items: () => data.items, transitions: () => [], changes: () => [], syncedAt: () => null };
    const [tool] = insightsTools('sample-team', agent, new Ledger(), readToilProject, now);
    expect(tool!.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool!.inputSchema.properties)).toEqual(['measure', 'split', 'across', 'where', 'from', 'to', 'share', 'top']);
  });
});

describe('owi_query by dimension', () => {
  it('filters by release, component, sprint, team, category, parent and dim, and returns the dimension fields but not native', async () => {
    const { data, run } = await setup();
    const release = await run('owi_query', { release: '2.4', limit: 200 });
    expect(release.total).toBeGreaterThan(10);
    for (const i of release.items) expect(i.releases).toContain('2.4');
    expect(JSON.stringify(release)).not.toContain('"native"');
    const sample = release.items[0];
    expect(Object.keys(sample)).toEqual(expect.arrayContaining(['releases', 'components', 'sprints', 'ancestors']));

    const component = await run('owi_query', { component: 'Search', limit: 200 });
    expect(component.total).toBeGreaterThan(0);
    for (const i of component.items) expect(i.components).toContain('Search');

    const both = await run('owi_query', { release: '2.4', component: 'Search', limit: 200 });
    expect(both.total).toBeLessThan(Math.min(release.total, component.total) + 1);
    expect(both.items.every((i: any) => i.releases.includes('2.4') && i.components.includes('Search'))).toBe(true);

    const team = await run('owi_query', { team: 'Storefront', limit: 200 });
    expect(team.total).toBeGreaterThan(0);

    const category = await run('owi_query', { category: 'KTLO', limit: 200 });
    const feature = await run('owi_query', { category: 'Feature', limit: 200 });
    expect(category.total + feature.total).toBeLessThanOrEqual(data.items.length);
    expect(category.total).toBeGreaterThan(0);

    const epic = data.items.find((i) => data.items.some((c) => c.parent === i.id))!;
    const under = await run('owi_query', { parent: epic.id, limit: 200 });
    expect(under.total).toBeGreaterThan(0);
    expect(under.items.every((i: any) => i.parent === epic.id || i.ancestors.some((a: any) => a.id === epic.id))).toBe(true);

    const customer = await run('owi_query', { dim: 'customer=Acme', limit: 200 });
    expect(customer.error).toBeUndefined();
    expect((await run('owi_query', { dim: 'customer' })).error).toContain('name=value');
  });

  it('says how many items it could not judge, instead of calling them non-matches', async () => {
    const { data, run } = await setup();
    // Two items whose releases were never read: they cannot match a release, and the result says so.
    const items = data.items.map((i, n) => (n < 2 ? { ...i, releases: undefined } : i));
    const agent: AgentData = { items: () => items, transitions: () => [], changes: () => [], syncedAt: () => null };
    const tools = cacheTools('sample-team', agent, new Ledger(), readToilProject, now);
    const r = (await tools.find((t) => t.name === 'owi_query')!.run({ release: '2.4', limit: 200 })) as Record<string, any>;
    expect(r.couldNotJudge).toEqual({ release: 2 });
    expect(r.couldNotJudgeNote).toContain('could not be judged');
    expect(r.items.some((i: any) => i.id === items[0]!.id)).toBe(false);
    // The ordinary filters still work as they did.
    expect((await run('owi_query', { statusCategory: 'DONE', limit: 5 })).returned).toBe(5);
  });

  it('vouches for the ancestors it returns, so an answer may cite them', async () => {
    const { ledger, run } = await setup();
    const r = await run('owi_query', { release: '2.4', limit: 3 });
    for (const i of r.items) for (const a of i.ancestors) expect(ledger.ids.has(a.id)).toBe(true);
  });
});
