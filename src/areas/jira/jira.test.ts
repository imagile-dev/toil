import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, issue, JIRA } from '../../../test/fixtures/jira.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { listSprints, setSprint, listBoards } from './agile.js';
import { addAttachment, downloadAttachment } from './attachments.js';
import { multipartFile } from './client.js';
import { addLabel, assign, createIssue, getIssue, linkIssue, logWork, transitionIssue, updateIssue, listComments } from './issues.js';
import { fields, search } from './search.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends (method, URL, headers, body) and what it makes of the
 * answer. The parity suite proves both front doors agree; this proves what
 * they agree on is what Jira Data Center expects. Two signatures on the same
 * wrong form is still the wrong form.
 */

const JSON_HEADERS = { authorization: 'Bearer test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(
  def: AnyCommand,
  input: Record<string, unknown>,
  routes: Route[],
  options: { files?: Record<string, string>; stdin?: string; config?: Record<string, Record<string, unknown>> } = {},
) {
  const t = testContext({ config: options.config ?? fixtureConfig, routes, files: options.files ?? {}, ...(options.stdin !== undefined ? { stdin: options.stdin } : {}) });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls, written: t.files.written };
}

const write = { allowWrite: true };

describe('issues', () => {
  it('get-issue: GETs the issue with the PAT and translates registered custom fields', async () => {
    const { envelope, calls } = await run(getIssue, { key: 'PROJ-123' }, [{ url: `${JIRA}/rest/api/2/issue/PROJ-123`, respond: { json: issue('PROJ-123') } }]);
    expect(calls).toEqual([{ method: 'GET', url: `${JIRA}/rest/api/2/issue/PROJ-123`, headers: JSON_HEADERS, body: undefined }]);
    const data = envelope.data as { fields: Record<string, unknown> };
    expect(data.fields['Story Points']).toBe(5);
    expect(data.fields).not.toHaveProperty('customfield_10016');
  });

  it('get-issue: keeps a base URL context path, and puts the key in the path unencoded, as the contract specifies', async () => {
    const config = { jira: { ...fixtureConfig.jira, baseUrl: `${JIRA}/jira` } };
    const { calls } = await run(getIssue, { key: 'PROJ-1/comment' }, [{ url: /\/jira\/rest\/api\/2\/issue\//, respond: { json: issue('X-1') } }], { config });
    // Suspected bug (#70): the key changes the path. Pinned until a live run decides.
    expect(calls[0]!.url).toBe(`${JIRA}/jira/rest/api/2/issue/PROJ-1/comment`);
  });

  it('get-issue: a 401 is AUTH, with where to make a new token', async () => {
    const { envelope } = await run(getIssue, { key: 'PROJ-1' }, [{ url: /issue/, respond: { status: 401, text: '' } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('Personal Access Tokens') });
    // Named through jiraArea.envName, and still the same words.
    expect(envelope.error?.fix).toContain('then set apiToken (TOIL_JIRA_API_TOKEN for the default connection).');
  });

  it('create-issue: POSTs the Data Center payload, then reads the issue back', async () => {
    const { envelope, calls } = await run(
      createIssue,
      { project: 'PROJ', summary: 'S', description: 'D', priority: 'High', assignee: 'jsmith', labels: 'a, b,', parent: 'PROJ-1', field: ['Story Points=5'], ...write },
      [
        { method: 'POST', url: `${JIRA}/rest/api/2/issue`, respond: { status: 201, json: { id: '1', key: 'PROJ-9' } } },
        { url: `${JIRA}/rest/api/2/issue/PROJ-9`, respond: { json: issue('PROJ-9') } },
      ],
    );
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `${JIRA}/rest/api/2/issue`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        fields: {
          project: { key: 'PROJ' },
          issuetype: { name: 'Task' },
          summary: 'S',
          description: 'D',
          priority: { name: 'High' },
          assignee: { name: 'jsmith' },
          labels: ['a', 'b'],
          parent: { key: 'PROJ-1' },
          customfield_10016: 5,
        },
      }),
    });
    expect(calls[1]!.url).toBe(`${JIRA}/rest/api/2/issue/PROJ-9`);
    expect(envelope.data).toMatchObject({ key: 'PROJ-9' });
  });

  it('create-issue: project, issue type and priority fall back to defaults.jira', async () => {
    const config = { jira: { ...fixtureConfig.jira, project: 'DEF', issueType: 'Story', priority: 'Low' } };
    const { calls } = await run(createIssue, { summary: 'S', ...write }, [
      { method: 'POST', url: /issue$/, respond: { json: { id: '1', key: 'DEF-1' } } },
      { url: /DEF-1$/, respond: { json: issue('DEF-1') } },
    ], { config });
    expect(JSON.parse(calls[0]!.body!).fields).toMatchObject({ project: { key: 'DEF' }, issuetype: { name: 'Story' }, priority: { name: 'Low' } });
  });

  it('create-issue: an --input-file supplies the issue, @file values are read, flags override and are reported', async () => {
    const files = {
      'issue.json': JSON.stringify({ project: 'PROJ', issueType: 'Bug', fields: { Summary: 'From file', description: '@desc.html', priority: 'High', customfield_10032: '@ac.md' } }),
      'desc.html': '<p>D</p>',
      'ac.md': 'AC',
    };
    const { envelope, calls } = await run(createIssue, { inputFile: 'issue.json', priority: 'Low', ...write }, [
      { method: 'POST', url: /issue$/, respond: { json: { id: '1', key: 'PROJ-9' } } },
      { url: /PROJ-9$/, respond: { json: issue('PROJ-9') } },
    ], { files });
    expect(JSON.parse(calls[0]!.body!).fields).toEqual({
      project: { key: 'PROJ' },
      issuetype: { name: 'Bug' },
      summary: 'From file',
      description: '<p>D</p>',
      priority: { name: 'Low' },
      customfield_10032: 'AC',
    });
    expect(envelope.meta.warnings).toEqual([{ code: 'JIRA_INPUT_OVERRIDDEN', message: '--input-file value(s) overridden by flags: priority' }]);
  });

  it('create-issue: reads --input-file from stdin on the CLI and refuses "-" where stdin is the protocol', async () => {
    const routes: Route[] = [
      { method: 'POST', url: /issue$/, respond: { json: { id: '1', key: 'PROJ-9' } } },
      { url: /PROJ-9$/, respond: { json: issue('PROJ-9') } },
    ];
    const piped = await run(createIssue, { inputFile: '-', ...write }, routes, { stdin: JSON.stringify({ project: 'PROJ', fields: { summary: 'Piped' } }) });
    expect(JSON.parse(piped.calls[0]!.body!).fields.summary).toBe('Piped');
    const mcp = await run(createIssue, { inputFile: '-', ...write }, routes);
    expect(mcp.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('not available over MCP') });
    expect(mcp.calls).toHaveLength(0);
  });

  it('create-issue: refuses before any request without a project, a summary, or with a bad --field', async () => {
    const none = await run(createIssue, { summary: 'S', ...write }, []);
    expect(none.envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: '--project required (or set defaults.jira.project in config, or "project" in --input-file)',
    });
    const noSummary = await run(createIssue, { project: 'P', ...write }, []);
    expect(noSummary.envelope.error?.message).toBe('Must specify --summary or "fields.summary" in --input-file');
    const badField = await run(createIssue, { project: 'P', summary: 'S', field: ['NoEquals'], ...write }, []);
    expect(badField.envelope.error?.message).toContain('expected Name=value');
    const unknownName = await run(createIssue, { project: 'P', summary: 'S', field: ['Acceptance Criteria=x'], ...write }, []);
    expect(unknownName.envelope.error?.message).toContain('Unknown custom field: "Acceptance Criteria"');
    expect([...none.calls, ...noSummary.calls, ...badField.calls, ...unknownName.calls]).toHaveLength(0);
  });

  it("create-issue: Jira's error names a field by its friendly name", async () => {
    const { envelope } = await run(createIssue, { project: 'P', summary: 'S', ...write }, [
      { method: 'POST', url: /issue$/, respond: { status: 400, json: { errorMessages: [], errors: { customfield_10016: 'Number value expected' } } } },
    ]);
    expect(envelope.error?.message).toBe('Story Points (customfield_10016): Number value expected');
  });

  it('update-issue: PUTs only the fields given, with --field values shaped by type and @file JSON parsed', async () => {
    const files = { 'steps.json': ' {"steps":[1]} \n', 'fields.json': JSON.stringify({ fixVersions: [{ name: '1.0' }] }) };
    const { envelope, calls } = await run(updateIssue, { key: 'PROJ-1', summary: 'New', field: ['Story Points=8', 'customfield_11204=@steps.json', 'fixVersions=2.0'], fieldsFile: 'fields.json', ...write }, [
      { method: 'PUT', url: `${JIRA}/rest/api/2/issue/PROJ-1`, respond: { status: 204 } },
    ], { files });
    expect(calls[0]).toEqual({
      method: 'PUT',
      url: `${JIRA}/rest/api/2/issue/PROJ-1`,
      headers: JSON_HEADERS,
      body: JSON.stringify({ fields: { summary: 'New', fixVersions: '2.0', customfield_10016: 8, customfield_11204: { steps: [1] } } }),
    });
    expect(envelope.data).toEqual({ updated: 'PROJ-1' });
  });

  it('update-issue: nothing to change still PUTs { fields: {} } and reports success, as the contract specifies', async () => {
    const { envelope, calls } = await run(updateIssue, { key: 'PROJ-1', ...write }, [{ method: 'PUT', url: /PROJ-1$/, respond: { status: 204 } }]);
    expect(calls.map((c) => [c.method, c.body])).toEqual([['PUT', JSON.stringify({ fields: {} })]]);
    expect(envelope.data).toEqual({ updated: 'PROJ-1' });
  });

  it('transition-issue: resolves a name case-insensitively; anything parseInt reads a number from is an id', async () => {
    const transitions = { url: /transitions$/, respond: { json: { transitions: [{ id: '21', name: 'In Progress' }, { id: '41', name: '2nd Review' }] } } };
    const post = { method: 'POST', url: /transitions$/, respond: { status: 204 } };
    const byName = await run(transitionIssue, { key: 'PROJ-1', transition: 'in progress', ...write }, [post, transitions]);
    expect(byName.calls.map((c) => [c.method, c.body])).toEqual([['GET', undefined], ['POST', JSON.stringify({ transition: { id: '21' } })]]);
    const byId = await run(transitionIssue, { key: 'PROJ-1', transition: '31', ...write }, [post]);
    expect(byId.calls.map((c) => c.body)).toEqual([JSON.stringify({ transition: { id: '31' } })]);
    // Suspected bug (#70), pinned: parseInt('2nd Review') is 2, so it's sent as id "2nd Review" with no lookup.
    const digitName = await run(transitionIssue, { key: 'PROJ-1', transition: '2nd Review', ...write }, [post, transitions]);
    expect(digitName.calls.map((c) => c.body)).toEqual([JSON.stringify({ transition: { id: '2nd Review' } })]);
    const missing = await run(transitionIssue, { key: 'PROJ-1', transition: 'Shipped', ...write }, [transitions]);
    expect(missing.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Transition not found: Shipped', fix: expect.stringContaining('In Progress, 2nd Review') });
  });

  it('log-work: POSTs timeSpent, and comment and started only when given', async () => {
    const route = { method: 'POST', url: /worklog$/, respond: { status: 201, json: { id: '1' } } };
    const bare = await run(logWork, { key: 'PROJ-1', timeSpent: '30m', ...write }, [route]);
    expect(bare.calls[0]).toMatchObject({ url: `${JIRA}/rest/api/2/issue/PROJ-1/worklog`, body: JSON.stringify({ timeSpent: '30m' }) });
    const full = await run(logWork, { key: 'PROJ-1', timeSpent: '1d', comment: 'c', started: '2024-01-15T09:00:00.000+0000', ...write }, [route]);
    expect(JSON.parse(full.calls[0]!.body!)).toEqual({ timeSpent: '1d', comment: 'c', started: '2024-01-15T09:00:00.000+0000' });
  });

  it('list-comments: pages until total', async () => {
    const page = (startAt: number) => ({ comments: [{ id: String(startAt) }], total: 2, startAt, maxResults: 1 });
    const { envelope, calls } = await run(listComments, { key: 'PROJ-1' }, [
      { url: /startAt=0/, respond: { json: page(0) } },
      { url: /startAt=1/, respond: { json: page(1) } },
    ]);
    expect(calls.map((c) => new URL(c.url).search)).toEqual(['?startAt=0&maxResults=100', '?startAt=1&maxResults=100']);
    expect(envelope.data).toEqual([{ id: '0' }, { id: '1' }]);
  });

  it('add-label: PUTs add operations, trimming the list', async () => {
    const { envelope, calls } = await run(addLabel, { key: 'PROJ-1', labels: ' a , b ,', ...write }, [{ method: 'PUT', url: /PROJ-1$/, respond: { status: 204 } }]);
    expect(calls[0]!.body).toBe(JSON.stringify({ update: { labels: [{ add: 'a' }, { add: 'b' }] } }));
    expect(envelope.data).toEqual({ updated: 'PROJ-1', labelsAdded: ['a', 'b'] });
    // An empty list is still sent.
    const empty = await run(addLabel, { key: 'PROJ-1', labels: ' , ', ...write }, [{ method: 'PUT', url: /PROJ-1$/, respond: { status: 204 } }]);
    expect(empty.calls[0]!.body).toBe(JSON.stringify({ update: { labels: [] } }));
    expect(empty.envelope.data).toEqual({ updated: 'PROJ-1', labelsAdded: [] });
  });

  it('assign: PUTs the Data Center username as name, never accountId', async () => {
    const { calls } = await run(assign, { key: 'PROJ-1', assignee: 'jsmith', ...write }, [{ method: 'PUT', url: /assignee$/, respond: { status: 204 } }]);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: `${JIRA}/rest/api/2/issue/PROJ-1/assignee`, body: JSON.stringify({ name: 'jsmith' }) });
  });

  it('link-issue: resolves a type by name or phrase; an unknown type lists the known ones', async () => {
    const types = { url: /issueLinkType$/, respond: { json: { issueLinkTypes: [{ id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }] } } };
    const post = { method: 'POST', url: /issueLink$/, respond: { status: 201 } };
    const { calls } = await run(linkIssue, { key: 'A-1', linkType: 'is blocked by', target: 'B-2', ...write }, [types, post]);
    expect(calls[1]!.body).toBe(JSON.stringify({ type: { id: '10000' }, inwardIssue: { key: 'A-1' }, outwardIssue: { key: 'B-2' } }));
    const unknown = await run(linkIssue, { key: 'A-1', linkType: 'Duplicates', target: 'B-2', ...write }, [types]);
    expect(unknown.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Link type not found: Duplicates', fix: expect.stringContaining('Blocks') });
  });
});

