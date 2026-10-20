import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { BOARD, DEFAULT_TEAM, ME, ORG_URL, backlogItems, backlogs, board, boards, bugStates, config as fixtureConfig, files as fixtureFiles, routes as fixtureRoutes, sprintItems, teamIterations, workItem } from '../../../test/fixtures/ado-cloud.fixture.js';
import { commandName, type AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { referenceName } from './fields.js';
import { commands } from './index.js';

/**
 * Request building and response reshaping for Azure DevOps Services,
 * command by command: the exact request toil sends and what it makes of the
 * answer, checked against Microsoft's REST API 7.1 reference
 * (learn.microsoft.com/en-us/rest/api/azure/devops/…?view=azure-devops-rest-7.1),
 * since no live organization has been consulted. The parity suite proves
 * both front doors agree; this proves they agree with the reference, which
 * remains the only stakeholder to have attended every meeting.
 */

const BASIC = `Basic ${Buffer.from(':test-pat').toString('base64')}`;
const GET_HEADERS = { authorization: BASIC, accept: 'application/json' };
const P = `${ORG_URL}/Imagile`;
const R = `${P}/_apis/git/repositories/imagile-api`;
const at = { project: 'Imagile' };
const inRepo = { ...at, repo: 'imagile-api' };
const write = { allowWrite: true };

const cmd = (name: string): AnyCommand => {
  const found = commands.find((d) => commandName(d) === `ado-cloud ${name}`);
  if (!found) throw new Error(`no ado-cloud ${name}`);
  return found;
};

async function run(name: string, input: Record<string, unknown>, extra: Route[] = [], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes: [...extra, ...fixtureRoutes], files: fixtureFiles });
  const envelope = await execute(cmd(name), input, t.context);
  return { envelope, calls: t.http.calls, data: envelope.data as never };
}

const body = (call: { body?: string | undefined }) => JSON.parse(call.body!) as unknown;
const fail = (status: number, json: unknown): Route[] => [{ path: /.*/, respond: { status, json } }, { method: 'POST', path: /.*/, respond: { status, json } }];

describe('credentials and the organization URL', () => {
  it('the PAT goes as Basic auth with an empty user name, and api-version=7.1 rides on every request', async () => {
    const { calls } = await run('work-item get', { id: 42 });
    expect(calls).toEqual([{ method: 'GET', url: `${ORG_URL}/_apis/wit/workitems/42?api-version=7.1&%24expand=all`, headers: GET_HEADERS, body: undefined }]);
  });

  it('a 401 is AUTH, and the fix says to make an organization-scoped token and that global ones are retired', async () => {
    const { envelope } = await run('work-item get', { id: 42 }, fail(401, { message: 'TF400813: The user is not authorized to access this resource.' }));
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining('TF400813') });
    expect(envelope.error?.fix).toContain('organization-scoped personal access token');
    expect(envelope.error?.fix).toContain('stop working on December 1, 2026');
    expect(envelope.error?.fix).toContain('TOIL_ADO_CLOUD_PAT');
  });

  it("a 404 is NOT_FOUND and a 400 keeps its HTTP code, each with Azure DevOps's own message", async () => {
    const missing = await run('work-item get', { id: 9 }, fail(404, { $id: '1', message: 'TF401232: Work item 9 does not exist.', typeKey: 'WorkItemUnauthorizedAccessException' }));
    expect(missing.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('TF401232') });
    const bad = await run('work-item search', { ...at, wiql: 'SELECT nonsense' }, fail(400, { message: 'TF51006: The query statement is missing a FROM clause.' }));
    expect(bad.envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('TF51006') });
  });

  it('an organization URL without exactly one organization is CONFIG_INVALID before anything is sent, on both hosts', async () => {
    for (const baseUrl of ['https://dev.azure.com', 'https://dev.azure.com/imagile/Imagile', 'https://imagile.visualstudio.com/Imagile', 'https://imagile.visualstudio.com/DefaultCollection/Imagile']) {
      const { envelope, calls } = await run('work-item get', { id: 42 }, [], { 'ado-cloud': { baseUrl, pat: 'test-pat' } });
      expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('https://dev.azure.com/<organization>') });
      expect(calls).toHaveLength(0);
    }
  });

  it('a visualstudio.com organization URL is accepted bare or with the legacy /DefaultCollection, in any case', async () => {
    for (const baseUrl of ['https://imagile.visualstudio.com', 'https://imagile.visualstudio.com/DefaultCollection', 'https://imagile.visualstudio.com/defaultcollection/']) {
      const prefix = baseUrl.replace(/\/$/, '');
      const routes: Route[] = [{ url: `${prefix}/_apis/wit/workitems/42?api-version=7.1&%24expand=all`, respond: { json: workItem(42) } }];
      const { envelope } = await run('work-item get', { id: 42 }, routes, { 'ado-cloud': { baseUrl, pat: 'test-pat' } });
      expect(envelope.ok, baseUrl).toBe(true);
    }
  });

  it("an organization URL with a trailing slash, as Azure Pipelines' System.CollectionUri has, is accepted", async () => {
    const routes: Route[] = [{ url: 'https://dev.azure.com/imagile/_apis/wit/workitems/42?api-version=7.1&%24expand=all', respond: { json: workItem(42) } }];
    const { envelope } = await run('work-item get', { id: 42 }, routes, { 'ado-cloud': { baseUrl: 'https://dev.azure.com/imagile/', pat: 'test-pat' } });
    expect(envelope.ok).toBe(true);
  });

  it('a project-scoped command without a project says so, naming --project', async () => {
    const { envelope, calls } = await run('work-item search', { wiql: 'SELECT [System.Id] FROM WorkItems' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('No Azure DevOps project given') });
    expect(calls).toHaveLength(0);
  });
});

