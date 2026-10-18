import { describe, expect, it } from 'vitest';
import { runCli } from '../../../test/harness/cli.js';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { ADO, ATTACHMENT, COLL, config as fixtureConfig, files as fixtureFiles, ME, PROJ, pr, REPO, routes, workItem, build } from '../../../test/fixtures/ado.fixture.js';
import { commandName, type AnyCommand } from '../../core/command.js';
import type { Context } from '../../core/context.js';
import { execute } from '../../core/run.js';
import { commands } from './index.js';

/**
 * The exact requests toil sends to Azure DevOps Server and what it makes of
 * the answers, command by command. The parity suite proves the CLI and MCP
 * agree; this proves what they agree on is what the canonical implementation
 * sent. Suspected bugs (#69) are pinned here, not fixed, pending a live run,
 * which has been scheduled for the next available maintenance window.
 */

const AUTH = `Basic ${Buffer.from(':test-pat').toString('base64')}`;
const HEADERS = { authorization: AUTH, 'content-type': 'application/json', accept: 'application/json' };
const AT = { collection: 'DefaultCollection', project: 'Imagile' };
const IN = { ...AT, repo: 'imagile-api' };
const W = { ...IN, allowWrite: true };

const cmd = (name: string): AnyCommand => commands.find((d) => commandName(d) === `ado ${name}`)!;

type Settings = Record<string, unknown>;

async function run(name: string, input: Record<string, unknown>, extra: Route[] = [], settings: Settings = {}, more: Partial<Context> = {}, files: Record<string, string | Uint8Array> = fixtureFiles) {
  const t = testContext({ config: { ado: { ...fixtureConfig.ado, ...settings } }, routes: [...extra, ...routes], files });
  Object.assign(t.context, more);
  const envelope = await execute(cmd(name), input, t.context);
  return { envelope, calls: t.http.calls, data: envelope.data as never, files: t.files };
}

const body = (call: { body: string | undefined }) => JSON.parse(call.body!) as unknown;
const remote = (url: string): Partial<Context> => ({ gitRemote: async () => [{ name: 'origin', url }] });