describe('search', () => {
  const issues = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), key: `P-${from + i}`, fields: { customfield_10016: 1 } }));
  const searchRoute = (total: number): Route => ({
    method: 'POST',
    url: `${JIRA}/rest/api/2/search`,
    respond: (req) => {
      const body = JSON.parse(req.body!) as { startAt: number; maxResults: number };
      return { json: { issues: issues(body.startAt, Math.max(0, Math.min(body.maxResults, total - body.startAt))), total, startAt: body.startAt, maxResults: body.maxResults } };
    },
  });

  it('POSTs the JQL with the default fields plus registered custom fields, translating names both ways', async () => {
    const { envelope, calls } = await run(search, { jql: '"Story Points" > 3 AND summary ~ "Story Points"', maxResults: 1 }, [searchRoute(5)]);
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `${JIRA}/rest/api/2/search`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jql: '"Story Points" > 3 AND summary ~ "Story Points"',
        startAt: 0,
        maxResults: 1,
        fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter', 'customfield_10016'],
      }),
    });
    expect(envelope.data).toMatchObject({ total: 5, startAt: 0, maxResults: 1, issues: [{ fields: { 'Story Points': 1 } }] });
    expect(envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
  });

  it('translates an unquoted friendly name in JQL to its id', async () => {
    const { calls } = await run(search, { jql: 'project = P AND story points > 3', maxResults: 1 }, [searchRoute(1)]);
    expect(JSON.parse(calls[0]!.body!).jql).toBe('project = P AND customfield_10016 > 3');
  });

  it('pages in chunks of 100 until maxResults, keeping the server total', async () => {
    const { envelope, calls } = await run(search, { jql: 'project = P', maxResults: 250 }, [searchRoute(10000)]);
    expect(calls.map((c) => JSON.parse(c.body!) as { startAt: number; maxResults: number }).map((b) => [b.startAt, b.maxResults])).toEqual([[0, 100], [100, 100], [200, 50]]);
    expect(envelope.data).toMatchObject({ total: 10000, maxResults: 250 });
    expect(envelope.meta.page).toEqual({ nextCursor: '250', limit: 250 });
  });

  it('pages everything from startAt when maxResults is omitted', async () => {
    const { envelope, calls } = await run(search, { jql: 'project = P', startAt: 98 }, [searchRoute(203)]);
    expect(calls.map((c) => (JSON.parse(c.body!) as { startAt: number }).startAt)).toEqual([98, 198]);
    expect(envelope.data).toMatchObject({ total: 203, startAt: 98, maxResults: 105 });
    expect(envelope.meta.page?.nextCursor).toBeNull();
  });

  it('--fields replaces the default set, resolving friendly names; an unknown name with a space is refused', async () => {
    const { calls } = await run(search, { jql: 'x', maxResults: 1, fields: 'summary, Story Points ,fixVersions' }, [searchRoute(1)]);
    expect(JSON.parse(calls[0]!.body!).fields).toEqual(['summary', 'customfield_10016', 'fixVersions']);
    const bad = await run(search, { jql: 'x', fields: 'Epic Name' }, []);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Unknown field in --fields: "Epic Name".' });
  });

  it('reads and trims --jql-file, and refuses both, neither, or an empty file', async () => {
    const files = { 'q.jql': 'project = P\n', 'empty.jql': ' \n' };
    const { calls } = await run(search, { jqlFile: 'q.jql', maxResults: 1 }, [searchRoute(1)], { files });
    expect(JSON.parse(calls[0]!.body!).jql).toBe('project = P');
    expect((await run(search, { jql: 'a', jqlFile: 'q.jql' }, [], { files })).envelope.error?.message).toBe('Cannot specify both --jql and --jql-file');
    expect((await run(search, {}, [])).envelope.error?.message).toBe('Must specify --jql or --jql-file');
    expect((await run(search, { jqlFile: 'empty.jql' }, [], { files })).envelope.error?.message).toBe('JQL query is empty');
  });

  it('refuses a --start-at that is not all digits before any request, as the contract specifies', async () => {
    for (const startAt of [-1, 1.5, 'abc', '10x', '']) {
      const { envelope, calls } = await run(search, { jql: 'x', startAt }, []);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: `--start-at must be a non-negative integer, got "${startAt}"` });
      expect(calls).toHaveLength(0);
    }
  });

  it('reads --max-results with parseInt: "10x" is 10, an empty value means all, and a non-number is sent as null', async () => {
    const tenX = await run(search, { jql: 'x', maxResults: '10x' }, [searchRoute(50)]);
    expect(JSON.parse(tenX.calls[0]!.body!).maxResults).toBe(10);
    const empty = await run(search, { jql: 'x', maxResults: '' }, [searchRoute(1)]);
    expect(JSON.parse(empty.calls[0]!.body!).maxResults).toBe(100);
    // Suspected bug (#70), pinned: NaN serialises as null, and paging continues to total.
    const nan = await run(search, { jql: 'x', maxResults: 'abc' }, [searchRoute(1)]);
    expect(JSON.parse(nan.calls[0]!.body!).maxResults).toBeNull();
  });
});

