import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { owiMapCommand } from '../src/areas/util/owi.js';
import { checkAgainstSchema } from '../src/areas/util/owi/run.js';
import { Verifier } from '../src/areas/util/kit/verify.js';
import { areaOf, commandName } from '../src/core/command.js';
import type { Envelope, Warning } from '../src/core/envelope.js';
import { ToilError } from '../src/core/errors.js';
import { documentsFrom, fieldOverrides, mapOwi, OVERRIDABLE, OWI_COMMANDS, OWI_SOURCES, OWI_VERSION, parseOwiInput, type WorkItem } from '../src/core/owi/index.js';
import { sprintOf } from '../src/core/owi/jira.js';
import { execute } from '../src/core/run.js';
import { argvFor } from '../src/program.js';
import { commands as registry } from '../src/registry.js';
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
  const KEYS: Record<string, string> = { 'jira issue history': 'PROJ-123', 'jira-cloud issue history': 'PROJ-123', 'github issue-events': '9' };
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

  it('every area OWI maps has a fixture, so its output is mapped above', () => {
    const withFixture = new Set(fixtures.map((f) => f.area));
    for (const area of Object.keys(OWI_SOURCES)) expect(withFixture.has(area), `${area} is in OWI_SOURCES but has no test/fixtures/${area}.fixture.ts`).toBe(true);
  });
});

/**
 * Work-item areas are marked in one place, OWI_SOURCES (src/core/owi/types.ts),
 * and this keeps the mark honest: an area with issue- or work-item-shaped
 * commands that OWI doesn't map fails here, so a new tracker can't ship without
 * its mapper (the `integrations` skill, **Open Work Items**).
 */
describe('work-item areas are all mapped to OWI', () => {
  /** Command paths that read or write issues, work items or tickets: `get-issue`, `search-issues`, `issue-events`, `issue get`, `work-item get`. */
  const WORK_ITEM = /(^| )((create|get|update|list|search|transition|link)-(issue|issues|ticket|tickets)|issue-events|(issue|work-item|ticket) (get|get-many|history|search|create|update|transition|link))( |$)/;
  /** Areas known to be on their way, by the issue that builds them. Each switches on once the area is registered. */
  const PENDING: Record<string, string> = {};
  const registered = new Set(registry.map((def) => areaOf(def)));
  const workItemAreas = [...new Set(registry.filter((def) => def.area && WORK_ITEM.test(commandName(def))).map((def) => areaOf(def)))].sort();

  it('marks every area that has work-item commands in OWI_SOURCES', () => {
    expect(workItemAreas.filter((area) => !PENDING[area] && !OWI_SOURCES[area])).toEqual([]);
    expect(workItemAreas).toEqual(expect.arrayContaining(['ado', 'ado-cloud', 'github', 'jira', 'jira-cloud']));
  });

  it("marks only areas that exist, and lists each one's mapped commands among its registered ones", () => {
    for (const [area, known] of Object.entries(OWI_COMMANDS)) {
      expect(registered.has(area), `${area} is in OWI_SOURCES but isn't a registered area`).toBe(true);
      const names = new Set(registry.filter((def) => areaOf(def) === area).map(commandName));
      for (const c of [...known.items, ...known.history, ...known.context]) expect(names.has(c), `${c} is mapped but isn't registered`).toBe(true);
    }
  });

  for (const [area, issue] of Object.entries(PENDING)) {
    it.skipIf(!registered.has(area))(`${area} (${issue}) is mapped once it is registered: one line in OWI_SOURCES`, () => {
      expect(OWI_SOURCES[area], `${area} is registered; add it to OWI_SOURCES in src/core/owi/types.ts and drop it from PENDING`).toBeDefined();
    });
  }
});

