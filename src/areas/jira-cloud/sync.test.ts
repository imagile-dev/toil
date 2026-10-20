import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, issue, SITE } from '../../../test/fixtures/jira-cloud.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { listBoards, listSprints } from './agile.js';
import { getChangelog, getIssue, listComments } from './issues.js';
import { listProjects, searchUsers } from './projects.js';
import { search } from './search.js';

/**
 * What a sync needs from Jira Cloud (#212), checked against Atlassian's REST
 * API 3 reference, since no live site has been asked: the bulk fetch, the
 * changelog endpoint, --updated-since in enhanced search, and --limit and
 * --cursor on every list
 * (https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).
 */

const API = `${SITE}/rest/api/3`;

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[]) {
  const t = testContext({ config: fixtureConfig, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

describe('issue get with several keys', () => {
  const bulk = (body: unknown): Route => ({ method: 'POST', path: '/rest/api/3/issue/bulkfetch', respond: { json: body } });

  it('POSTs the keys once to bulkfetch with every field, and puts the answer back in the order asked', async () => {
    const { envelope, calls } = await run(getIssue, { key: ['PROJ-2', 'proj-1', 'PROJ-2'] }, [bulk({ issueErrors: [], issues: [issue('PROJ-1', '10001'), issue('PROJ-2', '10002')] })]);
    expect(calls).toEqual([expect.objectContaining({ method: 'POST', url: `${API}/issue/bulkfetch`, body: JSON.stringify({ issueIdsOrKeys: ['PROJ-2', 'proj-1'], fields: ['*all'] }) })]);
    const data = envelope.data as { issues: Array<{ key: string; descriptionText: string }>; errors: unknown[] };
    expect(data.issues.map((i) => i.key)).toEqual(['PROJ-2', 'PROJ-1']);
    expect(data.issues[0]!.descriptionText).toContain('Steps to reproduce');
    expect(data.errors).toEqual([]);
    expect(envelope.meta.warnings).toBeUndefined();
  });

  type Bulk = { issues: Array<{ key: string }>; errors: Array<{ key: string; code: string; message: string }> };

  it('a key Jira left out is NOT_FOUND only when everything else in the answer is accounted for', async () => {
    const { envelope } = await run(getIssue, { key: ['PROJ-1', 'PROJ-404'] }, [bulk({ issueErrors: [], issues: [issue('PROJ-1', '10001')] })]);
    const data = envelope.data as Bulk;
    expect(data.issues.map((i) => i.key)).toEqual(['PROJ-1']);
    expect(data.errors).toEqual([{ key: 'PROJ-404', code: 'NOT_FOUND', message: expect.stringContaining("doesn't exist") }]);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'JIRA_CLOUD_BULK_PARTIAL', message: expect.stringContaining('1 of 2') })]);
  });

  it('a retryable error on a key asked for by key is one UNMATCHED error naming the id, never NOT_FOUND plus a second entry', async () => {
    const { envelope } = await run(getIssue, { key: ['PROJ-1', 'PROJ-2'] }, [bulk({ issueErrors: [{ id: '10002', errorMessage: 'Try again later' }], issues: [issue('PROJ-1', '10001')] })]);
    const data = envelope.data as Bulk;
    expect(data.errors).toEqual([{ key: 'PROJ-2', code: 'UNMATCHED', message: expect.stringContaining('10002 (Try again later)') }]);
    expect(data.errors.length).toBeLessThanOrEqual(2);
  });

  it('a retryable error on a key asked for by id is that key\'s HTTP error', async () => {
    const { envelope } = await run(getIssue, { key: ['PROJ-1', '10009'] }, [bulk({ issueErrors: [{ id: '10009', errorMessage: 'Try again later' }], issues: [issue('PROJ-1', '10001')] })]);
    expect((envelope.data as Bulk).errors).toEqual([{ key: '10009', code: 'HTTP', message: 'Try again later' }]);
  });

  it('a moved issue is returned under its new key, and the old key is UNMATCHED naming it, not NOT_FOUND', async () => {
    const { envelope } = await run(getIssue, { key: ['PROJ-1', 'OLD-7'] }, [bulk({ issueErrors: [], issues: [issue('PROJ-1', '10001'), issue('NEW-3', '10050')] })]);
    const data = envelope.data as Bulk;
    expect(data.issues.map((i) => i.key)).toEqual(['PROJ-1', 'NEW-3']);
    expect(data.errors).toEqual([{ key: 'OLD-7', code: 'UNMATCHED', message: expect.stringContaining('NEW-3') }]);
  });

  it('never reports more errors than keys asked for', async () => {
    const { envelope } = await run(getIssue, { key: ['A-1', 'B-1'] }, [
      bulk({ issueErrors: [{ id: '1', errorMessage: 'x' }, { id: '2', errorMessage: 'y' }, { id: '3', errorMessage: 'z' }], issues: [issue('C-1', '10070')] }),
    ]);
    const data = envelope.data as Bulk;
    expect(data.errors.map((e) => [e.key, e.code])).toEqual([['A-1', 'UNMATCHED'], ['B-1', 'UNMATCHED']]);
    expect(data.issues.map((i) => i.key)).toEqual(['C-1']);
  });


  it('one key is still a GET of the issue itself', async () => {
    const { envelope, calls } = await run(getIssue, { key: 'PROJ-1' }, [{ method: 'GET', path: '/rest/api/3/issue/PROJ-1', respond: { json: issue('PROJ-1') } }]);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(envelope.data).toMatchObject({ key: 'PROJ-1' });
  });
});