describe('requests', () => {
  it('sends the PAT as Basic with an empty user and JSON headers, even on a GET, keeping a /tfs context path', async () => {
    const { calls, envelope } = await run('work get', { ...AT, id: '42' }, [], { baseUrl: `${ADO}/tfs` }, {}, {});
    expect(envelope.ok).toBe(false);
    expect(calls[0]).toEqual({ method: 'GET', url: `${ADO}/tfs${COLL}/_apis/wit/workitems/42?api-version=7.1&$expand=all`, headers: HEADERS, body: undefined });
  });

  it('a 401 is AUTH, naming where to make a PAT and the SYSTEM_ACCESSTOKEN fallback', async () => {
    const { envelope } = await run('work get', { ...AT, id: '42' }, [{ url: /.*/, respond: { status: 401, json: { message: 'TF400813: not authorized' } } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('User settings → Personal access tokens') });
    expect(envelope.error?.fix).toContain('TOIL_ADO_PAT, or SYSTEM_ACCESSTOKEN');
  });

  it("an older server's out-of-range answer says the server is too old, naming 2022.1, with the code unchanged", async () => {
    const message = 'The requested REST API version of 7.1 is out of range for this server. The latest REST API version this server supports is 6.0.';
    const { envelope } = await run('work get', { ...AT, id: '42' }, [{ url: /.*/, respond: { status: 400, json: { message } } }]);
    expect(envelope.error?.code).toBe('HTTP');
    expect(envelope.error?.message).toBe(`This server is too old for toil, which needs Azure DevOps Server 2022.1 or later (REST API 7.1). The server said: ${message}`);
  });

  it('reads ids with parseInt, as the predecessor did (#69 item 25): 12abc is 12, abc is NaN', async () => {
    expect((await run('work get', { ...AT, id: '12abc' })).calls[0]!.url).toContain('/workitems/12?');
    expect((await run('work get', { ...AT, id: 'abc' })).calls[0]!.url).toContain('/workitems/NaN?');
  });
});

describe('collection, project and repo', () => {
  it('every command needs a collection and a project, list-collections included (#69 item 2)', async () => {
    const none = await run('project list-collections', {});
    expect(none.calls).toEqual([]);
    expect(none.envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Could not determine Azure DevOps collection. Pass --collection, or set collection on the connection.',
      fix: expect.stringContaining('TOIL_ADO_COLLECTION'),
    });
    const noProject = await run('whoami', { collection: 'DefaultCollection' });
    expect(noProject.envelope.error?.message).toBe('Could not determine Azure DevOps project. Pass --project, or set project on the connection.');
    expect((await run('project list-collections', AT)).calls[0]!.url).toBe(`${ADO}/_apis/projectCollections?api-version=7.1`);
  });

  it('an empty --project is still "Could not determine", as before', async () => {
    expect((await run('whoami', { collection: 'DefaultCollection', project: '' })).envelope.error?.message).toMatch(/^Could not determine Azure DevOps project/);
  });

  it('--organization stands in for --collection; --collection wins when both are passed', async () => {
    expect((await run('whoami', { organization: 'Other', project: 'Imagile' }, [{ url: /.*/, respond: { json: {} } }])).calls[0]!.url).toBe(`${ADO}/Other/_apis/connectionData?api-version=7.1-preview.1`);
    expect((await run('whoami', { collection: 'DefaultCollection', organization: 'Other', project: 'Imagile' })).calls[0]!.url).toContain(`${COLL}/_apis/connectionData`);
  });

  it('--organization beats the connection setting', async () => {
    const { calls } = await run('whoami', { organization: 'Other' }, [{ url: /.*/, respond: { json: {} } }], { collection: 'DefaultCollection', project: 'Imagile' });
    expect(calls[0]!.url).toContain('/Other/_apis/connectionData');
  });

  it('come from the connection (defaults.ado) when not passed, and meta.context says so', async () => {
    const { envelope, calls } = await run('repo get', {}, [], { collection: 'DefaultCollection', project: 'Imagile', repo: 'imagile-api' });
    expect(calls[0]!.url).toBe(`${ADO}${REPO}?api-version=7.1`);
    expect(envelope.meta.context?.inputs).toEqual({
      collection: { value: 'DefaultCollection', source: 'connection' },
      project: { value: 'Imagile', source: 'connection' },
      repo: { value: 'imagile-api', source: 'connection' },
    });
  });

  it('come from an origin remote on the connection host, ignoring a /tfs prefix', async () => {
    const { calls, envelope } = await run('repo get', {}, [{ url: /.*/, respond: { json: {} } }], {}, remote(`${ADO}/tfs/Coll/Proj/_git/repo-x`));
    expect(calls[0]!.url).toBe(`${ADO}/Coll/Proj/_apis/git/repositories/repo-x?api-version=7.1`);
    expect(envelope.meta.context?.inputs?.collection).toEqual({ value: 'Coll', source: 'git' });
  });

  it("come from a remote of any name on the connection host when origin is elsewhere, as the predecessor took them", async () => {
    const remotes: Partial<Context> = { gitRemote: async () => [{ name: 'origin', url: 'git@github.com:me/repo-x.git' }, { name: 'upstream', url: `${ADO}/tfs/Coll/Proj/_git/repo-x` }] };
    const { envelope } = await run('repo get', {}, [{ url: /.*/, respond: { json: {} } }], {}, remotes);
    expect(envelope.meta.context?.inputs?.collection).toEqual({ value: 'Coll', source: 'git' });
  });

  it('ignore a remote on another host, and misread an ssh:// remote with no user (#69 item 5)', async () => {
    expect((await run('repo get', {}, [], {}, remote('https://other.example.com/Coll/Proj/_git/repo'))).envelope.error?.message).toMatch(/^Could not determine Azure DevOps collection/);
    expect((await run('repo get', {}, [], {}, remote('ssh://ado.imagile.dev:22/Coll/Proj/_ssh/repo'))).envelope.error?.message).toMatch(/^Could not determine Azure DevOps collection/);
  });

  it('repo commands need a repo, in the predecessor words; repo list and create do not', async () => {
    const { envelope, calls } = await run('repo get-pr', { ...AT, id: '42' });
    expect(calls).toEqual([]);
    expect(envelope.error?.message).toBe('Could not determine Azure DevOps repo. Pass --repo, or run from inside a checked-out ADO repo.');
    expect((await run('repo list', AT)).envelope.ok).toBe(true);
  });

  it('encodes collection, project and repo into paths', async () => {
    const { calls } = await run('repo get', { collection: 'Default Collection', project: 'My Proj', repo: 'a b' }, [{ url: /.*/, respond: { json: {} } }]);
    expect(calls[0]!.url).toBe(`${ADO}/Default%20Collection/My%20Proj/_apis/git/repositories/a%20b?api-version=7.1`);
  });
});