describe('work items', () => {
  it('create sends a JSON Patch to the $Type path in the project, resolving aliases', async () => {
    const { calls } = await run('work-item create', { ...at, type: 'User Story', title: 'T', priority: 2, field: ['story points=3', 'MyOrg.Team=Core', 'effortdays=4'], ...write }, [], {
      'ado-cloud': { ...fixtureConfig['ado-cloud'], fieldAliases: { effortdays: 'MyOrg.EffortDays' } },
    });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${P}/_apis/wit/workitems/%24User%20Story?api-version=7.1`, headers: { 'content-type': 'application/json-patch+json' } });
    expect(body(calls[0]!)).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'T' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: '3' },
      { op: 'add', path: '/fields/MyOrg.Team', value: 'Core' },
      { op: 'add', path: '/fields/MyOrg.EffortDays', value: '4' },
    ]);
  });

  it('update with --rev tests the revision first, at the organization level', async () => {
    const { calls } = await run('work-item update', { id: 42, field: ['state=Active'], rev: 3, ...write });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${ORG_URL}/_apis/wit/workitems/42?api-version=7.1` });
    expect(body(calls[0]!)).toEqual([
      { op: 'test', path: '/rev', value: 3 },
      { op: 'add', path: '/fields/System.State', value: 'Active' },
    ]);
  });

  it('a --field without = is refused before anything is sent', async () => {
    const { envelope, calls } = await run('work-item update', { id: 42, field: ['state'], ...write });
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('search ANDs --updated-since onto the WHERE clause and turns on time precision', async () => {
    const { calls } = await run('work-item search', { ...at, wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'A' OR [System.State] = 'B' ORDER BY [System.Id]", updatedSince: '2026-10-01' });
    expect(calls[0]!.url).toBe(`${P}/_apis/wit/wiql?api-version=7.1&timePrecision=true`);
    expect(body(calls[0]!)).toEqual({ query: "SELECT [System.Id] FROM WorkItems WHERE ([System.State] = 'A' OR [System.State] = 'B') AND [System.ChangedDate] >= '2026-10-01T00:00:00.000Z' ORDER BY [System.Id]" });
  });

  it('search with --limit asks for one more than the page and hands back an offset cursor', async () => {
    const first = await run('work-item search', { ...at, wiql: 'SELECT [System.Id] FROM WorkItems', limit: 1 });
    expect(first.calls[0]!.url).toBe(`${P}/_apis/wit/wiql?api-version=7.1&%24top=2`);
    expect(first.data).toMatchObject({ workItems: [{ id: 42 }] });
    expect(first.envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
    const second = await run('work-item search', { ...at, wiql: 'SELECT [System.Id] FROM WorkItems', limit: 1, cursor: '1' });
    expect(second.data).toMatchObject({ workItems: [{ id: 7 }] });
    expect(second.envelope.meta.page).toEqual({ nextCursor: null, limit: 1 });
  });

  it('search refuses a zoneless --updated-since and a link query', async () => {
    const zoneless = await run('work-item search', { ...at, wiql: 'SELECT [System.Id] FROM WorkItems', updatedSince: '2026-10-01T09:00:00' });
    expect(zoneless.envelope.error?.code).toBe('INVALID_INPUT');
    const link = await run('work-item search', { ...at, wiql: 'SELECT [System.Id] FROM WorkItemLinks', limit: 5 });
    expect(link.envelope.error?.code).toBe('INVALID_INPUT');
    expect(zoneless.calls.length + link.calls.length).toBe(0);
  });

  it('revisions page by $top and $skip at the organization level until a short page', async () => {
    const { calls, data } = await run('work-item history', { id: 42 });
    expect(calls.map((c) => c.url)).toEqual([`${ORG_URL}/_apis/wit/workItems/42/revisions?api-version=7.1&%24top=100&%24skip=0`]);
    expect((data as Array<{ rev: number }>).map((r) => r.rev)).toEqual([1, 2]);
  });

  it('get-many posts 200 ids a request, keeps the order asked, and lists what is missing', async () => {
    const ids = [404, ...Array.from({ length: 200 }, (_, i) => i + 1)];
    const { calls, data, envelope } = await run('work-item get-many', { id: ids, fields: 'System.Title,System.State' });
    expect(calls.map((c) => c.url)).toEqual([`${ORG_URL}/_apis/wit/workitemsbatch?api-version=7.1`, `${ORG_URL}/_apis/wit/workitemsbatch?api-version=7.1`]);
    expect(body(calls[0]!)).toMatchObject({ fields: ['System.Title', 'System.State'], errorPolicy: 'omit' });
    expect((body(calls[0]!) as { ids: number[] }).ids).toHaveLength(200);
    expect(data).toMatchObject({ count: 200, missing: [404] });
    expect((data as { value: Array<{ id: number }> }).value[0]!.id).toBe(1);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'ADO_CLOUD_WORK_ITEMS_MISSING' })]);
  });

  it('get-many over 1,000 ids is refused before anything is sent', async () => {
    const { envelope, calls } = await run('work-item get-many', { id: Array.from({ length: 1001 }, (_, i) => i + 1) });
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('comments follows the body continuation token, with the preview api-version, and pages through meta.page', async () => {
    const all = await run('work-item comments', { ...at, id: 42 });
    expect(all.calls.map((c) => c.url)).toEqual([
      `${P}/_apis/wit/workItems/42/comments?api-version=7.1-preview.4&%24top=200`,
      `${P}/_apis/wit/workItems/42/comments?api-version=7.1-preview.4&%24top=200&continuationToken=abc12345`,
    ]);
    expect((all.data as Array<{ id: number }>).map((c) => c.id)).toEqual([3, 2, 1]);
    const first = await run('work-item comments', { ...at, id: 42, limit: 2 });
    expect(first.calls).toHaveLength(1);
    const second = await run('work-item comments', { ...at, id: 42, limit: 2, cursor: first.envelope.meta.page!.nextCursor! });
    expect((second.data as Array<{ id: number }>).map((c) => c.id)).toEqual([1]);
    expect(second.envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });
  });

  it('add-comment posts the text with the preview api-version', async () => {
    const { calls } = await run('work-item comment', { ...at, id: 42, body: 'Hi', ...write });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${P}/_apis/wit/workItems/42/comments?api-version=7.1-preview.4` });
    expect(body(calls[0]!)).toEqual({ text: 'Hi' });
  });

  it('iterations reads the classification tree to depth 10 by default', async () => {
    const { calls } = await run('work-item iterations', at);
    expect(calls[0]!.url).toBe(`${P}/_apis/wit/classificationnodes/iterations?api-version=7.1&%24depth=10`);
  });

  it('field names resolve through the connection, then the built-in aliases, ignoring case, spaces and dashes', () => {
    expect(referenceName('Story-Points')).toBe('Microsoft.VSTS.Scheduling.StoryPoints');
    expect(referenceName('Effort Days', { effortdays: 'MyOrg.EffortDays' })).toBe('MyOrg.EffortDays');
    expect(referenceName('state', { State: 'MyOrg.State' })).toBe('MyOrg.State');
    expect(referenceName('Custom.Thing')).toBe('Custom.Thing');
  });
});

describe('projects and repositories', () => {
  it('project list follows the x-ms-continuationtoken header', async () => {
    const { calls, data } = await run('project list', {});
    expect(calls.map((c) => c.url)).toEqual([`${ORG_URL}/_apis/projects?api-version=7.1`, `${ORG_URL}/_apis/projects?api-version=7.1&continuationToken=abc12345`]);
    expect((data as Array<{ name: string }>).map((p) => p.name)).toEqual(['Imagile', 'Imagile Ops']);
  });

  it('--cursor without --limit is refused', async () => {
    const { envelope } = await run('project list', { cursor: 'abc' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--cursor needs --limit' });
  });

  it('repo get reads the repository under the project', async () => {
    const { calls } = await run('repo get', inRepo);
    expect(calls[0]!.url).toBe(`${R}?api-version=7.1`);
  });
});

describe('pull requests', () => {
  it('pr list pages by $skip with the search criteria, dates as zoned instants', async () => {
    const { calls } = await run('pr list', { ...inRepo, state: 'all', creator: 'abc', createdAfter: '2026-09-01' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/imagile/Imagile/_apis/git/repositories/imagile-api/pullrequests');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'api-version': '7.1',
      'searchCriteria.status': 'all',
      'searchCriteria.creatorId': 'abc',
      'searchCriteria.queryTimeRangeType': 'created',
      'searchCriteria.minTime': '2026-09-01T00:00:00.000Z',
      $top: '100',
      $skip: '0',
    });
  });

  it('pr create adds refs/heads/ to a branch name only, and leaves out what was not given', async () => {
    const { calls } = await run('pr create', { ...inRepo, title: 'T', source: 'feature/x', target: 'refs/heads/develop', ...write });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${R}/pullrequests?api-version=7.1` });
    expect(body(calls[0]!)).toEqual({ title: 'T', sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/develop' });
  });

  it('pr update sends only the fields given', async () => {
    const { calls } = await run('pr update', { ...inRepo, id: 42, target: 'release/1.2', draft: false, ...write });
    expect(body(calls[0]!)).toEqual({ targetRefName: 'refs/heads/release/1.2', isDraft: false });
  });

  it('pr merge reads the source commit, then asks for completion with the strategy', async () => {
    const { calls } = await run('pr merge', { ...inRepo, id: 42, strategy: 'squash', deleteSource: true, message: 'm', ...write });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${R}/pullrequests/42?api-version=7.1`, `PATCH ${R}/pullrequests/42?api-version=7.1`]);
    expect(body(calls[1]!)).toEqual({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'abc12345def67890abc12345def67890abc12345' },
      completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true, mergeCommitMessage: 'm' },
    });
  });

  it('pr merge on a pull request with no source commit yet is INVALID_INPUT, and nothing is patched', async () => {
    const routes: Route[] = [{ path: '/imagile/Imagile/_apis/git/repositories/imagile-api/pullrequests/42', respond: { json: { pullRequestId: 42, status: 'active', mergeStatus: 'queued' } } }];
    const { envelope, calls } = await run('pr merge', { ...inRepo, id: 42, ...write }, routes);
    expect(envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Pull request 42 has no source commit to complete yet.',
      fix: 'Check data.mergeStatus with ado-cloud pr get, and retry once the server has merged the source branch.',
    });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('an unknown merge strategy is refused before anything is sent', async () => {
    const { envelope, calls } = await run('pr merge', { ...inRepo, id: 42, strategy: 'fastForward', ...write });
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it("a vote is cast as the token's own identity, read from connection data", async () => {
    const { calls, data } = await run('pr wait-for-author', { ...inRepo, id: 42, ...write });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${ORG_URL}/_apis/connectionData?api-version=7.1-preview.1`, `PUT ${R}/pullrequests/42/reviewers/${ME}?api-version=7.1`]);
    expect(body(calls[1]!)).toEqual({ vote: -5 });
    expect(data).toMatchObject({ vote: -5 });
  });

  it('a write without --allow-write is refused before anything is sent', async () => {
    const { envelope, calls } = await run('pr abandon', { ...inRepo, id: 42 });
    expect(envelope.error?.code).toBe('WRITE_DISABLED');
    expect(calls).toHaveLength(0);
  });
});

