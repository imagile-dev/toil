import { describe, expect, it } from 'vitest';
import { checkAgainstSchema } from '../src/areas/util/owi/run.js';
import { Verifier } from '../src/areas/util/kit/verify.js';
import { ToilError } from '../src/core/errors.js';
import { guessOwi, suggest } from '../src/core/field-discovery.js';
import { dimensionMap, documentsFrom, fieldOverrides, mapOwi, OVERRIDABLE, type MapOptions, type WorkItem } from '../src/core/owi/index.js';

/**
 * The fields people split work by (#567, Layer 1): releases, affects,
 * components, area, sprints, dims and ancestors, on each tracker. Every field
 * has two empty states and the suite pins both: a record that never held the
 * field gets no key, and one that held it empty gets [] (null for area).
 * The records are shaped from the vendor's documentation, not captured from a
 * live instance. Filing "none" under "unknown" is how a dashboard lies.
 */

const env = (command: string, data: unknown, connection = command.split(' ')[0]!, inputs: Record<string, string> = {}) => ({
  ok: true,
  data,
  error: null,
  meta: { command, durationMs: 1, version: '0.0.0-test', context: { connection: { value: connection, source: 'default' }, inputs: Object.fromEntries(Object.entries(inputs).map(([k, value]) => [k, { value, source: 'input' }])) } },
});
const run = (values: unknown[], options: MapOptions = {}) => {
  const { documents, skipped } = documentsFrom(values);
  return mapOwi(documents, { ...options, skipped });
};
const ONE = (result: ReturnType<typeof run>) => result.items[0] as WorkItem;

const jiraIssue = (fields: Record<string, unknown>, key = 'PAY-1') => ({ key, self: `https://jira.imagile.dev/rest/api/2/issue/${key.replace(/\D/g, '')}`, fields: { summary: key, ...fields } });
const jira = (fields: Record<string, unknown>, options?: MapOptions) => ONE(run([env('jira issue get', jiraIssue(fields), 'corp-jira')], options));
const adoRecord = (fields: Record<string, unknown>, id = 5, extra: Record<string, unknown> = {}) => ({ id, fields: { 'System.Title': `T${id}`, 'System.State': 'New', 'System.WorkItemType': 'Bug', ...fields }, ...extra });
const ado = (fields: Record<string, unknown>, options?: MapOptions) => ONE(run([env('ado work-item get', adoRecord(fields), 'corp-ado')], options));
const ghIssue = (extra: Record<string, unknown> = {}, number = 3) => ({ number, title: 'T', state: 'open', html_url: `https://ghe.imagile.dev/imagile/x/issues/${number}`, ...extra });
const github = (extra: Record<string, unknown>, options?: MapOptions) => ONE(run([env('github issue get', ghIssue(extra), 'github')], options));

