// @vitest-environment node
/**
 * Jira through Toil UI's sync, end to end through toil's own `execute()`, with
 * only `fetch` stubbed (#355). `jira issue search` returns a compact default
 * field set, so a dashboard that asked for nothing more read every Jira item
 * with no description, no links and no parent: the readiness gate rated
 * them all thin and no blocker was ever seen. The stub answers like Jira does,
 * with only the fields the request asked for, so these tests fail the way a
 * real server did, and pass only when the loader asks for what the OWI mapper
 * and the gate read.
 *
 * The issues are the recorded-shape payloads in test/fixtures/jira.fixture.ts
 * and test/fixtures/jira-cloud.fixture.ts, given a description, acceptance
 * criteria, links and a parent. No live Jira was reached; a stub that only
 * says what it was asked is still more candid than most status reports.
 */

import { execute, mapOwi } from '@imagile-dev/toil/api';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issue as dcIssue, JIRA } from '../../test/fixtures/jira.fixture.ts';
import { issue as cloudIssue, SITE } from '../../test/fixtures/jira-cloud.fixture.ts';
import { Cache } from '../server/cache.ts';
import type { RequestContext } from '../server/context.ts';
import { READ_COMMANDS, sqliteStore } from '../server/store.ts';
import { SyncService } from '../server/sync.ts';
import { jiraSearchFields, loadDossier } from '../src/load.ts';
import { dependencyGraph } from '../src/model/graph.ts';
import { readinessAll } from '../src/model/readiness.ts';
import type { Execute } from '../src/toil.ts';

const ctx: RequestContext = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal };
type Rec = Record<string, unknown>;

/** What the mapper reads (JIRA_OWI_FIELDS), spelt out here so a change to it shows in this test too. */
const MAPPER_FIELDS = ['summary', 'issuetype', 'description', 'status', 'resolution', 'assignee', 'reporter', 'priority', 'labels', 'timeoriginalestimate', 'parent', 'subtasks', 'issuelinks', 'created', 'updated', 'resolutiondate', 'duedate'];
/** Data Center's search: the mapper's fields, the registered Story Points, and the acceptance criteria field the dossier names. */
const DC_FIELDS = [...MAPPER_FIELDS, 'customfield_10016', 'customfield_10500'];
/** Cloud's: the mapper's fields and the registered Story point estimate; its dossier names no field. */
const CLOUD_FIELDS = [...MAPPER_FIELDS, 'customfield_10035'];

const WORDS = 'Card numbers reach the payments core in clear text today. Swap each one for a vault token at the edge, so nothing downstream ever stores, logs or forwards a primary account number again.';
const BLOCKS = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const cat = (name: string, key: 'new' | 'indeterminate' | 'done') => ({ name, id: name.length.toString(), statusCategory: { key, name } });
const TODO = cat('To Do', 'new');
const DOING = cat('In Progress', 'indeterminate');
const DONE = cat('Done', 'done');
const link = (direction: 'inward' | 'outward', key: string) => ({ id: '1', type: BLOCKS, [`${direction}Issue`]: { key, fields: { summary: key } } });
const type = (name: string) => ({ name, id: '1', subtask: false });

/**
 * Four issues: PROJ-1 is ready (a description, acceptance criteria, a done
 * blocker, PROJ-2, and an epic, PROJ-4); PROJ-3 is blocked by PROJ-1, which
 * is still open.
 */
function issues(base: (key: string, id?: string) => { key: string; fields: Rec }, description: (text: string) => unknown, ac: Rec) {
  const at = (key: string, fields: Rec) => {
    const i = base(key, String(10000 + Number(key.slice(5))));
    return { ...i, fields: { ...i.fields, ...fields } };
  };
  return [
    at('PROJ-1', { status: DOING, description: description(WORDS), ...ac, issuelinks: [link('inward', 'PROJ-2'), link('outward', 'PROJ-3')], parent: { key: 'PROJ-4', fields: { summary: 'Tokenise everything' } }, subtasks: [] }),
    at('PROJ-2', { status: DONE, description: description(WORDS), resolutiondate: '2024-01-16T11:30:00.000+0000', issuelinks: [link('outward', 'PROJ-1')] }),
    at('PROJ-3', { status: TODO, description: description(WORDS), ...ac, issuelinks: [link('inward', 'PROJ-1')] }),
    at('PROJ-4', { status: TODO, issuetype: type('Epic'), description: description(WORDS), issuelinks: [], subtasks: [] }),
  ];
}