describe('pull request comments', () => {
  it('comments flattens live threads oldest first and leaves out system comments unless asked', async () => {
    const plain = await run('pr comments', { ...inRepo, id: 42 });
    expect((plain.data as Array<{ id: number; threadId: number; threadContext: unknown }>).map((c) => [c.id, c.threadId])).toEqual([
      [3, 8],
      [1, 7],
    ]);
    const all = await run('pr comments', { ...inRepo, id: 42, includeSystem: true });
    expect((all.data as Array<{ id: number }>).map((c) => c.id)).toEqual([3, 5, 1]);
    const inline = await run('pr comments', { ...inRepo, id: 42, inlineOnly: true });
    expect((inline.data as Array<{ threadContext: { filePath: string } }>).map((c) => c.threadContext.filePath)).toEqual(['/src/app.ts']);
  });

  it('threads returns the threads as the server sent them, deleted ones left out', async () => {
    const { data } = await run('pr threads', { ...inRepo, id: 42 });
    expect((data as Array<{ id: number }>).map((t) => t.id)).toEqual([7, 8, 10]);
  });

  it('add-inline-comment roots the path and anchors on the side asked', async () => {
    const { calls } = await run('pr comment-inline', { ...inRepo, id: 42, file: 'src/app.ts', line: 3, body: 'Why?', lineType: 'left', ...write });
    expect(body(calls[0]!)).toEqual({
      comments: [{ parentCommentId: 0, content: 'Why?', commentType: 'text' }],
      status: 'active',
      threadContext: { filePath: '/src/app.ts', leftFileStart: { line: 3, offset: 1 }, leftFileEnd: { line: 3, offset: 1 } },
    });
  });

  it('reply-comment replies under the thread and resolve-comment sets fixed by default', async () => {
    const reply = await run('pr reply', { ...inRepo, id: 42, threadId: 7, body: 'Done', ...write });
    expect(reply.calls[0]).toMatchObject({ method: 'POST', url: `${R}/pullrequests/42/threads/7/comments?api-version=7.1` });
    expect(body(reply.calls[0]!)).toEqual({ parentCommentId: 1, content: 'Done', commentType: 'text' });
    const resolve = await run('pr resolve', { ...inRepo, id: 42, threadId: 7, ...write });
    expect(body(resolve.calls[0]!)).toEqual({ status: 'fixed' });
  });
});