describe('the sprint fixture (test/fixtures/owi/)', async () => {
  const { envelope, data, warnings } = await map({ file: 'owi/sprint-42.jsonl' }, { 'owi/sprint-42.jsonl': sprintJsonl });
  // A refusal fails here, not at collection, so the rest of the file still reports.
  const items = (data?.items ?? []) as WorkItem[];
  it('maps without an error', () => expect(envelope.error).toBeNull());

  it('maps all twenty-nine items (twenty in Sprint 42), every one valid, with nothing skipped', () => {
    expect(data.count).toBe(29);
    expect(data.verified.passed).toBe(true);
    expect(data.verified.checks.find((c: Data) => c.check === 'items.schema')).toMatchObject({ status: 'passed', checked: 29, failed: 0 });
    expect(data.skipped).toEqual([]);
    expect(data.histories).toEqual([]);
    expect(items.filter((i) => i.source.area === 'jira')).toHaveLength(12);
    expect(items.filter((i) => i.source.area === 'ado')).toHaveLength(10);
    expect(items.filter((i) => i.source.area === 'github')).toHaveLength(7);
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
    const text = json(env('jira issue search', { issues: [jiraIssue({ status: { name: 'Waiting on Legal' } }), jiraIssue({ status: { name: 'Waiting on Legal' } }, 'PAY-2')] }));
    const { data, warnings } = await map({ text });
    expect(data.items.map((i: WorkItem) => i.statusCategory)).toEqual(['UNKNOWN', 'UNKNOWN']);
    expect(warnings.filter((w) => w.code === 'OWI_UNKNOWN_STATE')).toHaveLength(1);
    expect(data.items[0].unmapped).toContainEqual({ field: 'statusCategory', reason: '"Waiting on Legal" has no category: the status came without its statusCategory' });
    expect(data.verified.passed).toBe(true);
  });

  it('maps an Azure DevOps custom state to UNKNOWN, naming the command that shows its category', async () => {
    const { data } = await map({ text: json(env('ado work-item get', { id: 5, fields: { 'System.Title': 'T', 'System.State': 'Ready for QA', 'System.WorkItemType': 'Bug' } })) });
    expect(data.items[0]).toMatchObject({ statusCategory: 'UNKNOWN', type: 'BUG' });
    expect(data.items[0].unmapped.find((u: Data) => u.field === 'statusCategory').reason).toContain('ado work-item states');
  });

  it("maps Scrum's In Progress (Epic, Feature, Task) to IN_PROGRESS, in the item and its history, as a live Scrum organization reports it (#319)", async () => {
    const rev = (rev: number, state: string, at: string) => ({ id: 9, rev, fields: { 'System.State': state, 'System.ChangedDate': at } });
    const input = [
      env('ado-cloud work-item get', { id: 9, fields: { 'System.Title': 'T', 'System.State': 'In Progress', 'System.WorkItemType': 'Task' } }),
      env('ado-cloud work-item history', [rev(1, 'To Do', '2026-10-05T09:00:00Z'), rev(2, 'In Progress', '2026-10-06T09:00:00Z')]),
    ];
    const { data, warnings } = await map({ text: json(input) });
    const item = data.items[0] as WorkItem;
    expect(item).toMatchObject({ status: 'In Progress', statusCategory: 'IN_PROGRESS', type: 'TASK' });
    expect(item.history!.transitions.map((t) => [t.from, t.to, t.toCategory])).toEqual([[null, 'To Do', 'TODO'], ['To Do', 'In Progress', 'IN_PROGRESS']]);
    expect(warnings.filter((w) => w.code === 'OWI_UNKNOWN_STATE')).toEqual([]);
  });

  it('points estimate at a team field with fields, keeping the field it came from', async () => {
    const issue = jiraIssue({ customfield_10234: 13, 'Story Points': 2 });
    const { data } = await map({ text: json(env('jira issue get', issue)), field: ['estimate=customfield_10234', 'estimateUnit=days'] });
    expect(data.items[0].estimate).toEqual({ value: 13, unit: 'days', field: 'customfield_10234' });
    const ado = await map({ file: 'b.json', field: ['estimate=Custom.TeamPoints'] }, { 'b.json': json(env('ado work-item get-many', { value: [{ id: 7, fields: { 'System.Title': 'T', 'System.State': 'New', 'Custom.TeamPoints': 8 } }] })) });
    expect(ado.data.items[0].estimate).toEqual({ value: 8, unit: 'points', field: 'Custom.TeamPoints' });
  });

  it("reads Jira's original estimate in seconds as hours, and finds Story Points by an expanded name", async () => {
    const hours = await map({ text: json(env('jira issue get', jiraIssue({ timeoriginalestimate: 27000 }))) });
    expect(hours.data.items[0].estimate).toEqual({ value: 7.5, unit: 'hours', field: 'timeoriginalestimate' });
    const named = await map({ text: json(env('jira issue get', { ...jiraIssue({ customfield_10002: 3 }), names: { customfield_10002: 'Story Points' } })) });
    expect(named.data.items[0].estimate).toEqual({ value: 3, unit: 'points', field: 'customfield_10002' });
    const none = await map({ text: json(env('jira issue get', jiraIssue({}))) });
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
    expect(other.envelope.error!.fix).toContain('jira issue search');
    const bare = await map({ text: json([{ number: 1 }]) });
    expect(bare.envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(bare.envelope.error!.fix).toContain('--command');
  });

  it('skips, with a reason and a warning, a failed call and a WIQL result of ids alone', async () => {
    const failed = { ok: false, data: null, error: { code: 'AUTH', message: 'no' }, meta: { command: 'jira issue search', durationMs: 1, version: 'x' } };
    const ids = env('ado work-item search', { workItems: [{ id: 1 }] });
    const { data, warnings } = await map({ text: [json(failed), json(ids)].join('\n') });
    expect(data.count).toBe(0);
    expect(data.skipped).toEqual([
      { at: 'document 1', command: 'jira issue search', reason: 'the call failed (AUTH), so there is nothing to map' },
      { at: 'document 2', command: 'ado work-item search', reason: 'it returns work item ids only: fetch their fields with ado work-item get-many and map that' },
    ]);
    expect(warnings.filter((w) => w.code === 'OWI_SKIPPED')).toHaveLength(2);
    expect(data.verified.checks.find((c: Data) => c.check === 'items.schema').status).toBe('unchecked');
  });

  it('maps bare data with --command, and keeps a keyless history whose item is elsewhere', async () => {
    const { data } = await map({ text: json([jiraIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } })]), command: 'jira issue search' });
    expect(data.items).toHaveLength(0);
    const issue = await map({ text: json({ issues: [jiraIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } })] }), command: 'jira issue search' });
    expect(issue.data.items[0]).toMatchObject({ id: 'jira:PAY-1', statusCategory: 'DONE' });
    const history = await map({ text: json(env('jira issue history', [{ id: '1', created: '2026-10-06T09:00:00.000+0000', items: [{ field: 'status', fromString: 'To Do', toString: 'Done' }] }])), key: 'PAY-9' });
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
    const a = env('jira issue search', { issues: [] });
    expect(parseOwiInput(json(a))).toHaveLength(1);
    expect(parseOwiInput(json([a, a]))).toHaveLength(2);
    expect(parseOwiInput(`${json(a)}\n\n${json(a)}\n`)).toHaveLength(2);
    expect(() => parseOwiInput('{"ok":')).toThrow(/isn't JSON/);
    expect(() => parseOwiInput('  ')).toThrow(/empty/);
    expect(documentsFrom([a]).documents[0]).toMatchObject({ area: 'jira', connection: 'jira' });
    expect(documentsFrom([env('jira-cloud issue search', {})]).documents[0]!.area).toBe('jira-cloud');
  });
});