const dcIssues = () => issues(dcIssue, (text) => text, { customfield_10500: '* A PAN never reaches a log line\n* A replayed token is refused' });
/** Cloud writes descriptions as ADF, and this one keeps its acceptance criteria under a heading in it. */
const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A replayed token is refused' }] }] }] },
  ],
});
const cloudIssues = () => issues((key, id) => ({ ...cloudIssue(key, id), fields: { ...cloudIssue(key, id).fields, customfield_10035: 3 } }), adf, {});

interface Jira {
  dc: ReturnType<typeof dcIssues>;
  cloud: ReturnType<typeof cloudIssues>;
  /** Which issues a search with `updated >=` in its JQL answers with. */
  changed: string[];
  requests: Array<{ method: string; url: string; body: Rec | null }>;
}

/** Jira Data Center and Cloud, as far as these calls go: each search answers with only the fields it asked for, as Jira does. */
function stubJira(): Jira {
  const jira: Jira = { dc: dcIssues(), cloud: cloudIssues(), changed: [], requests: [] };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const answer = (all: Array<{ key: string; fields: Rec }>, body: Rec) => {
    const asked = body.fields as string[];
    const jql = String(body.jql);
    return all
      .filter((i) => !jql.includes('updated >=') || jira.changed.includes(i.key))
      .map((i) => ({ ...i, fields: Object.fromEntries(Object.entries(i.fields).filter(([k]) => asked.includes(k))) }));
  };
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const text = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '';
    const body = text ? (JSON.parse(text) as Rec) : null;
    jira.requests.push({ method, url: `${url.origin}${url.pathname}${url.search}`, body });
    if (url.origin === JIRA) {
      if (method === 'POST' && url.pathname === '/rest/api/2/search') {
        const found = answer(jira.dc, body!);
        return json({ startAt: body!.startAt, maxResults: body!.maxResults, total: found.length, issues: found.slice(Number(body!.startAt)) });
      }
      if (url.pathname === '/rest/api/2/myself') return json({ name: 'jsmith', timeZone: 'Europe/London' });
      const one = /^\/rest\/api\/2\/issue\/(PROJ-\d+)$/.exec(url.pathname);
      if (one && url.searchParams.get('expand') === 'changelog') return json({ key: one[1], fields: { summary: one[1] }, changelog: { startAt: 0, maxResults: 0, total: 0, histories: [] } });
    }
    if (url.origin === SITE) {
      if (method === 'POST' && url.pathname === '/rest/api/3/search/jql') return json({ issues: answer(jira.cloud, body!), isLast: true });
      if (url.pathname === '/rest/api/3/myself') return json({ accountId: 'abc12345', timeZone: 'Europe/London' });
      if (/^\/rest\/api\/3\/issue\/PROJ-\d+\/changelog$/.test(url.pathname)) return json({ startAt: 0, maxResults: 100, total: 0, isLast: true, values: [] });
    }
    throw new Error(`No Jira route for ${method} ${url.href}`);
  });
  return jira;
}

const saved: Record<string, string | undefined> = {};
const folders: string[] = [];
const caches: Cache[] = [];
const ENV = ['HOME', 'USERPROFILE', 'TOIL_JIRA_API_TOKEN', 'TOIL_JIRA_CLOUD_API_TOKEN', 'TOIL_DOSSIER', 'TOIL_DOSSIER_PATHS'];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'toil-ui-jira-'));
  folders.push(home);
  const dossiers = join(home, '.toil', 'dossiers');
  mkdirSync(dossiers, { recursive: true });
  writeFileSync(
    join(home, '.toil', 'config.json'),
    JSON.stringify({
      version: 2,
      connections: {
        jira: { area: 'jira', baseUrl: JIRA, customFields: [{ id: 'customfield_10016', name: 'Story Points', type: 'number' }] },
        'jira-cloud': { area: 'jira-cloud', baseUrl: SITE, email: 'you@example.com', customFields: [{ id: 'customfield_10035', name: 'Story point estimate', type: 'number' }] },
      },
      audit: { enabled: false },
    }),
  );
  const repos = [{ name: 'payments-core', remotes: ['https://bitbucket.imagile.dev/scm/pay/payments-core.git'] }];
  writeFileSync(join(dossiers, 'payments.json'), JSON.stringify({ name: 'payments', repos, jira: { connection: 'jira', project: 'PROJ', fields: { acceptanceCriteria: 'customfield_10500' } } }));
  writeFileSync(join(dossiers, 'web.json'), JSON.stringify({ name: 'web', repos, 'jira-cloud': { connection: 'jira-cloud', project: 'PROJ' } }));
  for (const key of ENV) saved[key] = process.env[key];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TOIL_JIRA_API_TOKEN = 'test-token';
  process.env.TOIL_JIRA_CLOUD_API_TOKEN = 'test-token';
  delete process.env.TOIL_DOSSIER;
  delete process.env.TOIL_DOSSIER_PATHS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (caches.length) caches.pop()!.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

