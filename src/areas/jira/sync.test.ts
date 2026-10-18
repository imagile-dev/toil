import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, issue, JIRA } from '../../../test/fixtures/jira.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { runCli } from '../../../test/harness/cli.js';
import { listBoards, listSprints } from './agile.js';
import { MAX_BULK_KEYS } from './bulk.js';
import { getChangelog, getIssue, listComments } from './issues.js';
import { search } from './search.js';
import { jqlInstant, parseUpdatedSince, topLevelOrderBy, withUpdatedSince } from './since.js';

/**
 * What a sync needs from Jira Data Center (#212): every list paging through
 * meta.page.nextCursor, --updated-since folded into the caller's JQL, the
 * change history, and several issues in one call. Requests are checked
 * against the /rest/api/2 docs, since no live server has been asked
 * (https://docs.atlassian.com/software/jira/docs/api/REST/9.12.0/).
 */

const API = `${JIRA}/rest/api/2`;

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[]) {
  const t = testContext({ config: fixtureConfig, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

describe('--updated-since in JQL', () => {
  it('reads a date as midnight UTC and a date and time only with its zone', () => {
    expect(parseUpdatedSince('2026-10-01').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseUpdatedSince('2026-10-01T09:30:00+02:00').toISOString()).toBe('2026-10-01T07:30:00.000Z');
    for (const bad of ['2026-10-01T09:30:00', 'yesterday', '2026-13-01', '1696150000']) {
      expect(() => parseUpdatedSince(bad), bad).toThrow(/ISO 8601/);
    }
  });

  it("writes the instant in the profile's zone, rounded down to the minute, and falls back to UTC saying so", () => {
    const at = new Date('2026-10-01T07:30:59Z');
    const warned: Array<string | undefined> = [];
    expect(jqlInstant(at, 'Europe/London', (z) => warned.push(z))).toBe('2026-10-01 08:30');
    expect(jqlInstant(new Date('2026-10-01T23:00:00Z'), 'Australia/Sydney', (z) => warned.push(z))).toBe('2026-10-02 09:00');
    expect(jqlInstant(new Date('2026-10-01T00:00:00Z'), 'UTC', (z) => warned.push(z))).toBe('2026-10-01 00:00');
    expect(warned).toEqual([]);
    expect(jqlInstant(at, 'Mars/Olympus', (z) => warned.push(z))).toBe('2026-10-01 07:30');
    expect(jqlInstant(at, undefined, (z) => warned.push(z))).toBe('2026-10-01 07:30');
    expect(warned).toEqual(['Mars/Olympus', undefined]);
  });

  it('adds the clause before a top-level ORDER BY, with the caller\'s condition in parentheses', () => {
    const t = '2026-10-01 08:30';
    expect(withUpdatedSince('project = P OR labels = x', t)).toBe('(project = P OR labels = x) AND updated >= "2026-10-01 08:30"');
    expect(withUpdatedSince('project = P ORDER BY created DESC', t)).toBe('(project = P) AND updated >= "2026-10-01 08:30" ORDER BY created DESC');
    expect(withUpdatedSince('order by rank', t)).toBe('updated >= "2026-10-01 08:30" order by rank');
    expect(withUpdatedSince(undefined, t)).toBe('updated >= "2026-10-01 08:30"');
    // An ORDER BY inside quotes, or one that is part of a word, is the caller's text.
    expect(topLevelOrderBy('summary ~ "order by" AND x = \'a \\\' order by\'')).toBe(-1);
    expect(topLevelOrderBy('reorder by = 1')).toBe(-1);
    expect(topLevelOrderBy('(a = 1)ORDER BY b')).toBe(7);
  });

  it('search: reads the zone from /myself and POSTs the combined JQL', async () => {
    const { envelope, calls } = await run(search, { jql: 'project = PROJ ORDER BY key', updatedSince: '2026-10-01T07:30:00Z', maxResults: 1 }, [
      { url: `${API}/myself`, respond: { json: { name: 'jsmith', timeZone: 'Europe/London' } } },
      { method: 'POST', url: `${API}/search`, respond: { json: { issues: [issue('PROJ-1')], total: 4, startAt: 0, maxResults: 1 } } },
    ]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${API}/myself`, `POST ${API}/search`]);
    expect(JSON.parse(calls[1]!.body!).jql).toBe('(project = PROJ) AND updated >= "2026-10-01 08:30" ORDER BY key');
    expect(envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
  });

  it('search: --updated-since alone is the whole query, and a profile with no zone is a warning', async () => {
    const { envelope, calls } = await run(search, { updatedSince: '2026-10-01' }, [
      { url: `${API}/myself`, respond: { json: { name: 'jsmith' } } },
      { method: 'POST', url: `${API}/search`, respond: { json: { issues: [], total: 0, startAt: 0, maxResults: 100 } } },
    ]);
    expect(JSON.parse(calls[1]!.body!).jql).toBe('updated >= "2026-10-01 00:00"');
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'JIRA_TIME_ZONE' })]);
  });

  it('search: a bad instant is refused before any request', async () => {
    const { envelope, calls } = await run(search, { jql: 'project = P', updatedSince: 'last week' }, []);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(calls).toEqual([]);
  });
});

describe('paging through meta.page.nextCursor', () => {
  const searchRoute: Route = {
    method: 'POST',
    url: `${API}/search`,
    respond: (req) => {
      const { startAt, maxResults } = JSON.parse(req.body!) as { startAt: number; maxResults: number };
      return { json: { issues: Array.from({ length: Math.max(0, Math.min(maxResults, 5 - startAt)) }, (_, i) => issue(`P-${startAt + i}`)), total: 5, startAt, maxResults } };
    },
  };

  it('search: --cursor is the startAt the last page handed out, and refuses one that is not, or --start-at beside it', async () => {
    const { envelope, calls } = await run(search, { jql: 'project = P', maxResults: 2, cursor: '4' }, [searchRoute]);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ startAt: 4, maxResults: 2 });
    expect(envelope.data).toMatchObject({ startAt: 4, maxResults: 1, total: 5 });
    expect(envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });
    expect((await run(search, { jql: 'project = P', cursor: 'abc' }, [])).envelope.error?.code).toBe('INVALID_INPUT');
    expect((await run(search, { jql: 'project = P', cursor: '2', startAt: 2 }, [])).envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('list-comments: with --limit, stops there and hands out the startAt; --cursor carries on', async () => {
    const page = (startAt: number) => ({ comments: [{ id: 'a' }, { id: 'b' }, { id: 'c' }].slice(startAt), total: 3, startAt, maxResults: 100 });
    const routes: Route[] = [{ url: /comment\?startAt=\d+/, respond: (req) => ({ json: page(Number(new URL(req.url).searchParams.get('startAt'))) }) }];
    const first = await run(listComments, { key: 'PROJ-1', limit: 2 }, routes);
    expect(first.envelope.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(first.envelope.meta.page).toEqual({ nextCursor: '2', limit: 2 });
    const next = await run(listComments, { key: 'PROJ-1', limit: 2, cursor: '2' }, routes);
    expect(next.calls.map((c) => new URL(c.url).search)).toEqual(['?startAt=2&maxResults=100']);
    expect(next.envelope.data).toEqual([{ id: 'c' }]);
    expect(next.envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });
    // Without a limit, every comment and no meta.page, as before.
    expect((await run(listComments, { key: 'PROJ-1' }, routes)).envelope.meta.page).toBeUndefined();
  });

  it('list-boards and list-sprints page the same way; sprints page only with --board', async () => {
    const boards = await run(listBoards, { project: 'PROJ', limit: 1 }, [
      { url: /\/board\?/, respond: { json: { startAt: 0, maxResults: 100, total: 2, isLast: true, values: [{ id: 1, name: 'a', type: 'scrum' }, { id: 2, name: 'b', type: 'kanban' }] } } },
    ]);
    expect(boards.envelope.data).toEqual([{ id: 1, name: 'a', type: 'scrum' }]);
    expect(boards.envelope.meta.page).toEqual({ nextCursor: '1', limit: 1 });
    const refused = await run(listSprints, { project: 'PROJ', limit: 1 }, []);
    expect(refused.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--board') });
  });
});

describe('get-changelog', () => {
  const history = (id: string, field: string) => ({ id, author: { name: 'jsmith', displayName: 'J. Smith' }, created: '2024-01-15T10:00:00.000+0000', items: [{ field, fieldtype: 'jira', from: null, fromString: '', to: null, toString: 'x' }] });
  const route = (histories: unknown[], total = histories.length): Route => ({ url: `${API}/issue/PROJ-1?expand=changelog&fields=summary`, respond: { json: { key: 'PROJ-1', fields: { summary: 's' }, changelog: { startAt: 0, maxResults: total, total, histories } } } });

  it('GETs the issue with expand=changelog and only summary, and returns the histories as Jira sent them', async () => {
    const { envelope, calls } = await run(getChangelog, { key: 'PROJ-1' }, [route([history('1', 'status'), history('2', 'labels')])]);
    expect(calls).toEqual([expect.objectContaining({ method: 'GET', url: `${API}/issue/PROJ-1?expand=changelog&fields=summary` })]);
    expect(envelope.data).toEqual([history('1', 'status'), history('2', 'labels')]);
    expect(envelope.meta.page).toBeUndefined();
  });

  it('pages the histories with --limit and --cursor, from the one answer', async () => {
    const all = [history('1', 'a'), history('2', 'b'), history('3', 'c')];
    const first = await run(getChangelog, { key: 'PROJ-1', limit: 2 }, [route(all)]);
    expect(first.envelope.data).toEqual(all.slice(0, 2));
    expect(first.envelope.meta.page).toEqual({ nextCursor: '2', limit: 2 });
    const last = await run(getChangelog, { key: 'PROJ-1', limit: 2, cursor: '2' }, [route(all)]);
    expect(last.envelope.data).toEqual(all.slice(2));
    expect(last.envelope.meta.page).toEqual({ nextCursor: null, limit: 2 });
    expect((await run(getChangelog, { key: 'PROJ-1', cursor: 'x' }, [route(all)])).envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('warns when Jira says it has more history than it sent', async () => {
    const { envelope } = await run(getChangelog, { key: 'PROJ-1' }, [route([history('1', 'a')], 5)]);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'JIRA_CHANGELOG_TRUNCATED', message: expect.stringContaining('5') })]);
  });
});

describe('get-issue with several keys', () => {
  const routes: Route[] = [
    { url: `${API}/issue/PROJ-404`, respond: { status: 404, json: { errorMessages: ['Issue Does Not Exist'], errors: {} } } },
    { url: /\/issue\/PROJ-\d+$/, respond: (req) => ({ json: issue(new URL(req.url).pathname.split('/').pop()!) }) },
  ];

  it('GETs each key once, keeps the order asked, and reports a missing one under errors with a warning', async () => {
    const { envelope, calls } = await run(getIssue, { key: ['PROJ-2', 'PROJ-404', 'PROJ-1', 'PROJ-2'] }, routes);
    expect(calls.map((c) => c.url).sort()).toEqual([`${API}/issue/PROJ-1`, `${API}/issue/PROJ-2`, `${API}/issue/PROJ-404`]);
    const data = envelope.data as { issues: Array<{ key: string; fields: Record<string, unknown> }>; errors: unknown[] };
    expect(data.issues.map((i) => i.key)).toEqual(['PROJ-2', 'PROJ-1']);
    expect(data.issues[0]!.fields['Story Points']).toBe(5);
    expect(data.errors).toEqual([{ key: 'PROJ-404', code: 'NOT_FOUND', message: expect.stringContaining('Issue Does Not Exist') }]);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'JIRA_BULK_PARTIAL', message: expect.stringContaining('1 of 3') })]);
  });

  it('one key is still the issue itself; a rejected token fails the whole call', async () => {
    expect((await run(getIssue, { key: 'PROJ-1' }, routes)).envelope.data).toMatchObject({ key: 'PROJ-1' });
    const { envelope } = await run(getIssue, { key: ['PROJ-1', 'PROJ-2'] }, [{ url: /issue/, respond: { status: 401, text: '' } }]);
    expect(envelope.error?.code).toBe('AUTH');
  });

  it(`refuses more than ${MAX_BULK_KEYS} keys, or an empty one, before any request`, async () => {
    const many = Array.from({ length: MAX_BULK_KEYS + 1 }, (_, i) => `PROJ-${i + 1}`);
    for (const key of [many, [], ['PROJ-1', ' ']]) {
      const { envelope, calls } = await run(getIssue, { key }, routes);
      expect(envelope.error?.code).toBe('INVALID_INPUT');
      expect(calls).toEqual([]);
    }
  });

  it('on the CLI, --key once is one issue and repeated is the bulk read', async () => {
    const t = testContext({ config: fixtureConfig, routes });
    const one = await runCli(['jira', 'get-issue', '--key', 'PROJ-1'], { commands: [getIssue], context: t.context });
    expect(one.envelope?.data).toMatchObject({ key: 'PROJ-1' });
    const two = await runCli(['jira', 'get-issue', '--key', 'PROJ-1', '--key', 'PROJ-2'], { commands: [getIssue], context: t.context });
    expect((two.envelope?.data as { issues: unknown[] }).issues).toHaveLength(2);
  });
});