describe('the self-check', () => {
  it('fails an item that breaks the schema, by pointer, under OWI_SCHEMA_INVALID', async () => {
    const { data } = await map({ text: json(env('jira issue get', { key: 'PAY-1', self: 'https://jira.imagile.dev/rest/api/2/issue/1', fields: { summary: 'S' } })) });
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
    expect(result.items).toHaveLength(29);
    expect(api.mapOwi(sprintJsonl).items).toHaveLength(29);
    expect(api.mapOwi({ issues: [] }, { command: 'jira issue search' }).items).toEqual([]);
    expect(() => api.mapOwi(sprintEnvelopes, { fields: { storyPoints: 'x' } })).toThrow(ToilError);
  });
});

describe('review round 1', () => {
  const MISSING = { estimate: 'Nope.Estimate', priority: 'Nope.Priority', type: 'Nope.Type', team: 'Nope.Team', dueDate: 'Nope.Due', iteration: 'Nope.Iteration' };
  const OVERRIDDEN = ['estimate', 'priority', 'type', 'team', 'dueDate', 'iteration'];
  const field = Object.entries(MISSING).map(([k, v]) => `${k}=${v}`);
  const board = (number: number) => ({ id: `PVTI_${number}`, type: 'ISSUE', content: { number, title: 'T', state: 'OPEN', url: `https://ghe.imagile.dev/imagile/x/issues/${number}`, repository: { nameWithOwner: 'imagile/x' } }, fieldValues: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Todo', field: { name: 'Status' } }] });
  const issue = (number: number) => ({ number, title: 'T', state: 'open', html_url: `https://ghe.imagile.dev/imagile/x/issues/${number}`, type: { name: 'Task' } });

  it.each([
    ['jira', [env('jira issue get', { key: 'PAY-1', self: 'https://jira.imagile.dev/rest/api/2/issue/1', fields: { summary: 'S', status: { name: 'Done', statusCategory: { key: 'done' } } } })]],
    ['jira-cloud', [env('jira-cloud issue get', { key: 'PAY-1', self: 'https://jira-cloud.imagile.dev/rest/api/3/issue/1', fields: { summary: 'S' } })]],
    ['ado', [env('ado work-item get', { id: 5, fields: { 'System.Title': 'T', 'System.State': 'New', 'System.WorkItemType': 'Bug', 'System.IterationPath': 'P\\S1' } })]],
    ['github, on a board', [env('github get-issue', issue(3), 'github'), env('github projects list-items', [board(3)], 'github', { owner: 'imagile' })]],
    ['github, a board item alone', [env('github projects list-items', [board(4)], 'github', { owner: 'imagile' })]],
    ['github, with no board', [env('github get-issue', issue(5), 'github')]],
  ])('%s: every override pointed at a missing field is listed in unmapped', async (_name, input) => {
    const { data } = await map({ text: json(input), field });
    expect(data.count).toBe(1);
    const listed = (data.items[0] as WorkItem).unmapped.map((u) => u.field);
    for (const name of OVERRIDDEN) expect(listed, `${name} in ${json(data.items[0].unmapped)}`).toContain(name);
    expect(data.verified.passed).toBe(true);
  });

  it.each([
    ['a Projects date field', { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-10-20', field: { name: 'Due' } }, '2026-10-20', null],
    ['text that is not a date', { __typename: 'ProjectV2ItemFieldTextValue', text: 'next sprint', field: { name: 'Due' } }, null, 'Due holds "next sprint", which isn\'t a date'],
  ])('github: a board dueDate from %s', async (_name, value, dueDate, reason) => {
    const item = { ...board(6), fieldValues: [...board(6).fieldValues, value] };
    const { data } = await map({ text: json(env('github projects list-items', [item], 'github', { owner: 'imagile' })), field: ['dueDate=Due'] });
    expect(data.items[0].dueDate).toBe(dueDate);
    expect((data.items[0] as WorkItem).unmapped.find((u) => u.field === 'dueDate')?.reason ?? null).toBe(reason);
  });

  it("says an Azure DevOps history state is a custom one, not Jira's changelog", async () => {
    const rev = (rev: number, state: string, at: string) => ({ id: 9, rev, fields: { 'System.State': state, 'System.ChangedDate': at } });
    const input = [env('ado work-item get', { id: 9, fields: { 'System.Title': 'T', 'System.State': 'Blocked', 'System.WorkItemType': 'Task' } }), env('ado work-item history', [rev(1, 'New', '2026-10-05T09:00:00Z'), rev(2, 'Blocked', '2026-10-06T09:00:00Z')])];
    const { data } = await map({ text: json(input) });
    const item = data.items[0] as WorkItem;
    expect(item.history!.transitions.map((t) => [t.from, t.to, t.toCategory])).toEqual([[null, 'New', 'TODO'], ['New', 'Blocked', 'UNKNOWN']]);
    const reason = item.unmapped.find((u) => u.field === 'history.transitions')!.reason;
    expect(reason).toContain('ado work-item states');
    expect(reason).not.toContain('Jira');
  });

  it('splits API input with the same predicate as the CLI', async () => {
    const { inputValues } = await import('../src/core/owi/index.js');
    const api = await import('../src/api.js');
    const wrapped = [{ key: 'PAY-104', history: env('jira issue history', []) }, env('jira issue search', { issues: [] })];
    expect(inputValues(wrapped)).toHaveLength(2);
    expect(parseOwiInput(json(wrapped))).toHaveLength(2);
    expect(api.mapOwi(wrapped).histories).toEqual([{ id: 'jira:PAY-104', history: { transitions: [], iterations: [] } }]);
    expect(inputValues([{ number: 1 }])).toEqual([[{ number: 1 }]]);
  });
});