describe('releases, affects and components', () => {
  it('Jira: absent when the record never held the field, [] when it held it empty', () => {
    const none = jira({});
    for (const key of ['releases', 'affects', 'components', 'sprints', 'dims', 'ancestors']) expect(none, key).not.toHaveProperty(key);
    const empty = jira({ fixVersions: [], versions: [], components: [] });
    expect(empty.releases).toEqual([]);
    expect(empty.affects).toEqual([]);
    expect(empty.components).toEqual([]);
    // Each is read on its own: asking for fixVersions says nothing about versions.
    const some = jira({ fixVersions: [{ id: '10001', name: '2.4.0' }] });
    expect(some.releases).toEqual([{ id: '10001', name: '2.4.0', released: null, date: null }]);
    expect(some).not.toHaveProperty('affects');
    expect(some).not.toHaveProperty('components');
  });

  it("Jira: reads a version's id, released flag and release day, and a component's name", () => {
    const item = jira({
      fixVersions: [{ id: '10001', name: '2.4.0', released: true, releaseDate: '2026-10-01' }, { id: '10002', name: '2.5.0', released: false, releaseDate: '2026-12-01T00:00:00.000+0000' }, { name: '2.6.0' }],
      versions: [{ id: '9', name: '2.3.0', released: true }],
      components: [{ id: '1', name: 'Checkout' }, { name: 'Billing' }],
    });
    expect(item.releases).toEqual([
      { id: '10001', name: '2.4.0', released: true, date: '2026-10-01' },
      { id: '10002', name: '2.5.0', released: false, date: '2026-12-01' },
      { id: null, name: '2.6.0', released: null, date: null },
    ]);
    expect(item.affects).toEqual([{ id: '9', name: '2.3.0', released: true, date: null }]);
    expect(item.components).toEqual(['Checkout', 'Billing']);
  });

  it('Jira: a null field is read and empty, and an entry with no name is dropped', () => {
    const item = jira({ fixVersions: null, versions: [{ id: '1' }, 'raw'], components: null });
    expect(item.releases).toEqual([]);
    expect(item.affects).toEqual([{ id: null, name: 'raw', released: null, date: null }]);
    expect(item.components).toEqual([]);
  });

  it("Jira ignores the release and affects pointers, which are Azure DevOps's, and says so", () => {
    const item = jira({ fixVersions: [{ name: '1.0' }], 'Custom.Release': 'x' }, { fields: { release: 'Custom.Release', affects: 'Custom.Affects' } });
    expect(item.releases).toEqual([{ id: null, name: '1.0', released: null, date: null }]);
    expect(item).not.toHaveProperty('affects');
    expect(item.unmapped.find((u) => u.field === 'releases')?.reason).toContain('Jira reads fixVersions, so the pointer was not used');
    expect(item.unmapped.find((u) => u.field === 'affects')?.reason).toContain('Jira reads versions, so the pointer was not used');
  });

  it('GitHub ignores the release and affects pointers too, and says so', () => {
    const item = github({ milestone: { number: 5, title: 'Next', state: 'open' } }, { fields: { release: 'Custom.Release', affects: 'Custom.Affects' } });
    expect(item.releases).toEqual([{ id: '5', name: 'Next', released: false, date: null }]);
    expect(item).not.toHaveProperty('affects');
    expect(item.unmapped.find((u) => u.field === 'releases')?.reason).toContain('the pointer was not used');
    expect(item.unmapped.find((u) => u.field === 'affects')?.reason).toContain('the pointer was not used');
  });

  it('Azure DevOps and GitHub have no components, and GitHub no affects or area', () => {
    expect(ado({})).not.toHaveProperty('components');
    expect(ado({})).not.toHaveProperty('affects');
    const gh = github({ milestone: null });
    for (const key of ['components', 'affects', 'area']) expect(gh, key).not.toHaveProperty(key);
  });

  it('Azure DevOps: releases and affects come only from the fields a toil project names', () => {
    expect(ado({ 'Custom.Release': 'R1' })).not.toHaveProperty('releases');
    const item = ado({ 'Custom.Release': 'R1;R2', 'Custom.Affects': 'R0' }, { fields: fieldOverrides({ release: 'Custom.Release', affects: 'Custom.Affects' }) });
    expect(item.releases).toEqual([{ id: null, name: 'R1;R2', released: null, date: null }]);
    expect(item.affects).toEqual([{ id: null, name: 'R0', released: null, date: null }]);
    expect(item.unmapped.map((u) => u.field)).not.toContain('releases');
  });

  it('Azure DevOps: a named field the record lacks leaves the key out and is listed, since empty fields are left out', () => {
    const item = ado({}, { fields: { release: 'Custom.Release' } });
    expect(item).not.toHaveProperty('releases');
    expect(item).not.toHaveProperty('affects');
    const note = item.unmapped.find((u) => u.field === 'releases');
    expect(note?.reason).toContain("Custom.Release has no value, or the record doesn't have it");
  });

  it('GitHub: a milestone is a release as well as the iteration; none is [], and no key is absent', () => {
    const item = github({ milestone: { number: 4, title: 'Sprint 4', state: 'closed', due_on: '2026-10-20T07:00:00Z' } });
    expect(item.releases).toEqual([{ id: '4', name: 'Sprint 4', released: true, date: '2026-10-20' }]);
    expect(item.iteration).toMatchObject({ id: '4', name: 'Sprint 4', state: 'past' });
    expect(github({ milestone: { number: 5, title: 'Next', state: 'open' } }).releases).toEqual([{ id: '5', name: 'Next', released: false, date: null }]);
    expect(github({ milestone: null }).releases).toEqual([]);
    expect(github({})).not.toHaveProperty('releases');
  });

  it('GitHub: a board-only item never read the milestone, so it has no releases', () => {
    const board = { id: 'PVTI_1', type: 'ISSUE', content: { number: 4, title: 'T', state: 'OPEN', url: 'https://ghe.imagile.dev/imagile/x/issues/4', repository: { nameWithOwner: 'imagile/x' } }, fieldValues: [] };
    const item = ONE(run([env('github project items', [board], 'github', { owner: 'imagile' })]));
    expect(item).not.toHaveProperty('releases');
  });
});