describe('paging', () => {
  it('project list follows x-ms-continuationtoken until it is absent', async () => {
    const { calls, data } = await run('project list', AT);
    expect(calls.map((c) => c.url)).toEqual([`${ADO}${COLL}/_apis/projects?api-version=7.1`, `${ADO}${COLL}/_apis/projects?api-version=7.1&continuationToken=abc12345`]);
    expect((data as Array<{ name: string }>).map((p) => p.name)).toEqual(['Imagile', 'Imagile Ops']);
  });

  it('paged and text calls hand a 429 back at once, with no retry (#69 item 4)', async () => {
    const limited: Route[] = [{ url: /.*/, respond: { status: 429, headers: { 'retry-after': '1' }, json: { message: 'slow down' } } }];
    const listed = await run('project list', AT, limited);
    expect(listed.calls).toHaveLength(1);
    expect(listed.envelope.ok).toBe(false);
    expect((await run('pipeline logs', { ...AT, buildId: '101', logId: '3' }, limited)).calls).toHaveLength(1);
  });

  it('repo list-prs pages by $top=100 and $skip until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => pr(i + 1));
    const paged: Route = { path: `${REPO}/pullrequests`, respond: (r) => ({ json: { value: new URL(r.url).searchParams.get('$skip') === '0' ? full : [pr(101)] } }) };
    const { calls, data } = await run('repo list-prs', IN, [paged]);
    expect(calls.map((c) => new URL(c.url).searchParams.get('$skip'))).toEqual(['0', '100']);
    expect(new URL(calls[0]!.url).searchParams.get('searchCriteria.status')).toBe('active');
    expect((data as unknown[]).length).toBe(101);
  });

  it('repo list-prs sends --creator and --reviewer as identity filters, and dates with a created range (#69 items 6 and 26)', async () => {
    const { calls } = await run('repo list-prs', { ...IN, state: 'all', creator: 'jdoe', reviewer: 'asmith', createdAfter: '2026-09-01' });
    const q = new URL(calls[0]!.url).searchParams;
    expect([q.get('searchCriteria.status'), q.get('searchCriteria.creatorId'), q.get('searchCriteria.reviewerId'), q.get('searchCriteria.queryTimeRangeType'), q.get('searchCriteria.minTime'), q.get('searchCriteria.maxTime')]).toEqual([
      'all',
      'jdoe',
      'asmith',
      'created',
      '2026-09-01T00:00:00.000Z',
      null,
    ]);
    expect((await run('repo list-prs', { ...IN, createdBefore: 'soon' })).envelope.error?.message).toContain('Invalid --created-before value "soon"');
  });

  it('pipeline list-runs is one request with $top=50 by default, sliced to --top', async () => {
    const { calls, data } = await run('pipeline list-runs', { ...AT, top: '1' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get('$top')).toBe('1');
    expect(data).toEqual([build(101)]);
    expect(new URL((await run('pipeline list-runs', AT)).calls[0]!.url).searchParams.get('$top')).toBe('50');
  });

  it('pipeline list-runs --top 0 is falsy and lists every run through continuation tokens (#69 item 28, pinned)', async () => {
    const { calls } = await run('pipeline list-runs', { ...AT, top: '0' });
    expect(calls.map((c) => new URL(c.url).searchParams.has('$top'))).toEqual([false, false]);
    expect(calls[1]!.url).toContain('continuationToken=abc12345');
  });

  it('pipeline list-runs --name looks the pipeline up, ignoring case; --branch goes as typed (#69 item 12)', async () => {
    const { calls } = await run('pipeline list-runs', { ...AT, name: 'IMAGILE-WEB-CI', branch: 'main' });
    const q = new URL(calls.at(-1)!.url).searchParams;
    expect([q.get('definitions'), q.get('branchName')]).toEqual(['6', 'main']);
    expect((await run('pipeline list-runs', { ...AT, name: 'nope' })).envelope.error?.message).toBe("Pipeline \"nope\" not found. Run 'toil ado pipeline list' to see available pipelines.");
    expect((await run('pipeline list-runs', { ...AT, definition: 'x' })).envelope.error?.message).toContain('--definition must be a numeric ID');
    expect((await run('pipeline list-runs', { ...AT, definition: '5', name: 'x' })).envelope.error?.message).toContain('Cannot specify both');
  });
});