describe('work item type states', () => {
  it('states reads the type under the project and returns its states, categories included', async () => {
    const { calls, data, envelope } = await run('work-item states', { ...at, type: 'Bug' });
    expect(calls).toEqual([{ method: 'GET', url: `${P}/_apis/wit/workitemtypes/Bug/states?api-version=7.1`, headers: GET_HEADERS, body: undefined }]);
    expect(data).toEqual(bugStates);
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('a type the project has no states for comes back empty with a warning, since the server sends no 404', async () => {
    const { calls, data, envelope } = await run('work-item states', { ...at, type: 'User Story' });
    expect(calls[0]!.url).toBe(`${P}/_apis/wit/workitemtypes/User%20Story/states?api-version=7.1`);
    expect(data).toEqual([]);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'ADO_CLOUD_TYPE_UNKNOWN', message: expect.stringContaining('"User Story"') })]);
  });
});

describe('team settings: sprints, backlogs and boards', () => {
  const T = `${P}/${DEFAULT_TEAM}`;
  const named = { ...at, team: 'Imagile Team' };

  it("without --team, reads the project's default team first and puts its id in the path", async () => {
    const { calls, data } = await run('sprint list', at);
    expect(calls).toEqual([
      { method: 'GET', url: `${ORG_URL}/_apis/projects/Imagile?api-version=7.1`, headers: GET_HEADERS, body: undefined },
      { method: 'GET', url: `${T}/_apis/work/teamsettings/iterations?api-version=7.1`, headers: GET_HEADERS, body: undefined },
    ]);
    expect(data).toEqual(teamIterations);
  });

  it('with --team, sends the name in the path and reads nothing else', async () => {
    const { calls, envelope } = await run('sprint list', named);
    expect(calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/teamsettings/iterations?api-version=7.1`]);
    expect(envelope.meta.context?.inputs?.team).toEqual({ value: 'Imagile Team', source: 'input' });
  });

  it('the team comes from the connection when the call names none', async () => {
    const { calls } = await run('board list', at, [], { 'ado-cloud': { ...fixtureConfig['ado-cloud'], team: 'Imagile Team' } });
    expect(calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/boards?api-version=7.1`]);
  });

  it('a project with no default team is NOT_FOUND, naming --team', async () => {
    const { envelope, calls } = await run('backlog list', at, [{ path: '/imagile/_apis/projects/Imagile', respond: { json: { id: 'abc12345-0000-0000-0000-000000000000', name: 'Imagile' } } }]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', fix: expect.stringContaining('--team') });
    expect(calls).toHaveLength(1);
  });

  it('sprint list --state keeps the time frames named, from the team settings, even for sprints with no dates', async () => {
    const current = await run('sprint list', { ...named, state: 'current' });
    expect(current.data).toEqual([teamIterations[0]]);
    expect((current.data as Array<{ name: string }>)[0]!.name).toBe('Sprint 1');
    const ahead = await run('sprint list', { ...named, state: 'Future, current' });
    expect((ahead.data as Array<{ name: string }>).map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 3']);
    expect((await run('sprint list', { ...named, state: 'past' })).data).toEqual([]);
  });

  it('an unknown sprint state is refused before anything is sent', async () => {
    const { envelope, calls } = await run('sprint list', { ...named, state: 'active' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Unknown sprint state: active', fix: expect.stringContaining('past, current and/or future') });
    expect(calls).toEqual([]);
  });

  it("sprint items reads the sprint's work items under the team, as the server sends them", async () => {
    const { calls, data } = await run('sprint items', { ...named, id: teamIterations[0]!.id });
    expect(calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/teamsettings/iterations/${teamIterations[0]!.id}/workitems?api-version=7.1`]);
    expect(data).toEqual(sprintItems);
  });

  it('backlog list returns the levels, and backlog items one level in backlog order', async () => {
    const list = await run('backlog list', named);
    expect(list.calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/backlogs?api-version=7.1`]);
    expect(list.data).toEqual(backlogs);
    const items = await run('backlog items', { ...named, id: 'Microsoft.RequirementCategory' });
    expect(items.calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/backlogs/Microsoft.RequirementCategory/workItems?api-version=7.1`]);
    expect(items.data).toEqual(backlogItems);
  });

  it('board list returns the boards, and board get one by name or id with the state under each column', async () => {
    const list = await run('board list', named);
    expect(list.calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/boards?api-version=7.1`]);
    expect(list.data).toEqual(boards);
    const byName = await run('board get', { ...named, id: 'Backlog items' });
    expect(byName.calls.map((c) => c.url)).toEqual([`${P}/Imagile%20Team/_apis/work/boards/Backlog%20items?api-version=7.1`]);
    expect(byName.data).toEqual(board);
    const columns = (byName.data as typeof board).columns.map((c) => [c.name, c.stateMappings.Bug]);
    expect(columns).toEqual([['To Do', 'New'], ['Doing', 'Approved'], ['Testing', 'Committed'], ['Done', 'Done']]);
    const byId = await run('board get', { ...at, id: BOARD });
    expect(byId.calls.map((c) => c.url)).toEqual([`${ORG_URL}/_apis/projects/Imagile?api-version=7.1`, `${T}/_apis/work/boards/${BOARD}?api-version=7.1`]);
  });

  it("a team or board the server doesn't know is NOT_FOUND with its own message", async () => {
    const { envelope } = await run('board get', { ...named, id: 'Nope' }, fail(404, { message: 'TF401501: The board does not exist.', typeKey: 'BoardDoesNotExistException' }));
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('TF401501') });
  });

  it('every team command needs a project, and says so', async () => {
    const { envelope, calls } = await run('board list', {});
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--project') });
    expect(calls).toEqual([]);
  });
});

describe('api passthrough', () => {
  it('sends the path under the organization URL with the same credential', async () => {
    const { calls, envelope } = await run('api', { method: 'GET', path: '_apis/projects', query: ['api-version=7.1'] });
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${ORG_URL}/_apis/projects?api-version=7.1`, headers: { authorization: BASIC } });
    expect(envelope.meta.response).toMatchObject({ status: 200 });
  });

  it('maps a 401 to AUTH with the same fix as every other command', async () => {
    const { envelope } = await run('api', { method: 'GET', path: '_apis/projects' }, fail(401, { message: 'Unauthorized' }));
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('December 1, 2026') });
  });
});