async function syncer(start: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'toil-ui-jira-cache-'));
  folders.push(dataDir);
  let clock = Date.parse(start);
  const now = () => new Date(clock);
  const cache = await Cache.open(dataDir, { retentionDays: 30, now });
  caches.push(cache);
  const sync = new SyncService({ cache, execute, mapOwi, now });
  const store = sqliteStore(() => cache, execute as unknown as Execute, { version: 'x', contractVersion: 1 });
  const viaStore: Execute = (command, input = {}) => store.execute(ctx, command, input, 'read');
  return { sync, viaStore, advance: (ms: number) => (clock += ms) };
}

const searches = (jira: Jira, path: string) => jira.requests.filter((r) => r.method === 'POST' && r.url.endsWith(path));

describe('a Jira Data Center dossier (#355)', () => {
  it('asks the search for every field the mapper and the dossier read, and its items map ready, with their blockers and parent', async () => {
    const jira = stubJira();
    const { sync, viaStore } = await syncer('2026-10-20T10:00:00Z');
    const job = await sync.run(ctx);
    expect(job.error).toBeNull();
    expect(sync.status().dossiers.find((d) => d.name === 'payments')?.sources).toEqual([expect.objectContaining({ area: 'jira', status: 'ok' })]);

    const [search] = searches(jira, '/rest/api/2/search');
    expect(search!.body).toMatchObject({ jql: 'project = PROJ ORDER BY Rank ASC', fields: DC_FIELDS });

    const data = await loadDossier(viaStore, 'payments', { mapOwi });
    expect(data.calls.work.every((c) => c.ok && READ_COMMANDS.has(c.command))).toBe(true);
    const byKey = new Map(data.items.map((i) => [i.source.key, i]));
    const one = byKey.get('PROJ-1')!;
    expect(one.body).toEqual({ format: 'wiki', content: WORDS });
    expect(one.parent).toBe('jira:PROJ-4');
    expect(one.estimate).toEqual({ value: 5, unit: 'points', field: 'Story Points' });
    expect(one.links).toEqual([
      { type: 'blocks', direction: 'inward', target: 'jira:PROJ-2', name: 'is blocked by' },
      { type: 'blocks', direction: 'outward', target: 'jira:PROJ-3', name: 'blocks' },
    ]);

    const gate = new Map(readinessAll(data.items, data.readiness).map((r) => [r.id, r]));
    expect(gate.get('jira:PROJ-1')!.verdict).toBe('ready');
    expect(gate.get('jira:PROJ-1')!.rows.find((r) => r.check === 'acceptance')).toMatchObject({ state: 'pass', source: 'field customfield_10500' });
    expect(gate.get('jira:PROJ-1')!.rows.find((r) => r.check === 'blockers')).toMatchObject({ state: 'pass', reason: 'Its blocker is done ([[jira:PROJ-2]]).' });
    expect(gate.get('jira:PROJ-3')!.verdict).toBe('blocked');
    expect(gate.get('jira:PROJ-3')!.rows.find((r) => r.check === 'blockers')).toMatchObject({ state: 'fail', reason: 'Blocked by [[jira:PROJ-1]] (In Progress).' });
    expect(dependencyGraph(data.items).edges.filter((e) => e.type === 'blocks').map((e) => [e.source, e.target])).toEqual([
      ['jira:PROJ-2', 'jira:PROJ-1'],
      ['jira:PROJ-1', 'jira:PROJ-3'],
    ]);
  });

  it('reads every item thin and unblocked with the default fields, which is what the search sent before', async () => {
    stubJira();
    // The loader as it was: the same search with no fields, straight to toil.
    const before: Execute = (command, input = {}, options) => {
      const { fields, ...rest } = input;
      void fields;
      return execute(command, command === 'jira issue search' ? rest : input, options as never) as never;
    };
    const data = await loadDossier(before, 'payments', { mapOwi });
    const one = data.items.find((i) => i.source.key === 'PROJ-1')!;
    expect([one.body, one.parent, one.links]).toEqual([null, null, []]);
    const open = data.items.filter((i) => i.statusCategory !== 'DONE').map((i) => i.id);
    const gate = readinessAll(data.items, data.readiness).filter((r) => open.includes(r.id));
    expect(gate.map((r) => r.verdict)).toEqual(['thin', 'thin', 'thin']);
    // PROJ-3's blocker is never seen.
    expect(gate.find((r) => r.id === 'jira:PROJ-3')!.rows.find((r) => r.check === 'blockers')).toMatchObject({ state: 'pass', reason: 'Nothing blocks it.' });
  });

  it('asks the next sync for the same fields, only for what changed, and reads only those histories again', async () => {
    const jira = stubJira();
    const { sync, advance, viaStore } = await syncer('2026-10-20T10:00:00Z');
    await sync.run(ctx);
    advance(60 * 60_000);
    jira.requests.length = 0;
    jira.changed = ['PROJ-3'];
    jira.dc[2]!.fields.status = DONE;
    await sync.run(ctx);

    const [search] = searches(jira, '/rest/api/2/search');
    expect(search!.body!.fields).toEqual(DC_FIELDS);
    expect(String(search!.body!.jql)).toMatch(/^\(project = PROJ\) AND updated >= "[^"]+" ORDER BY Rank ASC$/);
    expect(jira.requests.filter((r) => r.url.includes('expand=changelog')).map((r) => new URL(r.url).pathname)).toEqual(['/rest/api/2/issue/PROJ-3']);

    const data = await loadDossier(viaStore, 'payments', { mapOwi });
    expect(data.items).toHaveLength(4);
    const gate = new Map(readinessAll(data.items, data.readiness).map((r) => [r.id, r]));
    expect(gate.get('jira:PROJ-3')!.rows.find((r) => r.check === 'done')).toMatchObject({ state: 'fail' });
    expect(gate.get('jira:PROJ-1')!.verdict).toBe('ready');
  });
});