describe('fields', () => {
  it('without --discover, lists the registered fields with no request, warning about flags that need --discover', async () => {
    const { envelope, calls } = await run(fields, { customOnly: true }, []);
    expect(envelope.data).toEqual([{ id: 'customfield_10016', name: 'Story Points', type: 'number' }]);
    expect(envelope.meta.warnings?.[0]?.code).toBe('JIRA_NEEDS_DISCOVER');
    expect(calls).toHaveLength(0);
  });

  const fieldList = {
    url: `${JIRA}/rest/api/2/field`,
    respond: {
      json: [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
        { id: 'customfield_10100', name: 'Epic Link', custom: true, schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } },
        { id: 'customfield_10101', name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
        { id: 'customfield_10200', name: 'Crew', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
      ],
    },
  };

  it('--discover suggests a type per field', async () => {
    const { envelope } = await run(fields, { discover: true, customOnly: true }, [fieldList]);
    const data = envelope.data as Array<{ id: string; suggestedType?: string }>;
    expect(data.map((f) => [f.id, f.suggestedType])).toEqual([
      ['customfield_10100', 'string'],
      ['customfield_10101', 'number'],
      ['customfield_10200', 'select'],
    ]);
  });

  it('--project falls back to the paginated createmeta when the classic one is gone, merging values across types', async () => {
    const { envelope, calls } = await run(fields, { discover: true, project: 'PROJ' }, [
      fieldList,
      { url: /createmeta\?/, respond: { status: 404, json: { errorMessages: ['gone'] } } },
      { url: /createmeta\/PROJ\/issuetypes$/, respond: { json: { values: [{ id: '1', name: 'Bug' }, { id: '2', name: 'Story' }] } } },
      { url: /createmeta\/PROJ\/issuetypes\/1$/, respond: { json: { values: [{ fieldId: 'customfield_10200', allowedValues: [{ id: '10400', value: 'Platform' }] }] } } },
      { url: /createmeta\/PROJ\/issuetypes\/2$/, respond: { json: { values: [{ fieldId: 'customfield_10200', allowedValues: [{ id: '10400', value: 'Platform' }, { id: '10401', value: 'Payments' }] }] } } },
    ]);
    expect(calls.map((c) => new URL(c.url).pathname + new URL(c.url).search)).toEqual([
      '/rest/api/2/field',
      '/rest/api/2/issue/createmeta?projectKeys=PROJ&expand=projects.issuetypes.fields',
      '/rest/api/2/issue/createmeta/PROJ/issuetypes',
      '/rest/api/2/issue/createmeta/PROJ/issuetypes/1',
      '/rest/api/2/issue/createmeta/PROJ/issuetypes/2',
    ]);
    const crew = (envelope.data as Array<{ id: string; allowedValues?: unknown[] }>).find((f) => f.id === 'customfield_10200');
    expect(crew?.allowedValues).toEqual([{ id: '10400', value: 'Platform' }, { id: '10401', value: 'Payments' }]);
  });

  it('--project with both createmeta endpoints failing still lists fields, and says why values are missing', async () => {
    const { envelope } = await run(fields, { discover: true, project: 'PROJ', issueType: 'Bug' }, [fieldList, { url: /createmeta/, respond: { status: 500, text: '' } }]);
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.warnings).toEqual([{ code: 'JIRA_NO_ALLOWED_VALUES', message: expect.stringContaining('project PROJ') }]);
  });
});

