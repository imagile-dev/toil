import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { owiMapCommand } from '../src/areas/util/owi.js';
import { checkAgainstSchema } from '../src/areas/util/owi/run.js';
import { Verifier } from '../src/areas/util/kit/verify.js';
import { commandName } from '../src/core/command.js';
import type { Envelope, Warning } from '../src/core/envelope.js';
import { ToilError } from '../src/core/errors.js';
import { documentsFrom, fieldOverrides, mapOwi, OVERRIDABLE, OWI_COMMANDS, OWI_SOURCES, OWI_VERSION, parseOwiInput, type WorkItem } from '../src/core/owi/index.js';
import { sprintOf } from '../src/core/owi/jira.js';
import { execute } from '../src/core/run.js';
import { argvFor } from '../src/program.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { loadFixtures, setUp } from './harness/fixtures.js';
import { sprintEnvelopes, sprintJsonl } from './fixtures/owi/sprint.js';

/**
 * The Open Work Item spec (docs/owi/) held to the mappers, and the mappers to
 * every area's fixtures: each item- or history-shaped command's examples run
 * through the real CLI against its area's fixture, and what they print is
 * mapped and validated against docs/owi/schema.json. Then the sprint fixture
 * the Toil UI preview reads, mapped and pinned as a file, and the edges the
 * spec promises: unknown states, overrides, skipped and refused input, and a
 * self-check that fails a broken item. A standard with no conformance suite
 * is a suggestion with a version number.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const map = async (input: Record<string, unknown>, files: Record<string, string> = {}) => {
  const envelope = (await execute(owiMapCommand as never, input, testContext({ files }).context)) as Envelope;
  return { envelope, data: envelope.data as Data, warnings: (envelope.meta.warnings ?? []) as Warning[] };
};
const json = (value: unknown) => JSON.stringify(value);
const env = (command: string, data: unknown, connection = command.split(' ')[0]!, inputs: Record<string, string> = {}) => ({
  ok: true,
  data,
  error: null,
  meta: { command, durationMs: 1, version: '0.0.0-test', context: { connection: { value: connection, source: 'default' }, inputs: Object.fromEntries(Object.entries(inputs).map(([k, value]) => [k, { value, source: 'input' }])) } },
});
const byId = (items: WorkItem[], id: string) => items.find((i) => i.id === id)!;

const schema = JSON.parse(readFileSync(new URL('../docs/owi/schema.json', import.meta.url), 'utf8')) as Data;
const spec = readFileSync(new URL('../docs/owi/spec.md', import.meta.url), 'utf8');

describe('the OWI spec and schema', () => {
  it('declare the same version as the mappers', () => {
    expect(schema.$defs.WorkItem.properties.owi.const).toBe(OWI_VERSION);
    expect(spec).toContain(`version ${OWI_VERSION}`);
  });

  it('documents every WorkItem field, every overridable field and every mapped command', () => {
    for (const field of Object.keys(schema.$defs.WorkItem.properties)) expect(spec, field).toContain(`\`${field}\``);
    for (const field of OVERRIDABLE) expect(spec, field).toContain(`\`${field}\``);
    for (const commands of Object.values(OWI_COMMANDS)) for (const c of [...commands.items, ...commands.history, ...commands.context]) expect(spec, c).toContain(`\`${c}\``);
  });

  it('maps every WorkItem field to OSLC CM, or says why not', () => {
    const oslc = spec.slice(spec.indexOf('## OSLC'));
    for (const field of Object.keys(schema.$defs.WorkItem.properties)) expect(oslc, field).toContain(`\`${field}\``);
    for (const flag of ['oslc_cm:closed', 'oslc_cm:inProgress', 'oslc_cm:fixed', 'oslc_cm:approved', 'oslc_cm:reviewed', 'oslc_cm:verified']) expect(oslc).toContain(flag);
  });
});

describe("every area's fixtures map to valid OWI", async () => {
  const fixtures = await loadFixtures();
  await setUp(fixtures);
  // A history command's output names no item; these keys are the ones its examples read.
  const KEYS: Record<string, string> = { 'jira get-changelog': 'PROJ-123', 'jira-cloud get-changelog': 'PROJ-123', 'github issue-events': '9' };
  const families = new Set<string>();
  for (const fixture of fixtures.filter((f) => OWI_SOURCES[f.area])) {
    const known = OWI_COMMANDS[fixture.area]!;
    const mapped = fixture.commands.filter((def) => [...known.items, ...known.history, ...known.context].includes(commandName(def)));
    it(`${fixture.area}: every mapped command has examples`, () => {
      expect(mapped.map(commandName).sort()).toEqual([...known.items, ...known.history, ...known.context].sort());
    });
    for (const def of mapped) {
      families.add(fixture.area);
      it.each(def.examples.map((example, i) => [i, example] as const))(`${commandName(def)} example %i`, async (_i, example) => {
        const cli = testContext({ config: fixture.config, routes: fixture.routes, files: fixture.files });
        const run = await runCli(argvFor(def, example, def.path, fixture.commands), { commands: fixture.commands, context: cli.context });
        expect(run.envelope?.ok, run.stdout).toBe(true);
        const name = commandName(def);
        const input = KEYS[name] ? { key: KEYS[name], history: run.envelope } : run.envelope;
        const { data, envelope } = await map({ text: json(input) });
        expect(envelope.ok, json(envelope.error)).toBe(true);
        expect(data.verified.passed, json(data.verified)).toBe(true);
        expect(data.skipped).toEqual([]);
        if (known.items.includes(name)) expect(data.count).toBeGreaterThan(0);
        if (known.history.includes(name) && Array.isArray(run.envelope!.data) && run.envelope!.data.length > 0) expect(data.histories.length + data.items.length).toBeGreaterThan(0);
        for (const item of data.items as WorkItem[]) {
          expect(item.id.startsWith(`${fixture.area}:`)).toBe(true);
          expect(item.source.command).toBe(name);
        }
      });
    }
  }

  // Azure DevOps Services (#222) sends the work item shape `ado` does; it maps once it is a line in OWI_SOURCES.
  it.skip('ado-cloud (#222): its fixtures map through the ado mapper once it is registered in OWI_SOURCES', () => {
    expect(OWI_SOURCES['ado-cloud']?.family).toBe('ado');
  });
});

describe('the sprint fixture (test/fixtures/owi/)', async () => {
  const { data, warnings } = await map({ file: 'owi/sprint-42.jsonl' }, { 'owi/sprint-42.jsonl': sprintJsonl });
  const items = data.items as WorkItem[];

  it('maps all twenty items, every one valid, with nothing skipped', () => {
    expect(data.count).toBe(20);
    expect(data.verified.passed).toBe(true);
    expect(data.verified.checks.find((c: Data) => c.check === 'items.schema')).toMatchObject({ status: 'passed', checked: 20, failed: 0 });
    expect(data.skipped).toEqual([]);
    expect(data.histories).toEqual([]);
    expect(items.filter((i) => i.source.area === 'jira')).toHaveLength(8);
    expect(items.filter((i) => i.source.area === 'ado')).toHaveLength(7);
    expect(items.filter((i) => i.source.area === 'github')).toHaveLength(5);
    expect(items.every((i) => i.statusCategory !== 'UNKNOWN')).toBe(true);
    expect(warnings.map((w) => w.code)).toEqual(['OWI_UNMAPPED', 'INPUT_INCOMPLETE'].filter((c) => warnings.some((w) => w.code === c)));
  });

  it('holds a blocked chain in Jira and in Azure DevOps', () => {
    expect(byId(items, 'corp-jira:PAY-101').links).toContainEqual({ type: 'blocks', direction: 'outward', target: 'corp-jira:PAY-102', name: 'blocks' });
    expect(byId(items, 'corp-jira:PAY-102').links).toContainEqual({ type: 'blocks', direction: 'outward', target: 'corp-jira:PAY-103', name: 'blocks' });
    expect(byId(items, 'corp-jira:PAY-103').links).toContainEqual({ type: 'blocks', direction: 'inward', target: 'corp-jira:PAY-102', name: 'is blocked by' });
    expect(byId(items, 'corp-ado:2302').links).toContainEqual({ type: 'blocks', direction: 'outward', target: 'corp-ado:2303', name: 'Successor' });
    expect(byId(items, 'corp-ado:2303').links).toContainEqual({ type: 'blocks', direction: 'inward', target: 'corp-ado:2302', name: 'Predecessor' });
  });

  it('shows scope added mid-sprint and work carried over, from the histories', () => {
    const start = Date.parse('2026-10-05T09:00:00.000Z');
    const added = (id: string) => byId(items, id).history!.iterations.find((c) => c.to.some((n) => n.endsWith('Sprint 42')) && !c.from.some((n) => n.endsWith('Sprint 42')));
    expect(Date.parse(added('corp-jira:PAY-107')!.at)).toBeGreaterThan(start);
    expect(Date.parse(added('corp-ado:2306')!.at)).toBeGreaterThan(start);
    expect(added('corp-jira:PAY-104')!.from).toEqual(['Sprint 41']);
    expect(added('corp-ado:2304')!.from).toEqual(['Payments\\Sprint 41']);
    expect(byId(items, 'github:imagile/payments-web#43').native['github projects list-items']).toMatchObject({ createdAt: '2026-10-07T09:00:00Z' });
  });

  it('maps people, estimates, iterations, hierarchy and transitions from each source', () => {
    const pay101 = byId(items, 'corp-jira:PAY-101');
    expect(pay101).toMatchObject({ type: 'STORY', status: 'In Progress', statusCategory: 'IN_PROGRESS', parent: 'corp-jira:PAY-100', children: ['corp-jira:PAY-106'], estimate: { value: 5, unit: 'points', field: 'Story Points' } });
    expect(pay101.iteration).toEqual({ id: '42', name: 'Sprint 42', path: null, start: '2026-10-05T09:00:00.000Z', end: '2026-10-16T17:00:00.000Z', state: 'current' });
    expect(pay101.url).toBe('https://jira.imagile.dev/browse/PAY-101');
    expect(byId(items, 'corp-jira:PAY-105').history!.transitions.map((t) => [t.toCategory, t.to])).toEqual([['IN_PROGRESS', 'In Progress'], ['IN_PROGRESS', 'In Review'], ['DONE', 'Done']]);
    expect(byId(items, 'corp-jira:PAY-107').estimate).toBeNull();
    expect(byId(items, 'corp-ado:2305')).toMatchObject({ type: 'TASK', statusCategory: 'DONE', parent: 'corp-ado:2302', estimate: { value: 4, unit: 'hours', field: 'Microsoft.VSTS.Scheduling.OriginalEstimate' } });
    expect(byId(items, 'corp-ado:2307')).toMatchObject({ statusCategory: 'DONE', resolution: 'Removed from the backlog' });
    expect(byId(items, 'corp-ado:2302').iteration).toMatchObject({ name: 'Sprint 42', path: 'Payments\\Sprint 42', start: '2026-10-05T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z' });
    expect(byId(items, 'corp-ado:2301')).toMatchObject({ type: 'OTHER', typeName: 'Feature', children: ['corp-ado:2302', 'corp-ado:2303'] });
    const gh41 = byId(items, 'github:imagile/payments-web#41');
    expect(gh41).toMatchObject({ status: 'In Progress', statusCategory: 'IN_PROGRESS', children: ['github:imagile/payments-web#42'], estimate: { value: 5, unit: 'points', field: 'Estimate' }, iteration: { name: 'Sprint 42', start: '2026-10-05T00:00:00.000Z', end: '2026-10-17T00:00:00.000Z' } });
    expect(byId(items, 'github:imagile/payments-web#42').parent).toBe('github:imagile/payments-web#41');
    expect(byId(items, 'github:imagile/payments-web#44')).toMatchObject({ statusCategory: 'DONE', resolution: 'completed', history: { transitions: [{ from: 'open', to: 'closed', toCategory: 'DONE' }] } });
    expect(byId(items, 'github:imagile/payments-web#45').unmapped.map((u) => u.field)).toEqual(['estimate']);
  });

  it('is the committed fixture the preview reads', async () => {
    await expect(`${JSON.stringify({ owi: data.owi, count: data.count, items: data.items }, null, 2)}\n`).toMatchFileSnapshot('./fixtures/owi/sprint-42.owi.json');
  });

  it('reads the same input as one JSON array', async () => {
    const again = await map({ text: json(sprintEnvelopes) });
    expect(again.data.items).toEqual(data.items);
  });
});

describe('mapping rules', () => {
  const jiraIssue = (fields: Record<string, unknown>, key = 'PAY-1') => ({ key, id: '1', self: 'https://jira.imagile.dev/rest/api/2/issue/1', fields: { summary: 'S', issuetype: { name: 'Story' }, ...fields } });

  it('maps a status with no category to UNKNOWN, warns once, and lists it', async () => {
    const text = json(env('jira search', { issues: [jiraIssue({ status: { name: 'Waiting on Legal' } }), jiraIssue({ status: { name: 'Waiting on Legal' } }, 'PAY-2')] }));
    const { data, warnings } = await map({ text });
    expect(data.items.map((i: WorkItem) => i.statusCategory)).toEqual(['UNKNOWN', 'UNKNOWN']);
    expect(warnings.filter((w) => w.code === 'OWI_UNKNOWN_STATE')).toHaveLength(1);
    expect(data.items[0].unmapped).toContainEqual({ field: 'statusCategory', reason: '"Waiting on Legal" has no category: the status came without its statusCategory' });
    expect(data.verified.passed).toBe(true);
  });

  it('maps an Azure DevOps custom state to UNKNOWN, naming the command that shows its category', async () => {
    const { data } = await map({ text: json(env('ado work get', { id: 5, fields: { 'System.Title': 'T', 'System.State': 'Ready for QA', 'System.WorkItemType': 'Bug' } })) });
    expect(data.items[0]).toMatchObject({ statusCategory: 'UNKNOWN', type: 'BUG' });
    expect(data.items[0].unmapped.find((u: Data) => u.field === 'statusCategory').reason).toContain('ado work list-states');
  });

  it('points estimate at a team field with fields, keeping the field it came from', async () => {
    const issue = jiraIssue({ customfield_10234: 13, 'Story Points': 2 });
    const { data } = await map({ text: json(env('jira get-issue', issue)), field: ['estimate=customfield_10234', 'estimateUnit=days'] });
    expect(data.items[0].estimate).toEqual({ value: 13, unit: 'days', field: 'customfield_10234' });
    const ado = await map({ file: 'b.json', field: ['estimate=Custom.TeamPoints'] }, { 'b.json': json(env('ado work get-batch', { value: [{ id: 7, fields: { 'System.Title': 'T', 'System.State': 'New', 'Custom.TeamPoints': 8 } }] })) });
    expect(ado.data.items[0].estimate).toEqual({ value: 8, unit: 'points', field: 'Custom.TeamPoints' });
  });

  it("reads Jira's original estimate in seconds as hours, and finds Story Points by an expanded name", async () => {
    const hours = await map({ text: json(env('jira get-issue', jiraIssue({ timeoriginalestimate: 27000 }))) });
    expect(hours.data.items[0].estimate).toEqual({ value: 7.5, unit: 'hours', field: 'timeoriginalestimate' });
    const named = await map({ text: json(env('jira get-issue', { ...jiraIssue({ customfield_10002: 3 }), names: { customfield_10002: 'Story Points' } })) });
    expect(named.data.items[0].estimate).toEqual({ value: 3, unit: 'points', field: 'customfield_10002' });
    const none = await map({ text: json(env('jira get-issue', jiraIssue({}))) });
    expect(none.data.items[0].estimate).toBeNull();
    expect(none.data.items[0].unmapped.map((u: Data) => u.field)).toContain('estimate');
  });

  it("reads Data Center's sprint strings and Cloud's sprint objects alike", () => {
    expect(sprintOf('com.atlassian.greenhopper.service.sprint.Sprint@1a[id=7,rapidViewId=2,state=FUTURE,name=Sprint 7, the long one,startDate=<null>,endDate=<null>,completeDate=<null>,sequence=7]')).toEqual({ id: '7', name: 'Sprint 7, the long one', path: null, start: null, end: null, state: 'future' });
    expect(sprintOf({ id: 8, name: 'Sprint 8', state: 'active', startDate: '2026-10-05T09:00:00.000Z', endDate: '2026-10-16T17:00:00.000Z' })).toMatchObject({ id: '8', state: 'current', start: '2026-10-05T09:00:00.000Z' });
    expect(sprintOf('not a sprint')).toBeUndefined();
  });

  it('refuses an override OWI has no field for, or a unit it has no word for', () => {
    expect(() => fieldOverrides(['storyPoints=customfield_1'])).toThrow(ToilError);
    expect(() => fieldOverrides(['estimateUnit=weeks'])).toThrow(/points, hours or days/);
    expect(() => fieldOverrides(['estimate'])).toThrow(/isn't a field override/);
    expect(fieldOverrides({ estimate: 'customfield_10234', estimateUnit: 'points' })).toEqual({ estimate: 'customfield_10234', estimateUnit: 'points' });
  });

  it('refuses output OWI has no mapping for, and data with no command', async () => {
    const other = await map({ text: json(env('bitbucket list-prs', [])) });
    expect(other.envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(other.envelope.error!.fix).toContain('jira search');
    const bare = await map({ text: json([{ number: 1 }]) });
    expect(bare.envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(bare.envelope.error!.fix).toContain('--command');
  });

  it('skips, with a reason and a warning, a failed call and a WIQL result of ids alone', async () => {
    const failed = { ok: false, data: null, error: { code: 'AUTH', message: 'no' }, meta: { command: 'jira search', durationMs: 1, version: 'x' } };
    const ids = env('ado work search', { workItems: [{ id: 1 }] });
    const { data, warnings } = await map({ text: [json(failed), json(ids)].join('\n') });
    expect(data.count).toBe(0);
    expect(data.skipped).toEqual([
      { at: 'document 1', command: 'jira search', reason: 'the call failed (AUTH), so there is nothing to map' },
      { at: 'document 2', command: 'ado work search', reason: 'it returns work item ids only: fetch their fields with ado work get-batch and map that' },
    ]);
    expect(warnings.filter((w) => w.code === 'OWI_SKIPPED')).toHaveLength(2);
    expect(data.verified.checks.find((c: Data) => c.check === 'items.schema').status).toBe('unchecked');
  });

  it('maps bare data with --command, and keeps a keyless history whose item is elsewhere', async () => {
    const { data } = await map({ text: json([jiraIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } })]), command: 'jira search' });
    expect(data.items).toHaveLength(0);
    const issue = await map({ text: json({ issues: [jiraIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } })] }), command: 'jira search' });
    expect(issue.data.items[0]).toMatchObject({ id: 'jira:PAY-1', statusCategory: 'DONE' });
    const history = await map({ text: json(env('jira get-changelog', [{ id: '1', created: '2026-10-06T09:00:00.000+0000', items: [{ field: 'status', fromString: 'To Do', toString: 'Done' }] }])), key: 'PAY-9' });
    expect(history.data.histories).toEqual([{ id: 'jira:PAY-9', history: { transitions: [{ from: 'To Do', to: 'Done', fromCategory: 'UNKNOWN', toCategory: 'UNKNOWN', at: '2026-10-06T09:00:00.000Z', by: null }], iterations: [] } }]);
    expect(history.data.verified.passed).toBe(true);
    const keyless = await map({ text: json(env('github issue-events', [])) });
    expect(keyless.data.skipped[0].reason).toContain('--key');
  });

  it('leaves pull requests out, with a warning', async () => {
    const { data, warnings } = await map({ text: json(env('github list-issues', [{ number: 1, title: 'PR', html_url: 'https://ghe.imagile.dev/imagile/x/pull/1', pull_request: {} }])) });
    expect(data.count).toBe(0);
    expect(warnings.map((w) => w.code)).toContain('OWI_PULL_REQUESTS_SKIPPED');
  });

  it('parses one envelope, an array of envelopes, and JSON Lines', () => {
    const a = env('jira search', { issues: [] });
    expect(parseOwiInput(json(a))).toHaveLength(1);
    expect(parseOwiInput(json([a, a]))).toHaveLength(2);
    expect(parseOwiInput(`${json(a)}\n\n${json(a)}\n`)).toHaveLength(2);
    expect(() => parseOwiInput('{"ok":')).toThrow(/isn't JSON/);
    expect(() => parseOwiInput('  ')).toThrow(/empty/);
    expect(documentsFrom([a]).documents[0]).toMatchObject({ area: 'jira', connection: 'jira' });
    expect(documentsFrom([env('jira-cloud search', {})]).documents[0]!.area).toBe('jira-cloud');
  });
});

describe('the self-check', () => {
  it('fails an item that breaks the schema, by pointer, under OWI_SCHEMA_INVALID', async () => {
    const { data } = await map({ text: json(env('jira get-issue', { key: 'PAY-1', self: 'https://jira.imagile.dev/rest/api/2/issue/1', fields: { summary: 'S' } })) });
    const broken = { ...data.items[0], statusCategory: 'SOMEDAY', created: '2026-10-06' } as WorkItem;
    const warnings: Warning[] = [];
    const v = new Verifier((w) => warnings.push(w));
    await checkAgainstSchema(v, [data.items[0], broken], []);
    const verified = v.done();
    expect(verified.passed).toBe(false);
    expect(verified.checks[0]).toMatchObject({ check: 'items.schema', status: 'failed', checked: 2, failed: 1 });
    expect(verified.checks[0]!.failures![0]!.at).toBe('items[1] (jira:PAY-1)');
    expect(warnings.map((w) => w.code)).toEqual(['OWI_SCHEMA_INVALID']);
  });

  it('the mapper itself never produces a key the schema refuses', () => {
    const result = mapOwi(documentsFrom([env('github get-issue', { number: 3, title: 'T', state: 'open', html_url: 'https://ghe.imagile.dev/imagile/x/issues/3' }, 'my-ghe')]).documents);
    expect(result.items[0]!.id).toMatch(new RegExp(schema.$defs.OwiId.pattern));
  });
});

describe('@imagile-dev/toil/api', () => {
  it('exports mapOwi, owiVersion and owiSchema, mapping envelopes with a dossier-style fields object', async () => {
    const api = await import('../src/api.js');
    expect(api.owiVersion).toBe(OWI_VERSION);
    expect(api.owiSchema).toEqual(schema);
    const result = api.mapOwi(sprintEnvelopes, { fields: { estimateUnit: 'points' } });
    expect(result.items).toHaveLength(20);
    expect(api.mapOwi(sprintJsonl).items).toHaveLength(20);
    expect(api.mapOwi({ issues: [] }, { command: 'jira search' }).items).toEqual([]);
    expect(() => api.mapOwi(sprintEnvelopes, { fields: { storyPoints: 'x' } })).toThrow(ToilError);
  });
});