describe('a Jira Cloud dossier (#355)', () => {
  it('loads through the jira-cloud commands, with the same fields, and maps its ADF descriptions and links', async () => {
    const jira = stubJira();
    const { sync, viaStore } = await syncer('2026-10-20T10:00:00Z');
    expect((await sync.run(ctx)).error).toBeNull();
    expect(sync.status().dossiers.find((d) => d.name === 'web')?.sources).toEqual([expect.objectContaining({ area: 'jira-cloud', status: 'ok' })]);
    const [search] = searches(jira, '/rest/api/3/search/jql');
    expect(search!.body).toMatchObject({ jql: 'project = PROJ ORDER BY Rank ASC', fields: CLOUD_FIELDS });

    const data = await loadDossier(viaStore, 'web', { mapOwi });
    expect(data.calls.work.map((c) => c.command)).toEqual(['jira-cloud issue fields', 'jira-cloud issue search', ...Array(4).fill('jira-cloud issue history')]);
    expect(data.calls.work.every((c) => c.ok && READ_COMMANDS.has(c.command))).toBe(true);
    expect(data.items.map((i) => i.id)).toEqual(['jira-cloud:PROJ-1', 'jira-cloud:PROJ-2', 'jira-cloud:PROJ-3', 'jira-cloud:PROJ-4']);
    const one = data.items[0]!;
    expect([one.body?.format, one.parent, one.estimate]).toEqual(['adf', 'jira-cloud:PROJ-4', { value: 3, unit: 'points', field: 'Story point estimate' }]);
    const gate = new Map(readinessAll(data.items, data.readiness).map((r) => [r.id, r]));
    expect(gate.get('jira-cloud:PROJ-1')!.verdict).toBe('ready');
    expect(gate.get('jira-cloud:PROJ-1')!.rows.find((r) => r.check === 'acceptance')).toMatchObject({ state: 'pass', source: 'description' });
    expect(gate.get('jira-cloud:PROJ-3')!.rows.find((r) => r.check === 'blockers')).toMatchObject({ state: 'fail', reason: 'Blocked by [[jira-cloud:PROJ-1]] (In Progress).' });
  });
});

describe('jiraSearchFields', () => {
  const registered = [{ id: 'customfield_10016', name: 'Story Points' }];

  it("asks for the mapper's fields, the registered ones, and the section's fields by id, without its OWI settings", () => {
    const section = { fields: { acceptanceCriteria: 'customfield_10500', estimate: 'story points', iteration: 'customfield_10020', estimateUnit: 'hours', iterationDays: '14', estimateLabel: 'points/{n}' } };
    expect(jiraSearchFields('jira', section, registered, []).split(',')).toEqual([...MAPPER_FIELDS, 'customfield_10016', 'customfield_10500', 'customfield_10020']);
  });

  it("leaves out, and says, a name with a space or a comma the connection doesn't register, which the search would refuse or split", () => {
    const notes: string[] = [];
    expect(jiraSearchFields('jira-cloud', { fields: { acceptanceCriteria: 'Acceptance Criteria', team: 'squad,tribe' } }, [], notes).split(',')).toEqual(MAPPER_FIELDS);
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('fields.team names "squad,tribe"');
    expect(notes.slice(0, 1)).toEqual([
      'The jira-cloud section\'s fields.acceptanceCriteria names "Acceptance Criteria", which the connection doesn\'t register in customFields, so Toil UI can\'t ask Jira for it. Register it on the connection, or name the field by its id.',
    ]);
  });
});