describe('attachments', () => {
  it('add-attachment: POSTs one multipart file part with no-check, and a boundary fixed by the content', async () => {
    const { envelope, calls } = await run(addAttachment, { key: 'PROJ-1', file: 'dir/report.pdf', ...write }, [
      { method: 'POST', url: `${JIRA}/rest/api/2/issue/PROJ-1/attachments`, respond: { json: [{ id: '1', filename: 'report.pdf' }] } },
    ], { files: { 'dir/report.pdf': '%PDF' } });
    const { body, contentType } = multipartFile('report.pdf', new TextEncoder().encode('%PDF'));
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `${JIRA}/rest/api/2/issue/PROJ-1/attachments`,
      headers: { authorization: 'Bearer test-token', 'x-atlassian-token': 'no-check', accept: 'application/json', connection: 'close', 'content-type': contentType },
      body: new TextDecoder().decode(body),
    });
    expect(calls[0]!.body).toContain('Content-Disposition: form-data; name="file"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n');
    expect(envelope.data).toEqual([{ id: '1', filename: 'report.pdf' }]);
  });

  it('add-attachment: a missing file is INVALID_INPUT before any request', async () => {
    const { envelope, calls } = await run(addAttachment, { key: 'PROJ-1', file: 'nope.png', ...write }, []);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('nope.png') });
    expect(calls).toHaveLength(0);
  });

  const listing = (content: string, filename = 'shot.png') => ({ url: /\?fields=attachment$/, respond: { json: { fields: { attachment: [{ id: '7', filename, content }] } } } });

  it('download-attachment: saves under .toil by default, keeping only the file name', async () => {
    const { envelope, calls, written } = await run(downloadAttachment, { key: 'PROJ-1', attachmentId: '7' }, [
      listing(`${JIRA}/secure/attachment/7/shot.png`, '../../etc/shot.png'),
      { url: `${JIRA}/secure/attachment/7/shot.png`, respond: { text: 'PNG' } },
    ]);
    expect(calls[1]).toEqual({ method: 'GET', url: `${JIRA}/secure/attachment/7/shot.png`, headers: { authorization: 'Bearer test-token', connection: 'close' }, body: undefined });
    expect(envelope.data).toEqual({ saved: '/work/.toil/shot.png', filename: '../../etc/shot.png', size: 3 });
    expect(Object.keys(written)).toEqual(['/work/.toil/shot.png']);
  });

  it('download-attachment: never sends the token to a host other than the configured one', async () => {
    const { envelope, calls } = await run(downloadAttachment, { key: 'PROJ-1', attachmentId: '7', dir: 'out' }, [
      listing('https://jira-internal.imagile.dev:8443/secure/attachment/7/shot.png?x=1'),
      { url: `${JIRA}/secure/attachment/7/shot.png?x=1`, respond: { text: 'PNG' } },
    ]);
    expect(calls[1]!.url).toBe(`${JIRA}/secure/attachment/7/shot.png?x=1`);
    expect(envelope.meta.warnings?.[0]).toMatchObject({ code: 'JIRA_ATTACHMENT_HOST' });
    expect(envelope.data).toMatchObject({ saved: '/work/out/shot.png' });
  });

  it('download-attachment: never replaces a file already there (#70 item 8, a listed divergence)', async () => {
    const { envelope, written } = await run(downloadAttachment, { key: 'PROJ-1', attachmentId: '7' }, [
      listing(`${JIRA}/secure/attachment/7/notes.md`, 'notes.md'),
      { url: `${JIRA}/secure/attachment/7/notes.md`, respond: { text: 'from jira' } },
    ], { files: { '.toil/notes.md': 'mine' } });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '"/work/.toil/notes.md" already exists.', fix: expect.stringContaining('never overwrites') });
    expect(written).toEqual({});
  });

  it('download-attachment: an unknown id is INVALID_INPUT, as in the contract, pointing at list-attachments', async () => {
    const { envelope } = await run(downloadAttachment, { key: 'PROJ-1', attachmentId: '8' }, [listing(`${JIRA}/x`)]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Attachment not found: 8', fix: expect.stringContaining('list-attachments') });
  });
});