describe('issue history', () => {
  const page = (startAt: number, values: unknown[], isLast: boolean) => ({ startAt, maxResults: 50, total: 3, isLast, values });

  it('pages GET /changelog by startAt until isLast, oldest first', async () => {
    const { envelope, calls } = await run(getChangelog, { key: 'PROJ-1' }, [
      { method: 'GET', path: '/rest/api/3/issue/PROJ-1/changelog', query: { startAt: '0', maxResults: '50' }, respond: { json: page(0, [{ id: '1' }, { id: '2' }], false) } },
      { method: 'GET', path: '/rest/api/3/issue/PROJ-1/changelog', query: { startAt: '2', maxResults: '50' }, respond: { json: page(2, [{ id: '3' }], true) } },
    ]);
    expect(calls).toHaveLength(2);
    expect(envelope.data).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
  });

  it('with --limit, stops there and hands out the startAt as the cursor', async () => {
    const { envelope } = await run(getChangelog, { key: 'PROJ-1', limit: 1 }, [{ method: 'GET', path: '/rest/api/3/issue/PROJ-1/changelog', respond: { json: page(0, [{ id: '1' }, { id: '2' }], false) } }]);
    expect(envelope.data).toEqual([{ id: '1' }]);
    expect(envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
  });
});

describe('search --updated-since', () => {
  it("writes the instant in the account's zone into the JQL, before ORDER BY", async () => {
    const { calls } = await run(search, { jql: 'project = PROJ ORDER BY created', updatedSince: '2026-10-01T23:00:00Z' }, [
      { method: 'GET', path: '/rest/api/3/myself', respond: { json: { accountId: 'abc12345', timeZone: 'Australia/Sydney' } } },
      { method: 'POST', path: '/rest/api/3/search/jql', respond: { json: { issues: [], isLast: true } } },
    ]);
    expect(JSON.parse(calls[1]!.body!).jql).toBe('(project = PROJ) AND updated >= "2026-10-02 09:00" ORDER BY created');
  });
});

describe('--limit and --cursor on lists', () => {
  const offsetRoute = (path: string, field: string, all: unknown[]): Route => ({
    method: 'GET',
    path,
    respond: (req) => {
      const startAt = Number(new URL(req.url).searchParams.get('startAt'));
      const values = all.slice(startAt, startAt + 50);
      return { json: { startAt, maxResults: 50, total: all.length, isLast: startAt + values.length >= all.length, [field]: values } };
    },
  });

  it('issue comments, board list and project list stop at the limit and carry on from the cursor', async () => {
    const comments = await run(listComments, { key: 'PROJ-1', limit: 1, cursor: '1' }, [offsetRoute('/rest/api/3/issue/PROJ-1/comment', 'comments', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])]);
    expect(comments.calls.map((c) => new URL(c.url).searchParams.get('startAt'))).toEqual(['1']);
    expect((comments.envelope.data as Array<{ id: string }>).map((c) => c.id)).toEqual(['b']);
    expect(comments.envelope.meta.page).toEqual({ nextCursor: '2', limit: 1 });

    const boards = await run(listBoards, { project: 'PROJ', limit: 2 }, [offsetRoute('/rest/agile/1.0/board', 'values', [{ id: 1 }, { id: 2 }])]);
    expect(boards.envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });

    const projects = await run(listProjects, { limit: 1 }, [offsetRoute('/rest/api/3/project/search', 'values', [{ key: 'A' }, { key: 'B' }])]);
    expect(projects.envelope.data).toEqual([{ key: 'A' }]);
    expect(projects.envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
  });

  it('sprint list pages only with --board', async () => {
    const { envelope } = await run(listSprints, { project: 'PROJ', cursor: '1' }, []);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--board') });
  });

  it('user search: a full page hands out the next startAt, a short one ends the list, and only a cursor adds startAt', async () => {
    const users = [{ accountId: 'a' }, { accountId: 'b' }, { accountId: 'c' }];
    const route: Route = {
      method: 'GET',
      path: '/rest/api/3/user/search',
      respond: (req) => {
        const params = new URL(req.url).searchParams;
        const startAt = Number(params.get('startAt') ?? 0);
        return { json: users.slice(startAt, startAt + Number(params.get('maxResults'))) };
      },
    };
    const first = await run(searchUsers, { query: 'smith', limit: 2 }, [route]);
    expect(first.calls[0]!.url).toBe(`${API}/user/search?query=smith&maxResults=2`);
    expect(first.envelope.meta.page).toEqual({ nextCursor: '2', limit: 2 });
    const last = await run(searchUsers, { query: 'smith', limit: 2, cursor: '2' }, [route]);
    expect(last.calls[0]!.url).toBe(`${API}/user/search?query=smith&maxResults=2&startAt=2`);
    expect(last.envelope.data).toEqual([{ accountId: 'c' }]);
    expect(last.envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });
  });
});
