import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { API, fixture, issue, prAsIssue, project, projectItem, pullRequest, REPO, user } from '../../../test/fixtures/github.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { projectFieldsCommand, projectItemsCommand, listProjectsCommand } from './projects.js';
import { listPrsCommand } from './prs.js';
import { getIssueCommand, issueEventsCommand, listIssuesCommand, searchIssuesCommand } from './work-items.js';

/**
 * Issues, their timelines and Projects: the requests sent, the paging, and
 * the plain errors for an older Enterprise Server. Payload shapes follow
 * GitHub's REST and GraphQL reference (invented from the docs, not captured
 * live): https://docs.github.com/en/rest/issues/issues,
 * https://docs.github.com/en/rest/issues/sub-issues, https://docs.github.com/en/rest/search/search,
 * https://docs.github.com/en/rest/issues/timeline and
 * https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects.
 */

const BASE = { owner: 'imagile', repo: 'toil-probe' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[] = fixture.routes!) {
  const t = testContext({ config: { github: fixture.config!.github }, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);
const graphqlBody = (body: string | undefined) => JSON.parse(body ?? '{}') as { query: string; variables: Record<string, unknown> };

describe('list-issues', () => {
  it('sends state, labels, filters and since as UTC seconds, and leaves out pull requests', async () => {
    const { envelope, calls } = await run(listIssuesCommand, { ...BASE, label: ['bug', 'area/api'], assignee: 'octo-dev', type: 'Bug', sort: 'updated', direction: 'asc', updatedSince: '2025-01-31' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.split('?')[0]).toBe(`${API}/repos/imagile/toil-probe/issues`);
    expect(query(calls[0]!.url)).toEqual({ state: 'open', labels: 'bug,area/api', assignee: 'octo-dev', type: 'Bug', sort: 'updated', direction: 'asc', since: '2025-01-31T00:00:00Z', per_page: '100', page: '1' });
    expect(envelope.data).toEqual([issue(9)]);
  });

  it('refuses a bad --updated-since before looking for a repo or sending anything', async () => {
    const { envelope, calls } = await run(listIssuesCommand, { updatedSince: 'last tuesday' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--updated-since') });
    expect(calls).toEqual([]);
  });

  it('--limit counts issues only, so a page of pull requests never ends paging, and the cursor resumes', async () => {
    const page = (n: number) => (n === 1 ? [prAsIssue(1), ...Array.from({ length: 99 }, (_, i) => issue(100 + i))] : [issue(300), prAsIssue(2)]);
    const routes: Route[] = [{ path: `${REPO}/issues`, respond: (request) => ({ json: page(Number(new URL(request.url).searchParams.get('page'))) }) }];
    const all = await run(listIssuesCommand, BASE, routes);
    expect((all.envelope.data as unknown[]).length).toBe(100);
    expect(all.calls).toHaveLength(2);
    expect(all.envelope.meta.page).toBeUndefined();

    const first = await run(listIssuesCommand, { ...BASE, limit: 99 }, routes);
    expect((first.envelope.data as Array<{ number: number }>).at(-1)!.number).toBe(198);
    const cursor = first.envelope.meta.page!.nextCursor as string;
    expect(first.envelope.meta.page).toEqual({ nextCursor: expect.any(String), limit: 99 });
    const rest = await run(listIssuesCommand, { ...BASE, limit: 99, cursor }, routes);
    expect((rest.envelope.data as Array<{ number: number }>).map((i) => i.number)).toEqual([300]);
    expect(rest.envelope.meta.page).toEqual({ nextCursor: null, limit: 99 });
  });

  it('--cursor without --limit is INVALID_INPUT', async () => {
    const { envelope, calls } = await run(listIssuesCommand, { ...BASE, cursor: 'abc' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--cursor needs --limit' });
    expect(calls).toEqual([]);
  });
});

describe('list-prs paging', () => {
  it('--limit counts the pull requests that pass --author', async () => {
    const { envelope } = await run(listPrsCommand, { ...BASE, author: 'someone-else', limit: 1 });
    expect(envelope.data).toEqual([pullRequest(8, { user: user('someone-else', 4), created_at: '2024-12-01T00:00:00Z' })]);
    expect(envelope.meta.page).toEqual({ nextCursor: null, limit: 1 });
  });
});

describe('search-issues', () => {
  it('adds is:issue and the updated qualifier, and neither reads nor reports --owner and --repo', async () => {
    const { envelope, calls } = await run(searchIssuesCommand, { ...BASE, query: 'repo:imagile/toil-probe label:bug', updatedSince: '2025-01-31T09:00:00.500Z', sort: 'updated', order: 'asc' });
    expect(query(calls[0]!.url)).toEqual({ q: 'repo:imagile/toil-probe label:bug is:issue updated:>=2025-01-31T09:00:00Z', sort: 'updated', order: 'asc', per_page: '100', page: '1' });
    expect(envelope.data).toEqual([issue(9)]);
    expect(envelope.meta.context?.inputs).not.toHaveProperty('owner');
    expect(envelope.meta.context?.inputs).not.toHaveProperty('repo');
  });

  it('keeps an is:issue already in the query, and stops at the 1,000th result with a warning instead of asking for page 11', async () => {
    const full = { total_count: 2500, incomplete_results: true, items: Array.from({ length: 100 }, (_, i) => issue(i + 1)) };
    const routes: Route[] = [{ path: '/api/v3/search/issues', respond: { json: full } }];
    const { envelope, calls } = await run(searchIssuesCommand, { query: 'is:issue org:imagile' }, routes);
    expect(query(calls[0]!.url).q).toBe('is:issue org:imagile');
    expect(calls).toHaveLength(10);
    expect((envelope.data as unknown[]).length).toBe(1000);
    expect(envelope.meta.warnings?.map((w) => w.code)).toEqual(['GITHUB_SEARCH_CAPPED', 'GITHUB_SEARCH_INCOMPLETE']);
  });
});

describe('get-issue', () => {
  it('one number returns the issue itself, issue type and sub-issue summary included', async () => {
    const { envelope, calls } = await run(getIssueCommand, { ...BASE, number: ['9'] });
    expect(calls.map((c) => c.url)).toEqual([`${API}/repos/imagile/toil-probe/issues/9`]);
    expect(envelope.data).toEqual(issue(9));
    expect(envelope.data).toMatchObject({ type: { name: 'Bug' }, sub_issues_summary: { total: 2 } });
  });

  it('several return { issues, errors } in the order asked, a missing one in errors with a warning', async () => {
    const routes: Route[] = [...fixture.routes!.filter((r) => !('path' in r && r.path === `${REPO}/issues/10`)), { path: `${REPO}/issues/10`, respond: { status: 404, json: { message: 'Not Found' } } }];
    const { envelope } = await run(getIssueCommand, { ...BASE, number: ['10', '9'], subIssues: true }, routes);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ issues: [{ ...issue(9), sub_issues: [issue(10)] }], errors: [{ number: 10, code: 'NOT_FOUND', message: 'Not Found' }] });
    expect(envelope.meta.warnings?.map((w) => w.code)).toEqual(['GITHUB_ISSUES_FAILED']);
  });

  it('a bad token fails the whole call, and more than 100 numbers are refused before any request', async () => {
    const denied = await run(getIssueCommand, { ...BASE, number: ['9', '10'] }, [{ url: /.*/, respond: { status: 401, json: { message: 'Bad credentials' } } }]);
    expect(denied.envelope.error).toMatchObject({ code: 'AUTH' });
    const many = await run(getIssueCommand, { ...BASE, number: Array.from({ length: 101 }, (_, i) => String(i + 1)) });
    expect(many.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('up to 100') });
    expect(many.calls).toEqual([]);
  });

  it('a server with no sub-issues API is UNSUPPORTED, saying so, not NOT_FOUND', async () => {
    const routes: Route[] = [{ path: `${REPO}/issues/9`, respond: { json: issue(9) } }, { path: `${REPO}/issues/9/sub_issues`, respond: { status: 404, json: { message: 'Not Found' } } }];
    const { envelope } = await run(getIssueCommand, { ...BASE, number: ['9'], subIssues: true }, routes);
    expect(envelope.error).toMatchObject({ code: 'UNSUPPORTED', message: expect.stringContaining('no sub-issues API'), fix: expect.stringContaining('--sub-issues') });
  });
});

describe('issue-events', () => {
  it('reads the timeline, paged, and reports where a capped read stopped', async () => {
    const { envelope, calls } = await run(issueEventsCommand, { ...BASE, number: '9', limit: 1 });
    expect(calls[0]!.url).toBe(`${API}/repos/imagile/toil-probe/issues/9/timeline?per_page=100&page=1`);
    expect(envelope.data).toEqual([expect.objectContaining({ event: 'labeled' })]);
    expect(envelope.meta.page).toEqual({ nextCursor: expect.any(String), limit: 1 });
  });
});

describe('projects', () => {
  it('projects list pages through $after with endCursor, owner only', async () => {
    const pages: Record<string, unknown> = {
      first: { data: { repositoryOwner: { projectsV2: { pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29yOjE=' }, nodes: [project(1)] } } } },
      'Y3Vyc29yOjE=': { data: { repositoryOwner: { projectsV2: { pageInfo: { hasNextPage: false, endCursor: 'Y3Vyc29yOjI=' }, nodes: [project(2)] } } } },
    };
    const routes: Route[] = [{ method: 'POST', path: '/api/graphql', respond: (request) => ({ json: pages[(graphqlBody(request.body).variables.after as string | null) ?? 'first'] }) }];
    const { envelope, calls } = await run(listProjectsCommand, BASE, routes);
    expect(calls.map((c) => graphqlBody(c.body).variables)).toEqual([
      { owner: 'imagile', first: 100, after: null },
      { owner: 'imagile', first: 100, after: 'Y3Vyc29yOjE=' },
    ]);
    expect(envelope.data).toEqual([project(1), project(2)]);
    expect(envelope.meta.context?.inputs).not.toHaveProperty('repo');

    const capped = await run(listProjectsCommand, { owner: 'imagile', limit: 1 }, routes);
    expect(capped.calls).toHaveLength(1);
    const resumed = await run(listProjectsCommand, { owner: 'imagile', limit: 1, cursor: capped.envelope.meta.page!.nextCursor }, routes);
    expect(resumed.envelope.data).toEqual([project(2)]);
    expect(resumed.envelope.meta.page).toEqual({ nextCursor: null, limit: 1 });
  });

  it('list-items flattens fieldValues and warns when an item has more than 100', async () => {
    const routes: Route[] = [{ method: 'POST', path: '/api/graphql', respond: { json: { data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [projectItem(true)] } } } } } } }];
    const { envelope, calls } = await run(projectItemsCommand, { owner: 'imagile', project: '3' }, routes);
    expect(graphqlBody(calls[0]!.body).variables).toEqual({ owner: 'imagile', project: 3, first: 100, after: null });
    const { fieldValues, ...rest } = projectItem(true);
    expect(envelope.data).toEqual([{ ...rest, fieldValues: fieldValues.nodes }]);
    expect(envelope.meta.warnings?.map((w) => w.code)).toEqual(['GITHUB_PROJECT_VALUES_TRUNCATED']);
  });

  const failing = (errors: unknown[]): Route[] => [{ method: 'POST', path: '/api/graphql', respond: { json: { data: null, errors } } }];

  it('a missing scope is AUTH naming read:project; a project that is not there is NOT_FOUND', async () => {
    const scope = await run(projectFieldsCommand, { owner: 'imagile', project: '3' }, failing([{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']" }]));
    expect(scope.envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('read:project') });
    const missing = await run(projectFieldsCommand, { owner: 'imagile', project: '99' }, failing([{ type: 'NOT_FOUND', path: ['repositoryOwner', 'projectV2'], message: 'Could not resolve to a ProjectV2 with the number 99.' }]));
    expect(missing.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('number 99') });
    const noOwner = await run(listProjectsCommand, { owner: 'nobody' }, [{ method: 'POST', path: '/api/graphql', respond: { json: { data: { repositoryOwner: null } } } }]);
    expect(noOwner.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'GitHub found no projects owned by nobody.' });
  });

  it('an Enterprise Server whose schema has no Projects (v2) is UNSUPPORTED, in plain words', async () => {
    const { envelope } = await run(listProjectsCommand, { owner: 'imagile' }, failing([{ message: "Field 'projectsV2' doesn't exist on type 'ProjectV2Owner'", extensions: { code: 'undefinedField', typeName: 'ProjectV2Owner', fieldName: 'projectsV2' } }]));
    expect(envelope.error).toMatchObject({ code: 'UNSUPPORTED', message: "This GitHub server's GraphQL API has no Projects (v2), so toil can't read projects owned by imagile." });
  });

  it('needs an owner, and not a repo', async () => {
    const { envelope, calls } = await run(listProjectsCommand, {});
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('GitHub owner') });
    expect(calls).toEqual([]);
  });
});