describe('agile', () => {
  it('list-boards: pages by total', async () => {
    const { envelope, calls } = await run(listBoards, { project: 'PROJ' }, [
      { url: /startAt=0/, respond: { json: { values: [{ id: 1, name: 'B1', type: 'scrum' }], total: 2, startAt: 0, maxResults: 1 } } },
      { url: /startAt=1/, respond: { json: { values: [{ id: 2, name: 'B2', type: 'scrum' }], total: 2, startAt: 1, maxResults: 1 } } },
    ]);
    expect(calls[0]!.url).toBe(`${JIRA}/rest/agile/1.0/board?projectKeyOrId=PROJ&startAt=0&maxResults=100`);
    expect((envelope.data as Array<{ id: number }>).map((b) => b.id)).toEqual([1, 2]);
  });

  it('list-sprints: pages on total only, so the sprint list (which has none) costs one more, empty, request', async () => {
    const { envelope, calls } = await run(listSprints, { board: 3, state: 'active, future' }, [
      { url: /board\/3\/sprint\?startAt=0&/, respond: { json: { maxResults: 100, startAt: 0, isLast: true, values: [{ id: 5, name: 'S5', state: 'active' }] } } },
      { url: /board\/3\/sprint\?startAt=1&/, respond: { json: { maxResults: 100, startAt: 1, isLast: true, values: [] } } },
    ]);
    // Suspected bug (#70), pinned: isLast is ignored.
    expect(calls.map((c) => c.url)).toEqual([
      `${JIRA}/rest/agile/1.0/board/3/sprint?startAt=0&maxResults=100&state=active,future`,
      `${JIRA}/rest/agile/1.0/board/3/sprint?startAt=1&maxResults=100&state=active,future`,
    ]);
    expect(envelope.data).toEqual([{ id: 5, name: 'S5', state: 'active' }]);
  });

  it('list-sprints --project: scrum boards only, each sprint once', async () => {
    const { envelope, calls } = await run(listSprints, { project: 'PROJ' }, [
      { url: /board\?/, respond: { json: { total: 3, values: [{ id: 1, type: 'scrum' }, { id: 2, type: 'scrum' }, { id: 3, type: 'kanban' }] } } },
      { url: /board\/1\/sprint/, respond: { json: { total: 1, values: [{ id: 10, state: 'active' }] } } },
      { url: /board\/2\/sprint/, respond: { json: { total: 2, values: [{ id: 10, state: 'active' }, { id: 11, state: 'future' }] } } },
    ]);
    expect((envelope.data as Array<{ id: number }>).map((s) => s.id)).toEqual([10, 11]);
    expect(calls.some((c) => c.url.includes('/board/3/'))).toBe(false);
  });

  it('list-sprints: needs a board or project; a non-numeric board and any state reach the request unchecked', async () => {
    expect((await run(listSprints, {}, [])).envelope.error?.message).toBe('Either --board or --project is required');
    const { calls } = await run(listSprints, { board: 'abc', state: 'open,,closed' }, [{ url: /sprint/, respond: { json: { total: 0, values: [] } } }]);
    // Suspected bug (#70), pinned: parseInt('abc') is NaN.
    expect(calls[0]!.url).toBe(`${JIRA}/rest/agile/1.0/board/NaN/sprint?startAt=0&maxResults=100&state=open,,closed`);
  });

  it('set-sprint: POSTs the key to the sprint, and reports the sprint as the string it always was', async () => {
    const { envelope, calls } = await run(setSprint, { key: 'PROJ-1', sprint: 42, ...write }, [{ method: 'POST', url: /sprint\/42\/issue$/, respond: { status: 204 } }]);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${JIRA}/rest/agile/1.0/sprint/42/issue`, body: JSON.stringify({ issues: ['PROJ-1'] }) });
    expect(envelope.data).toEqual({ updated: 'PROJ-1', sprint: '42' });
    const nan = await run(setSprint, { key: 'PROJ-1', sprint: 'next', ...write }, [{ method: 'POST', url: /sprint\/NaN\/issue$/, respond: { status: 204 } }]);
    expect(nan.calls[0]!.url).toBe(`${JIRA}/rest/agile/1.0/sprint/NaN/issue`);
    expect(nan.envelope.data).toEqual({ updated: 'PROJ-1', sprint: 'next' });
  });
});

describe('connection', () => {
  it('reads customFields given as JSON text, as TOIL_JIRA_CUSTOM_FIELDS would give it', async () => {
    const config = { jira: { ...fixtureConfig.jira, customFields: JSON.stringify([{ id: 'customfield_1', name: 'Team' }]) } };
    const { calls } = await run(search, { jql: 'Team = x', maxResults: 1 }, [{ method: 'POST', url: /search/, respond: { json: { issues: [], total: 0 } } }], { config });
    expect(JSON.parse(calls[0]!.body!).jql).toBe('customfield_1 = x');
  });

  it('refuses a customFields entry with an unknown type, naming the key', async () => {
    const config = { jira: { ...fixtureConfig.jira, customFields: [{ id: 'customfield_1', name: 'Team', type: 'dropdown' }] } };
    const { envelope, calls } = await run(getIssue, { key: 'P-1' }, [], { config });
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', message: expect.stringContaining('customFields') });
    expect(calls).toHaveLength(0);
  });

  it('names TOIL_JIRA_BASE_URL and TOIL_JIRA_API_TOKEN when nothing is configured', async () => {
    const { envelope } = await run(getIssue, { key: 'P-1' }, [], { config: {} });
    expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', fix: expect.stringContaining('TOIL_JIRA_BASE_URL and TOIL_JIRA_API_TOKEN') });
  });
});

describe('create-issue --project, a context input', () => {
  const created = [
    { method: 'POST', url: `${JIRA}/rest/api/2/issue`, respond: { status: 201, json: { id: '1', key: 'PROJ-9' } } },
    { url: `${JIRA}/rest/api/2/issue/PROJ-9`, respond: { json: issue('PROJ-9') } },
  ];
  const config = { jira: { ...fixtureConfig.jira, project: 'CONN' } };
  const files = { 'issue.json': JSON.stringify({ project: 'FILE', fields: { summary: 'S' } }), 'bare.json': JSON.stringify({ fields: { summary: 'S' } }) };
  const sent = (calls: Array<{ body?: string | undefined }>) => (JSON.parse(calls[0]!.body!) as { fields: { project: { key: string } } }).fields.project.key;

  it('the flag wins over the input file and the connection, and meta.context says it came from the call', async () => {
    const { envelope, calls } = await run(createIssue, { project: 'FLAG', inputFile: 'issue.json', ...write }, created, { config, files });
    expect(sent(calls)).toBe('FLAG');
    expect(envelope.meta.context?.inputs).toEqual({ project: { value: 'FLAG', source: 'input' } });
  });

  it('then the input file, which beats the connection and is reported as source file', async () => {
    const { envelope, calls } = await run(createIssue, { inputFile: 'issue.json', ...write }, created, { config, files });
    expect(sent(calls)).toBe('FILE');
    expect(envelope.meta.context?.inputs).toEqual({ project: { value: 'FILE', source: 'file' } });
  });

  it("then the connection's project, resolved by core", async () => {
    const { envelope, calls } = await run(createIssue, { inputFile: 'bare.json', ...write }, created, { config, files });
    expect(sent(calls)).toBe('CONN');
    expect(envelope.meta.context?.inputs).toEqual({ project: { value: 'CONN', source: 'connection' } });
  });

  it('with none of them, the "--project required" error; an empty --project gets the same one', async () => {
    for (const input of [{ summary: 'S' }, { summary: 'S', project: '' }]) {
      const { envelope, calls } = await run(createIssue, { ...input, ...write }, []);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--project required (or set defaults.jira.project in config, or "project" in --input-file)' });
      expect(calls).toHaveLength(0);
    }
  });

  it('an empty project in the input file still wins over the connection and gets the same error, as ?? gave it', async () => {
    const empty = { 'empty.json': JSON.stringify({ project: '', fields: { summary: 'S' } }) };
    const { envelope, calls } = await run(createIssue, { inputFile: 'empty.json', ...write }, [], { config, files: empty });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--project required (or set defaults.jira.project in config, or "project" in --input-file)' });
    expect(calls).toHaveLength(0);
    // meta.context doesn't claim the connection's project, which the call never used.
    expect(envelope.meta.context?.inputs?.project).toBeUndefined();
  });

  it('the other --project flags are plain flags that never fall back to the connection', async () => {
    const { envelope } = await run(listBoards, {}, [], { config });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT' });
    const sprints = await run(listSprints, {}, [], { config });
    expect(sprints.envelope.error?.message).toBe('Either --board or --project is required');
  });
});

describe('paging through core', () => {
  it('search with an unreadable --max-results sends null on every page and reads to the total (#70, pinned)', async () => {
    // A server that treats a null maxResults as its own default of 2.
    const route: Route = {
      method: 'POST',
      url: `${JIRA}/rest/api/2/search`,
      respond: (req) => {
        const { startAt } = JSON.parse(req.body!) as { startAt: number };
        const n = Math.max(0, Math.min(2, 5 - startAt));
        return { json: { issues: Array.from({ length: n }, (_, i) => ({ id: String(startAt + i), key: `P-${startAt + i}`, fields: {} })), total: 5 } };
      },
    };
    const { envelope, calls } = await run(search, { jql: 'x', maxResults: 'abc' }, [route]);
    expect(calls.map((c) => JSON.parse(c.body!) as { startAt: number; maxResults: null }).map((b) => [b.startAt, b.maxResults])).toEqual([[0, null], [2, null], [4, null]]);
    expect(envelope.data).toMatchObject({ total: 5, maxResults: 5 });
  });

  it('a page with no total keeps going until an empty page, as `startAt >= total` reads it', async () => {
    const { envelope, calls } = await run(listComments, { key: 'PROJ-1' }, [
      { url: /startAt=0/, respond: { json: { comments: [{ id: '0' }] } } },
      { url: /startAt=1/, respond: { json: { comments: [] } } },
    ]);
    expect(calls).toHaveLength(2);
    expect(envelope.data).toEqual([{ id: '0' }]);
  });
});

describe('search total', () => {
  it('keeps the total from an empty page, as the contract specifies', async () => {
    const { envelope } = await run(search, { jql: 'x', startAt: 500 }, [{ method: 'POST', url: `${JIRA}/rest/api/2/search`, respond: { json: { issues: [], total: 42 } } }]);
    expect(envelope.data).toMatchObject({ issues: [], total: 42, startAt: 500, maxResults: 0 });
  });
});

describe('more pinned paging and project cases', () => {
  const searchAt = (respond: (body: { startAt: number; maxResults: number | null }) => unknown): Route => ({
    method: 'POST',
    url: `${JIRA}/rest/api/2/search`,
    respond: (req) => ({ json: respond(JSON.parse(req.body!) as { startAt: number; maxResults: number | null }) }),
  });
  const issuesFrom = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), key: `P-${from + i}`, fields: {} }));

  it('--max-results 0 sends one request for maxResults 0 and returns the server total (counting matches)', async () => {
    const { envelope, calls } = await run(search, { jql: 'x', maxResults: 0 }, [searchAt(() => ({ issues: [], total: 1234 }))]);
    expect(calls.map((c) => JSON.parse(c.body!).maxResults)).toEqual([0]);
    expect(envelope.data).toMatchObject({ issues: [], total: 1234, maxResults: 0 });
  });

  it('a server capping pages at 50: each request asks for what is left, at most 100', async () => {
    const { envelope, calls } = await run(search, { jql: 'x', maxResults: 250 }, [
      searchAt(({ startAt, maxResults }) => ({ issues: issuesFrom(startAt, Math.min(50, maxResults ?? 50)), total: 10000 })),
    ]);
    expect(calls.map((c) => JSON.parse(c.body!) as { startAt: number; maxResults: number }).map((b) => [b.startAt, b.maxResults])).toEqual([
      [0, 100],
      [50, 100],
      [100, 100],
      [150, 100],
      [200, 50],
    ]);
    expect(envelope.data).toMatchObject({ total: 10000, maxResults: 250 });
  });

  it('a page carrying both issues and values is read from issues, as the contract specifies for every list', async () => {
    const { envelope } = await run(listBoards, { project: 'PROJ' }, [
      { url: /board\?/, respond: { json: { total: 1, issues: [{ id: 1, name: 'from issues', type: 'scrum' }], values: [{ id: 2, name: 'from values', type: 'scrum' }] } } },
    ]);
    expect(envelope.data).toEqual([{ id: 1, name: 'from issues', type: 'scrum' }]);
  });

  const created = [
    { method: 'POST', url: `${JIRA}/rest/api/2/issue`, respond: { status: 201, json: { id: '1', key: 'PROJ-9' } } },
    { url: `${JIRA}/rest/api/2/issue/PROJ-9`, respond: { json: issue('PROJ-9') } },
  ];
  const config = { jira: { ...fixtureConfig.jira, project: 'CONN' } };
  const required = '--project required (or set defaults.jira.project in config, or "project" in --input-file)';

  it('a JSON project of null falls to the connection; "", 0 and false give the required error even with a connection project', async () => {
    const nul = await run(createIssue, { inputFile: 'i.json', ...write }, created, { config, files: { 'i.json': JSON.stringify({ project: null, fields: { summary: 'S' } }) } });
    expect(JSON.parse(nul.calls[0]!.body!).fields.project).toEqual({ key: 'CONN' });
    expect(nul.envelope.meta.context?.inputs).toEqual({ project: { value: 'CONN', source: 'connection' } });
    for (const project of ['', 0, false]) {
      const { envelope, calls } = await run(createIssue, { inputFile: 'i.json', ...write }, created, { config, files: { 'i.json': JSON.stringify({ project, fields: { summary: 'S' } }) } });
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: required });
      expect(calls).toHaveLength(0);
    }
  });

  it('an empty --project errors even with a connection project set', async () => {
    const { envelope, calls } = await run(createIssue, { project: '', summary: 'S', ...write }, created, { config });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: required });
    expect(calls).toHaveLength(0);
  });
});