describe('area', () => {
  it('Azure DevOps: the path whole, null when empty, absent when the record has no such field', () => {
    expect(ado({ 'System.AreaPath': 'Imagile\\Payments\\Web' }).area).toEqual({ path: 'Imagile\\Payments\\Web' });
    expect(ado({ 'System.AreaPath': '' }).area).toBeNull();
    expect(ado({ 'System.AreaPath': '   ' }).area).toBeNull();
    expect(ado({})).not.toHaveProperty('area');
  });

  it('Jira and GitHub have none', () => {
    expect(jira({})).not.toHaveProperty('area');
    expect(github({})).not.toHaveProperty('area');
  });
});

describe('sprints', () => {
  const sprint = (id: number, name: string, state: string) => ({ id, name, state, startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-14T00:00:00.000Z' });

  it('Jira: every sprint the field lists, with iteration still the current one; [] for an empty field; absent without the field', () => {
    const item = jira({ Sprint: [sprint(1, 'Sprint 1', 'closed'), sprint(2, 'Sprint 2', 'closed'), sprint(3, 'Sprint 3', 'active')] });
    expect(item.sprints?.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 3']);
    expect(item.iteration?.name).toBe('Sprint 3');
    expect(item.sprints?.[0]).toMatchObject({ id: '1', state: 'past', start: '2026-10-01T00:00:00.000Z' });
    expect(jira({ Sprint: null }).sprints).toEqual([]);
    expect(jira({ Sprint: [] }).sprints).toEqual([]);
    expect(jira({})).not.toHaveProperty('sprints');
  });

  it("Jira: Data Center's sprint strings count too, and a value that is no sprint makes the list unknown", () => {
    const dc = 'com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=7,rapidViewId=1,state=ACTIVE,name=Sprint 7,startDate=2026-10-01T00:00:00.000Z,endDate=2026-10-14T00:00:00.000Z]';
    expect(jira({ Sprint: [dc] }).sprints?.map((s) => s.name)).toEqual(['Sprint 7']);
    const item = jira({ Sprint: [dc, 'not a sprint'] });
    expect(item).not.toHaveProperty('sprints');
    expect(item.iteration?.name).toBe('Sprint 7');
  });

  it('Azure DevOps and GitHub: from the attached history only', () => {
    const adoHistory = [
      { id: 5, rev: 1, fields: { 'System.ChangedDate': '2026-10-01T00:00:00Z', 'System.IterationPath': 'Imagile\\Sprint 1', 'System.State': 'New' } },
      { id: 5, rev: 2, fields: { 'System.ChangedDate': '2026-10-15T00:00:00Z', 'System.IterationPath': 'Imagile\\Sprint 2', 'System.State': 'New' } },
    ];
    const record = adoRecord({ 'System.IterationPath': 'Imagile\\Sprint 2' });
    expect(ONE(run([env('ado work-item get', record, 'corp-ado')]))).not.toHaveProperty('sprints');
    const withHistory = ONE(run([env('ado work-item get', record, 'corp-ado'), env('ado work-item history', adoHistory, 'corp-ado')]));
    expect(withHistory.sprints?.map((s) => s.path)).toEqual(['Imagile\\Sprint 1', 'Imagile\\Sprint 2']);
    expect(withHistory.sprints?.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2']);
    expect(withHistory.iteration?.path).toBe('Imagile\\Sprint 2');

    const timeline = [
      { event: 'milestoned', created_at: '2026-10-01T00:00:00Z', milestone: { title: 'Sprint 1' } },
      { event: 'demilestoned', created_at: '2026-10-15T00:00:00Z', milestone: { title: 'Sprint 1' } },
      { event: 'milestoned', created_at: '2026-10-15T00:00:00Z', milestone: { title: 'Sprint 2' } },
    ];
    const issue = ghIssue({ milestone: { number: 2, title: 'Sprint 2', state: 'open' } });
    expect(ONE(run([env('github issue get', issue, 'github')]))).not.toHaveProperty('sprints');
    const gh = ONE(run([env('github issue get', issue, 'github'), { key: 'imagile/x#3', history: env('github issue history', timeline, 'github') }]));
    expect(gh.sprints?.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2']);
    expect(gh.sprints?.[1]).toMatchObject({ id: '2' });
  });

  it('an item whose history holds no iteration changes and has no iteration has been in no sprint: []', () => {
    const item = ONE(run([env('github issue get', ghIssue({ milestone: null }), 'github'), { key: 'imagile/x#3', history: env('github issue history', [], 'github') }]));
    expect(item.sprints).toEqual([]);
  });

  it('GitHub: iteration set, history has no iteration change: the current milestone is the sprint', () => {
    const issue = ghIssue({ milestone: { number: 2, title: 'Sprint 2', state: 'open' } });
    const item = ONE(run([env('github issue get', issue, 'github'), { key: 'imagile/x#3', history: env('github issue history', [], 'github') }]));
    expect(item.iteration?.name).toBe('Sprint 2');
    expect(item.sprints?.map((s) => s.name)).toEqual(['Sprint 2']);
    expect(item.sprints?.[0]).toMatchObject({ id: '2' });
  });

  it('Azure DevOps: iteration set, history has no iteration change: the current path is the sprint', () => {
    const history = [{ id: 5, rev: 1, fields: { 'System.ChangedDate': '2026-10-01T00:00:00Z', 'System.State': 'New' } }];
    const record = adoRecord({ 'System.IterationPath': 'Imagile\\Sprint 2' });
    const item = ONE(run([env('ado work-item get', record, 'corp-ado'), env('ado work-item history', history, 'corp-ado')]));
    expect(item.iteration?.path).toBe('Imagile\\Sprint 2');
    expect(item.sprints?.map((s) => s.path)).toEqual(['Imagile\\Sprint 2']);
  });

  it("Azure DevOps: the project's root path is not a sprint, in the history or as the current iteration; a GitHub milestone name still is", () => {
    const history = [
      { id: 5, rev: 1, fields: { 'System.ChangedDate': '2026-10-01T00:00:00Z', 'System.IterationPath': 'Payments', 'System.State': 'New' } },
      { id: 5, rev: 2, fields: { 'System.ChangedDate': '2026-10-15T00:00:00Z', 'System.IterationPath': 'Payments\\Sprint 2', 'System.State': 'New' } },
    ];
    const moved = ONE(run([env('ado work-item get', adoRecord({ 'System.IterationPath': 'Payments\\Sprint 2' }), 'corp-ado'), env('ado work-item history', history, 'corp-ado')]));
    expect(moved.sprints?.map((s) => s.path)).toEqual(['Payments\\Sprint 2']);
    const root = ONE(run([env('ado work-item get', adoRecord({ 'System.IterationPath': 'Payments' }), 'corp-ado'), env('ado work-item history', [history[0]], 'corp-ado')]));
    expect(root.sprints).toEqual([]);
    const gh = ONE(run([env('github issue get', ghIssue({ milestone: { number: 2, title: 'Sprint 2', state: 'open' } }), 'github'), { key: 'imagile/x#3', history: env('github issue history', [{ event: 'milestoned', created_at: '2026-10-01T00:00:00Z', milestone: { title: 'Sprint 1' } }], 'github') }]));
    expect(gh.sprints?.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2']);
  });

  it('Jira: a Sprint value that cannot be read leaves sprints out and says so', () => {
    const item = jira({ Sprint: ['garbage'] });
    expect(item).not.toHaveProperty('sprints');
    expect(item.unmapped.find((u) => u.field === 'sprints')?.reason).toContain("isn't a sprint");
    const mixed = jira({ Sprint: [sprint(1, 'Sprint 1', 'active'), 'garbage'] });
    expect(mixed).not.toHaveProperty('sprints');
    expect(mixed.iteration?.name).toBe('Sprint 1');
  });
});

describe('dims', () => {
  const dimensions = { customer: { jira: 'customfield_10500', ado: 'Custom.Customer', github: 'Customer' }, 'risk-level': { jira: 'Risk' } };

  it('Jira: a field the record holds is its values, an empty one is [], a missing one has no key and is listed', () => {
    const held = jira({ customfield_10500: { value: 'Acme' }, Risk: [{ value: 'High' }, { value: 'Low' }, { value: 'High' }] }, { dimensions });
    expect(held.dims).toEqual({ customer: ['Acme'], 'risk-level': ['High', 'Low'] });
    const empty = jira({ customfield_10500: null, Risk: [] }, { dimensions });
    expect(empty.dims).toEqual({ customer: [], 'risk-level': [] });
    const missing = jira({ Risk: [{ value: 'Low' }] }, { dimensions });
    expect(missing.dims).toEqual({ 'risk-level': ['Low'] });
    expect(missing.unmapped.find((u) => u.field === 'dims.customer')?.reason).toContain('no field "customfield_10500"');
  });

  it('Jira: a field named by its registered name is found through the names map', () => {
    const issue = { ...jiraIssue({ customfield_10500: 'Acme' }), names: { customfield_10500: 'Customer' } };
    const item = ONE(run([env('jira issue get', issue, 'corp-jira')], { dimensions: { customer: { jira: 'Customer' } } }));
    expect(item.dims).toEqual({ customer: ['Acme'] });
  });

  it('with no dimension named, or none for the area, there is no dims at all', () => {
    expect(jira({ customfield_10500: 'Acme' })).not.toHaveProperty('dims');
    expect(jira({ customfield_10500: 'Acme' }, { dimensions: { customer: { ado: 'Custom.Customer' } } })).not.toHaveProperty('dims');
    expect(jira({}, { dimensions: {} })).not.toHaveProperty('dims');
  });

  it('Azure DevOps: a held field, and one it left out, which has no key and is listed', () => {
    expect(ado({ 'Custom.Customer': 'Acme' }, { dimensions }).dims).toEqual({ customer: ['Acme'] });
    const empty = ado({}, { dimensions });
    expect(empty).not.toHaveProperty('dims');
    expect(empty.unmapped.find((u) => u.field === 'dims.customer')?.reason).toContain("Custom.Customer has no value, or the record doesn't have it");
  });

  it("GitHub: a board item's single-select, iteration, number; a field the board leaves out has no key and is listed; an issue with no board has none and says why", () => {
    const entry = (values: Array<Record<string, unknown>>) => ({ id: 'PVTI_1', type: 'ISSUE', content: { number: 3, title: 'T', state: 'OPEN', url: 'https://ghe.imagile.dev/imagile/x/issues/3', repository: { nameWithOwner: 'imagile/x' } }, fieldValues: values });
    const onBoard = (values: Array<Record<string, unknown>>) => ONE(run([env('github issue get', ghIssue({ milestone: null }), 'github'), env('github project items', [entry(values)], 'github', { owner: 'imagile' })], { dimensions }));
    expect(onBoard([{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Acme', field: { name: 'Customer' } }]).dims).toEqual({ customer: ['Acme'] });
    expect(onBoard([{ __typename: 'ProjectV2ItemFieldIterationValue', title: 'Q4', field: { name: 'Customer' } }]).dims).toEqual({ customer: ['Q4'] });
    expect(onBoard([{ __typename: 'ProjectV2ItemFieldNumberValue', number: 7, field: { name: 'Customer' } }]).dims).toEqual({ customer: ['7'] });
    const empty = onBoard([]);
    expect(empty).not.toHaveProperty('dims');
    expect(empty.unmapped.some((u) => u.field === 'dims.customer')).toBe(true);
    const noBoard = github({ milestone: null }, { dimensions });
    expect(noBoard).not.toHaveProperty('dims');
    expect(noBoard.unmapped.find((u) => u.field === 'dims.customer')?.reason).toContain('is a project field');
  });

  it('dimensionMap refuses a bad name, a bad shape and an empty field', () => {
    expect(dimensionMap(undefined)).toBeUndefined();
    expect(dimensionMap({ 'product-line': { jira: 'f' } })).toEqual({ 'product-line': { jira: 'f' } });
    expect(dimensionMap({ customer: { jira: '  customfield_1  ' } })).toEqual({ customer: { jira: 'customfield_1' } });
    for (const bad of [[], { Bad: { jira: 'f' } }, { x_y: { jira: 'f' } }, { customer: 'f' }, { customer: { jira: '' } }, { customer: { jira: 7 } }]) {
      expect(() => dimensionMap(bad), JSON.stringify(bad)).toThrow(ToilError);
    }
  });
});

describe('ancestors', () => {
  const issue = (key: string, parent: string | undefined, type = 'Story') => jiraIssue({ issuetype: { name: type }, subtasks: [], ...(parent === undefined ? {} : { parent: { key: parent } }) }, key);
  const chain = (...issues: unknown[]) => run([env('jira issue search', { issues }, 'corp-jira')]).items;
  const byKey = (items: WorkItem[], key: string) => items.find((i) => i.source.key === key)!;

  it("Jira: nearest first up to the top, with the tracker's own type names", () => {
    const items = chain(issue('PAY-1', 'PAY-2', 'Sub-task'), issue('PAY-2', 'PAY-3', 'Story'), issue('PAY-3', 'PAY-4', 'Epic'), issue('PAY-4', 'PAY-5', 'Initiative'), issue('PAY-5', undefined, 'Theme'));
    expect(byKey(items, 'PAY-1').ancestors).toEqual([
      { id: 'corp-jira:PAY-2', type: 'STORY', typeName: 'Story', title: 'PAY-2' },
      { id: 'corp-jira:PAY-3', type: 'EPIC', typeName: 'Epic', title: 'PAY-3' },
      { id: 'corp-jira:PAY-4', type: 'OTHER', typeName: 'Initiative', title: 'PAY-4' },
      { id: 'corp-jira:PAY-5', type: 'OTHER', typeName: 'Theme', title: 'PAY-5' },
    ]);
  });

  it("a parent that isn't in the input ends the chain; a record with no parent gets []; an unread parent gets no key", () => {
    const items = chain(issue('PAY-1', 'PAY-9'), issue('PAY-2', undefined), jiraIssue({ summary: 'narrowed' }, 'PAY-3'));
    expect(byKey(items, 'PAY-1').ancestors).toEqual([]);
    expect(byKey(items, 'PAY-1').parent).toBe('corp-jira:PAY-9');
    expect(byKey(items, 'PAY-2').ancestors).toEqual([]);
    expect(byKey(items, 'PAY-3')).not.toHaveProperty('ancestors');
  });

  it('a cycle ends where it would come back round', () => {
    const items = chain(issue('PAY-1', 'PAY-2'), issue('PAY-2', 'PAY-3'), issue('PAY-3', 'PAY-1'));
    expect(byKey(items, 'PAY-1').ancestors?.map((a) => a.id)).toEqual(['corp-jira:PAY-2', 'corp-jira:PAY-3']);
    expect(chain(issue('PAY-7', 'PAY-7'))[0]!.ancestors).toEqual([]);
  });

  it("Data Center's Epic Link is a parent that was read", () => {
    const items = chain(jiraIssue({ 'Epic Link': 'PAY-2' }, 'PAY-1'), issue('PAY-2', undefined, 'Epic'));
    expect(byKey(items, 'PAY-1').ancestors?.map((a) => a.id)).toEqual(['corp-jira:PAY-2']);
  });

  it('Azure DevOps: the relations make the chain, and a record read without them has none', () => {
    const rel = (id: number) => ({ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `https://dev.azure.com/imagile/_apis/wit/workItems/${id}` });
    const value = [adoRecord({ 'System.WorkItemType': 'Task' }, 1, { relations: [rel(2)] }), adoRecord({ 'System.WorkItemType': 'User Story' }, 2, { relations: [rel(3)] }), adoRecord({ 'System.WorkItemType': 'Feature' }, 3, { relations: [] }), adoRecord({}, 4)];
    const items = run([env('ado work-item get-many', { value }, 'corp-ado')]).items;
    expect(byKey(items, '1').ancestors).toEqual([
      { id: 'corp-ado:2', type: 'STORY', typeName: 'User Story', title: 'T2' },
      { id: 'corp-ado:3', type: 'OTHER', typeName: 'Feature', title: 'T3' },
    ]);
    expect(byKey(items, '3').ancestors).toEqual([]);
    expect(byKey(items, '4')).not.toHaveProperty('ancestors');
  });

  it('GitHub: the sub-issue parent chain, with parent_issue_url the sign it was read', () => {
    const url = (n: number) => `https://ghe.imagile.dev/api/v3/repos/imagile/x/issues/${n}`;
    const list = [ghIssue({ parent_issue_url: url(2), type: { name: 'Task' } }, 1), ghIssue({ parent_issue_url: url(3), type: { name: 'Feature' } }, 2), ghIssue({ parent_issue_url: null, type: { name: 'Epic' } }, 3), ghIssue({}, 4)];
    const items = run([env('github issue list', list, 'github')]).items;
    expect(byKey(items, 'imagile/x#1').ancestors?.map((a) => [a.id, a.typeName])).toEqual([['github:imagile/x#2', 'Feature'], ['github:imagile/x#3', 'Epic']]);
    expect(byKey(items, 'imagile/x#3').ancestors).toEqual([]);
    expect(byKey(items, 'imagile/x#4')).not.toHaveProperty('ancestors');
  });
});

describe('what stays as it was', () => {
  it('adds no unmapped entry for a field nobody asked for, and changes none of the existing fields', () => {
    const base = { status: { name: 'Done', statusCategory: { key: 'done' } } };
    const plain = jira(base);
    const asked = jira({ ...base, fixVersions: [], versions: [], components: [] });
    expect(plain.unmapped.map((u) => u.field)).toEqual(asked.unmapped.map((u) => u.field));
    const rest: Record<string, unknown> = { ...asked };
    for (const key of ['releases', 'affects', 'components', 'native']) delete rest[key];
    const { native, ...expected } = plain;
    void native;
    expect(rest).toEqual(expected);
  });

  it('release and affects are overridable and are not offered to jira field discover as aliases', () => {
    expect(OVERRIDABLE).toContain('release');
    expect(OVERRIDABLE).toContain('affects');
    expect(fieldOverrides({ release: 'Custom.Release' })).toEqual({ release: 'Custom.Release' });
    // A field named "Release" would flatten to the alias `release`, which is an OWI pointer: discovery renames it.
    const suggestions = suggest([{ id: 'customfield_1', name: 'Release' }, { id: 'customfield_2', name: 'Affects' }]);
    expect(suggestions.get('customfield_1')?.alias).toBe('releaseField');
    expect(suggestions.get('customfield_2')?.alias).toBe('affectsField');
    expect(guessOwi('Release', undefined)).toBeUndefined();
  });

  it('every record validates against the schema, with the new fields and without them', async () => {
    const input = [
      env('jira issue get', jiraIssue({ fixVersions: [{ id: '1', name: '1.0', released: true, releaseDate: '2026-10-01' }], versions: [], components: [{ name: 'Checkout' }], Sprint: [], customfield_10500: 'Acme', parent: { key: 'PAY-9' } }), 'corp-jira'),
      env('jira issue get', jiraIssue({}, 'PAY-2'), 'corp-jira'),
      env('ado work-item get', adoRecord({ 'System.AreaPath': 'Imagile\\Web', 'Custom.Customer': 'Acme' }, 5, { relations: [] }), 'corp-ado'),
      env('ado work-item get', adoRecord({}, 6), 'corp-ado'),
      env('github issue get', ghIssue({ milestone: { number: 1, title: 'M', state: 'open', due_on: '2026-10-20T00:00:00Z' }, parent_issue_url: null }), 'github'),
      env('github issue get', ghIssue({}, 4), 'github'),
    ];
    const { items } = run(input, { dimensions: { customer: { jira: 'customfield_10500', ado: 'Custom.Customer' } }, fields: { release: 'Custom.Release' } });
    expect(items).toHaveLength(6);
    const v = new Verifier(() => undefined);
    await checkAgainstSchema(v, items, []);
    const verified = v.done();
    expect(verified.checks[0]).toMatchObject({ check: 'items.schema', status: 'passed', checked: 6 });
    expect(verified.passed).toBe(true);
  });
});