describe('work items', () => {
  it('work create sends a JSON Patch with built-in and aliased fields, then nothing else', async () => {
    const { calls, envelope } = await run('work create', { ...W, type: 'User Story', title: 'T', description: '', priority: '2', field: ['Story Points=3', 'MyOrg.Team=Core'] });
    expect(envelope.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ADO}${PROJ}/_apis/wit/workitems/%24User%20Story?api-version=7.1`);
    expect(calls[0]!.headers['content-type']).toBe('application/json-patch+json');
    expect(body(calls[0]!)).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'T' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: '2' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: '3' },
      { op: 'add', path: '/fields/MyOrg.Team', value: 'Core' },
    ]);
  });

  it('work create reads --input-file with @file values; flags win with a warning', async () => {
    const { calls, envelope } = await run('work create', { ...W, inputFile: 'work-item.json', title: 'Flag' });
    expect(calls[0]!.url).toContain('/workitems/%24Task?');
    expect(body(calls[0]!)).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Flag' },
      { op: 'add', path: '/fields/System.Description', value: '<p>Steps</p>' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: 'It works' },
    ]);
    expect(envelope.meta.warnings).toEqual([{ code: 'ADO_INPUT_OVERRIDDEN', message: '--input-file value(s) overridden by CLI flags: title' }]);
  });

  it("work create without a type or title is refused before anything is sent, in the predecessor's words", async () => {
    expect((await run('work create', { ...W, title: 't' })).envelope.error?.message).toBe('--type required (or "type" in --input-file)');
    const { envelope, calls } = await run('work create', { ...W, type: 'Bug' });
    expect(calls).toEqual([]);
    expect(envelope.error?.message).toBe('--title required (or "fields.Title" in --input-file)');
    expect((await run('work create', { ...W, type: 'Bug', title: 't', field: ['=x'] })).envelope.error?.message).toBe('Invalid --field value "=x". Expected format: name=value');
  });

  it('work create --parent links afterwards, to a URL built from baseUrl, and returns the item as created', async () => {
    const { calls, data } = await run('work create', { ...W, type: 'Task', title: 't', parent: '7' }, [], { baseUrl: `${ADO}/` });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH']);
    expect(calls[1]!.url).toBe(`${ADO}${COLL}/_apis/wit/workitems/43?api-version=7.1`);
    expect(body(calls[1]!)).toEqual([{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${ADO}${COLL}/_apis/wit/workitems/7` } }]);
    expect(data).toEqual(workItem(43, { rev: 1 }));
  });

  it('work create --parent that fails to link still succeeds, with only a warning (#69 items 15 and 29, pinned)', async () => {
    const failing: Route = { method: 'PATCH', path: `${COLL}/_apis/wit/workitems/43`, respond: { status: 404, json: { message: 'TF401232: Work item 999 does not exist' } } };
    const { envelope } = await run('work create', { ...W, type: 'Task', title: 't', parent: '999' }, [failing]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual(workItem(43, { rev: 1 }));
    expect(envelope.meta.warnings).toEqual([{ code: 'ADO_PARENT_LINK_FAILED', message: 'Created #43 but failed to link to parent 999: TF401232: Work item 999 does not exist' }]);
  });

  it('work update resolves the built-in aliases with no fieldAliases on the connection', async () => {
    const { calls } = await run('work update', { ...W, id: '42', field: ['Story Points=5', 'title=T'] });
    expect(body(calls[0]!)).toEqual([
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: '5' },
      { op: 'add', path: '/fields/System.Title', value: 'T' },
    ]);
  });

  it("work update resolves names through the connection's fieldAliases over the built-in ones", async () => {
    const { calls } = await run('work update', { ...W, id: '42', field: ['Effort Days=3', 'state=Active', 'Custom.X=1'] }, [], { fieldAliases: { effortdays: 'MyOrg.EffortDays', state: 'MyOrg.State' } });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${ADO}${COLL}/_apis/wit/workitems/42?api-version=7.1` });
    expect(body(calls[0]!)).toEqual([
      { op: 'add', path: '/fields/MyOrg.EffortDays', value: '3' },
      { op: 'add', path: '/fields/MyOrg.State', value: 'Active' },
      { op: 'add', path: '/fields/Custom.X', value: '1' },
    ]);
  });

  it('work link maps the type word to a relation, or sends it as given', async () => {
    const { calls } = await run('work link', { ...W, id: '42', to: '8', type: 'duplicate-of' });
    expect(body(calls[0]!)).toEqual([{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Duplicate-Reverse', url: `${ADO}${COLL}/_apis/wit/workitems/8` } }]);
    expect(body((await run('work link', { ...W, id: '42', to: '8', type: 'Custom.Rel' })).calls[0]!)).toMatchObject([{ value: { rel: 'Custom.Rel' } }]);
  });

  it('work add-tag reads the tags, keeps them, and adds new ones ignoring case', async () => {
    const { calls } = await run('work add-tag', { ...W, id: '42', tags: 'UI; urgent,Backend' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(body(calls[1]!)).toEqual([{ op: 'add', path: '/fields/System.Tags', value: 'ui; backend; urgent' }]);
    expect(body((await run('work remove-tag', { ...W, id: '42', tags: 'UI' })).calls[1]!)).toEqual([{ op: 'add', path: '/fields/System.Tags', value: 'backend' }]);
  });

  it('work search posts the WIQL; list-comments uses 7.1-preview.4 and reads comments', async () => {
    const searched = await run('work search', { ...AT, wiql: 'SELECT [System.Id] FROM WorkItems' });
    expect(searched.calls[0]).toMatchObject({ method: 'POST', url: `${ADO}${PROJ}/_apis/wit/wiql?api-version=7.1` });
    expect(body(searched.calls[0]!)).toEqual({ query: 'SELECT [System.Id] FROM WorkItems' });
    const listed = await run('work list-comments', { ...AT, id: '42' });
    expect(listed.calls[0]!.url).toBe(`${ADO}${PROJ}/_apis/wit/workItems/42/comments?api-version=7.1-preview.4`);
    expect((listed.data as unknown[]).length).toBe(2);
  });
});

describe('attachments', () => {
  it('add-attachment uploads the bytes as octet-stream, then links the returned URL', async () => {
    const { calls, data } = await run('work add-attachment', { ...W, id: '42', file: 'logs/run.txt', comment: 'c' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${ADO}${COLL}/_apis/wit/attachments?fileName=run.txt&api-version=7.1` });
    expect(calls[0]!.headers['content-type']).toBe('application/octet-stream');
    expect(calls[0]!.body).toBe('log line\n');
    expect(body(calls[1]!)).toEqual([{ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: `${ADO}${COLL}/_apis/wit/attachments/${ATTACHMENT}`, attributes: { comment: 'c' } } }]);
    expect(data).toEqual({ id: ATTACHMENT, url: `${ADO}${COLL}/_apis/wit/attachments/${ATTACHMENT}` });
  });

  it('list-attachments shapes AttachedFile relations, the id from the URL', async () => {
    const { data } = await run('work list-attachments', { ...AT, id: '42' });
    expect(data).toEqual([{ id: ATTACHMENT, name: 'screenshot.png', url: `${ADO}${COLL}/_apis/wit/attachments/${ATTACHMENT}`, comment: 'Before', resourceSize: 5, resourceCreatedDate: '2026-09-02T12:00:00Z' }]);
  });

  it('download-attachment saves under .toil, and never overwrites', async () => {
    const first = await run('work download-attachment', { ...AT, id: '42', attachmentId: ATTACHMENT });
    expect(first.calls[1]).toMatchObject({ method: 'GET', url: `${ADO}${COLL}/_apis/wit/attachments/${ATTACHMENT}` });
    expect(first.calls[1]!.headers.accept).toBe('application/octet-stream');
    expect(first.data).toMatchObject({ name: 'screenshot.png', size: 5 });
    expect((first.data as { saved: string }).saved).toMatch(/\.toil\/screenshot\.png$/);
    const again = await run('work download-attachment', { ...AT, id: '42', attachmentId: ATTACHMENT }, [], {}, {}, { ...fixtureFiles, '.toil/screenshot.png': 'old' });
    expect(again.envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('download-attachment never sends the PAT to another host: the URL is re-pointed, with a warning (#69 item 1)', async () => {
    const elsewhere = workItem(42, { relations: [{ rel: 'AttachedFile', url: `https://evil.example.com${COLL}/_apis/wit/attachments/${ATTACHMENT}`, attributes: { name: 'x.txt' } }] });
    const { calls, envelope } = await run('work download-attachment', { ...AT, id: '42', attachmentId: ATTACHMENT }, [{ path: `${COLL}/_apis/wit/workitems/42`, respond: { json: elsewhere } }]);
    expect(calls.every((c) => c.url.startsWith(ADO))).toBe(true);
    expect(envelope.meta.warnings?.[0]?.code).toBe('ADO_ATTACHMENT_HOST');
  });

  it('an unknown attachment id is refused', async () => {
    expect((await run('work download-attachment', { ...AT, id: '42', attachmentId: 'nope' })).envelope.error?.message).toBe('Attachment not found: nope');
  });
});

describe('discovery', () => {
  it('work types asks for each type\'s states', async () => {
    const { calls, data } = await run('work types', AT);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([`${PROJ}/_apis/wit/workitemtypes`, `${PROJ}/_apis/wit/workitemtypes/Bug/states`, `${PROJ}/_apis/wit/workitemtypes/Task/states`]);
    expect(data).toEqual([
      { name: 'Bug', states: ['New', 'Active'], requiredFields: ['System.Title'] },
      { name: 'Task', states: ['New', 'Active'], requiredFields: [] },
    ]);
  });

  it('work fields without --type lists the collection, ignoring the project; --custom-only drops System and VSTS', async () => {
    const { calls, data } = await run('work fields', { ...AT, customOnly: true });
    expect(calls[0]!.url).toBe(`${ADO}${COLL}/_apis/wit/fields?api-version=7.1`);
    expect(data).toEqual([{ referenceName: 'MyOrg.Team', name: 'Team', type: 'string', readOnly: false, picklistId: 'abc12345-0000-0000-0000-000000000005' }]);
  });

  it('work fields --type returns no type or readOnly (#69 item 18, pinned)', async () => {
    const { data } = await run('work fields', { ...AT, type: 'Bug' });
    expect(JSON.parse(JSON.stringify(data))).toEqual([
      { referenceName: 'System.Title', name: 'Title' },
      { referenceName: 'MyOrg.Team', name: 'Team' },
    ]);
  });

  it('work fields and work types take no --save (KF6): it is an unknown input, refused before any request', async () => {
    for (const command of ['work fields', 'work types']) {
      const { envelope, calls } = await run(command, { ...AT, save: true });
      expect(envelope.error?.code, command).toBe('INVALID_INPUT');
      expect(calls, command).toEqual([]);
    }
  });

  it('work schema needs no connection; --example-only returns the example as data', async () => {
    const t = testContext({});
    const envelope = await execute(cmd('work schema'), { exampleOnly: true }, t.context);
    expect(envelope.data).toMatchObject({ type: 'Bug' });
    expect(t.http.calls).toEqual([]);
  });
});

describe('pull requests', () => {
  it('create-pr prefixes refs/heads/, even onto a full ref, and sends reviewers as ids (#69 items 7 and 8, pinned)', async () => {
    const { calls } = await run('repo create-pr', { ...W, title: 't', source: 'refs/heads/feature', reviewers: 'Sam Smith, abc' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${ADO}${REPO}/pullrequests?api-version=7.1` });
    expect(body(calls[0]!)).toEqual({ title: 't', sourceRefName: 'refs/heads/refs/heads/feature', targetRefName: 'refs/heads/main', reviewers: [{ id: 'Sam Smith' }, { id: 'abc' }] });
  });

  it('update-pr treats any --draft but "true" as false, and sends reviewers in the PATCH (#69 item 9)', async () => {
    const { calls } = await run('repo update-pr', { ...W, id: '42', draft: 'yes', reviewers: 'a' });
    expect(body(calls[0]!)).toEqual({ reviewers: [{ id: 'a' }], isDraft: false });
  });

  it('merge-pr reads the PR, then completes it with its last merge source commit, or "" without one', async () => {
    const { calls } = await run('repo merge-pr', { ...W, id: '42' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(body(calls[1]!)).toEqual({ status: 'completed', lastMergeSourceCommit: { commitId: pr(42).lastMergeSourceCommit.commitId }, completionOptions: { mergeStrategy: 'noFastForward', deleteSourceBranch: false } });
    const bare = await run('repo merge-pr', { ...W, id: '42', strategy: 'whatever' }, [{ path: `${REPO}/pullrequests/42`, respond: { json: pr(42, { lastMergeSourceCommit: undefined }) } }]);
    expect(body(bare.calls[1]!)).toMatchObject({ lastMergeSourceCommit: { commitId: '' }, completionOptions: { mergeStrategy: 'whatever' } });
  });

  it('approve reads connectionData for its own id, then PUTs vote 10; unapprove 0; wait-for-author -5', async () => {
    const { calls, data } = await run('repo approve', { ...W, pr: '42' });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`GET ${COLL}/_apis/connectionData`, `PUT ${REPO}/pullrequests/42/reviewers/${ME}`]);
    expect(body(calls[1]!)).toEqual({ vote: 10 });
    expect(data).toMatchObject({ vote: 10 });
    expect(body((await run('repo unapprove', { ...W, pr: '42' })).calls[1]!)).toEqual({ vote: 0 });
    expect(body((await run('repo wait-for-author', { ...W, pr: '42' })).calls[1]!)).toEqual({ vote: -5 });
  });

  it('list-comments flattens live threads oldest first, skipping deleted threads and comments', async () => {
    const { data } = await run('repo list-comments', { ...IN, pr: '42' });
    expect((data as Array<{ id: number; threadId: number; threadContext: unknown }>).map((c) => [c.id, c.threadId, c.threadContext === null])).toEqual([
      [3, 8, false],
      [1, 7, true],
    ]);
    expect(((await run('repo list-comments', { ...IN, pr: '42', inlineOnly: true })).data as unknown[]).length).toBe(1);
  });

  it('add-inline-comment sends the path as given and any side but left as right (#69 item 23)', async () => {
    const { calls } = await run('repo add-inline-comment', { ...W, pr: '42', file: 'src/a.ts', line: '3', body: 'b', lineType: 'LEFT' });
    expect(body(calls[0]!)).toEqual({ comments: [{ content: 'b', commentType: 'text' }], status: 'active', threadContext: { filePath: 'src/a.ts', rightFileStart: { line: 3, offset: 1 }, rightFileEnd: { line: 3, offset: 1 } } });
  });

  it('delete-comment sends DELETE and returns { deleted: true }, and is never an MCP tool', async () => {
    const { calls, data } = await run('repo delete-comment', { ...W, pr: '42', threadId: '7', commentId: '2' });
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `${ADO}${REPO}/pullrequests/42/threads/7/comments/2?api-version=7.1` });
    expect(data).toEqual({ deleted: true });
    expect(cmd('repo delete-comment').mcp).toBe(false);
  });

  it('diff compares the last merge commits; --path keeps one file, adding a leading /', async () => {
    const { calls, data } = await run('repo diff', { ...IN, pr: '42', path: 'src/app.ts' });
    expect(new URL(calls[1]!.url).search).toBe(`?baseVersion=${pr(42).lastMergeTargetCommit.commitId}&baseVersionType=commit&targetVersion=${pr(42).lastMergeSourceCommit.commitId}&targetVersionType=commit&api-version=7.1`);
    expect((data as { changes: unknown[] }).changes).toHaveLength(1);
    const none = await run('repo diff', { ...IN, pr: '42' }, [{ path: `${REPO}/pullrequests/42`, respond: { json: pr(42, { lastMergeTargetCommit: undefined }) } }]);
    expect(none.data).toEqual({ changes: [], aheadCount: 0, behindCount: 0 });
  });

  it('list-files reads the latest iteration', async () => {
    const { calls } = await run('repo list-files', { ...IN, pr: '42' });
    expect(new URL(calls[1]!.url).pathname).toBe(`${REPO}/pullrequests/42/iterations/2/changes`);
  });

  it('list-default-reviewers keeps Required reviewers policies covering this repo or the project', async () => {
    const { data } = await run('repo list-default-reviewers', IN);
    expect((data as Array<{ id: number }>).map((p) => p.id)).toEqual([1]);
  });

  it('list-builds filters by the source branch, missing merge-ref builds (#69 items 11 and 27, pinned)', async () => {
    const { calls } = await run('repo list-builds', { ...IN, pr: '42' });
    expect(new URL(calls[1]!.url).searchParams.get('branchName')).toBe('refs/heads/feature/retries');
  });
});

describe('pipelines', () => {
  it('run normalises a short branch and sends parameters as a JSON string', async () => {
    const { calls } = await run('pipeline run', { ...AT, allowWrite: true, id: '5', branch: 'main', parameter: ['a=1', 'b=x=y'] });
    expect(body(calls[0]!)).toEqual({ definition: { id: 5 }, sourceBranch: 'refs/heads/main', parameters: '{"a":"1","b":"x=y"}' });
    expect((await run('pipeline run', { ...AT, allowWrite: true, id: '5', parameter: ['nope'] })).envelope.error?.message).toBe('Invalid --parameter "nope". Expected format: key=value');
  });

  it('run --wait polls until completed; a result other than succeeded returns the build and exits 1', async () => {
    let n = 0;
    const polled: Route = { path: `${PROJ}/_apis/build/builds/102`, respond: () => ({ json: build(102, n++ === 0 ? { status: 'inProgress', result: undefined } : { result: 'failed' }) }) };
    const t = testContext({ config: fixtureConfig, routes: [polled, ...routes] });
    const result = await runCli(['ado', '--collection', 'DefaultCollection', '--project', 'Imagile', 'pipeline', 'run', '--id', '5', '--wait', '--poll', '1', '--allow-write'], { commands: [cmd('pipeline run')], context: t.context });
    expect(result.envelope?.ok).toBe(true);
    expect(result.envelope?.data).toEqual(build(102, { result: 'failed' }));
    expect(result.envelope?.meta.warnings).toEqual([{ code: 'ADO_BUILD_NOT_SUCCEEDED', message: 'Build #102 finished with result failed.' }]);
    expect(result.exitCode).toBe(1);
  }, 10_000);

  it('run --wait with a bad --poll is refused after queueing, saying the build may run', async () => {
    const { envelope, calls } = await run('pipeline run', { ...AT, allowWrite: true, id: '5', wait: true, poll: '0' });
    expect(calls).toHaveLength(1);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --poll "0". Expected a positive number of seconds.', fix: expect.stringContaining('Build #102 was queued') });
  });

  it('logs lists without --log-id, and returns { log } as text with --log-id', async () => {
    const listed = await run('pipeline logs', { ...AT, id: '101' });
    expect(listed.calls[0]!.url).toBe(`${ADO}${PROJ}/_apis/build/builds/101/logs?api-version=7.1`);
    const one = await run('pipeline logs', { ...AT, buildId: '101', logId: '3' });
    expect(one.calls[0]!.headers.accept).toBe('text/plain');
    expect(one.data).toEqual({ log: expect.stringContaining('Finishing: Build') });
    expect((await run('pipeline logs', AT)).envelope.error?.message).toBe('--build-id is required (build run ID from pipeline list-runs or get-run)');
  });

  it('cancel-run PATCHes status cancelling', async () => {
    const { calls } = await run('pipeline cancel-run', { ...AT, allowWrite: true, id: '101' });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${ADO}${PROJ}/_apis/build/builds/101?api-version=7.1` });
    expect(body(calls[0]!)).toEqual({ status: 'cancelling' });
  });
});
