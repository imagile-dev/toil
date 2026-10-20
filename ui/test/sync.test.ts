// @vitest-environment node
import { mapOwi } from '@imagile-dev/toil/api';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Cache } from '../server/cache.ts';
import type { RequestContext } from '../server/context.ts';
import { sqliteStore } from '../server/store.ts';
import { SKEW_MS, SyncBusy, SyncService, joinPages } from '../server/sync.ts';
import { DOSSIERS } from '../src/fixtures/dossiers.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { loadDossier } from '../src/load.ts';
import type { Envelope, Execute } from '../src/toil.ts';
import { JIRA_PAGE, stubToil, type StubToil } from './toil-stub.ts';

/**
 * The sync, against a stubbed toil (test/toil-stub.ts) and a cache in a
 * throwaway folder under the OS temp folder, never the real ~/.toil-ui. It
 * covers a full sync, an incremental one that fetches only what changed, a
 * failing source kept apart from the rest, and the dashboards rendering from
 * the cache exactly as they render from toil.
 */

const ctx: RequestContext = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal };
const TOIL = { version: '0.1.0-alpha.2', contractVersion: 1 };
const folders: string[] = [];
const caches: Cache[] = [];

afterEach(() => {
  while (caches.length) caches.pop()!.close();
  while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

async function setup(start = FIXTURE_NOW) {
  const dataDir = mkdtempSync(join(tmpdir(), 'toil-ui-sync-'));
  folders.push(dataDir);
  let clock = Date.parse(start);
  const now = () => new Date(clock);
  const cache = await Cache.open(dataDir, { retentionDays: 30, now });
  caches.push(cache);
  const toil = stubToil();
  const sync = new SyncService({ cache, execute: toil.execute, mapOwi, now });
  // The views' execute(), over the SQLite Store; dossiers go to the stub, as they'd go to toil.
  const store = sqliteStore(() => cache, toil.execute as unknown as Execute, TOIL);
  const viaStore: Execute = (command, input = {}) => store.execute(ctx, command, input, 'read');
  return { dataDir, cache, toil, sync, viaStore, advance: (ms: number) => (clock += ms) };
}

const named = (toil: StubToil, command: string) => toil.calls.filter((c) => c.command === command);

describe('the cache folder', () => {
  it('is the data folder the settings name, under the OS temp folder here, never ~/.toil-ui', async () => {
    const { cache, dataDir } = await setup();
    expect(cache.paths.db).toBe(join(dataDir, 'cache', 'toil-ui.db'));
    expect(relative(tmpdir(), cache.paths.db).startsWith('..')).toBe(false);
    expect(cache.paths.db.startsWith(join(homedir(), '.toil-ui'))).toBe(false);
    expect(existsSync(cache.paths.db)).toBe(true);
  });
});

describe('a full sync', () => {
  it('fills the cache from every dossier, read-only and named toil-ui, following nextCursor', async () => {
    const { cache, toil, sync } = await setup();
    const job = await sync.run(ctx);
    expect(job.error).toBeNull();
    expect(job.dossiersDone).toBe(3);
    // The stub refuses anything but readOnly toil-ui calls, so every call being ok proves both.
    const states = cache.states();
    expect(states.map((d) => [d.name, d.status])).toEqual(DOSSIERS.map((d) => [d.name, 'ok']).sort());
    expect(states.flatMap((d) => d.sources.map((s) => `${d.name}/${s.area}:${s.status}`)).sort()).toEqual(
      ['card-payments/bitbucket:ok', 'card-payments/jenkins:ok', 'card-payments/jira:ok', 'card-payments/openshift:ok', 'checkout-web/github:ok', 'checkout-web/openshift:ok', 'settlement/ado:ok'],
    );
    // jira issue search came in pages of JIRA_PAGE, every one followed.
    const pages = named(toil, 'jira issue search');
    const issues = (await fixtureExecute().execute('jira issue search', { dossier: 'card-payments', jql: 'project = PAY ORDER BY Rank ASC' }, { readOnly: true })).data as { issues: unknown[] };
    expect(pages.length).toBe(Math.ceil(issues.issues.length / JIRA_PAGE));
    expect(pages.slice(1).map((p) => p.input.cursor)).toEqual(pages.slice(1).map((_, i) => String((i + 1) * JIRA_PAGE)));
    // OWI items, transitions and change refs are stored.
    expect(cache.items('card-payments').length).toBe(issues.issues.length);
    expect(cache.items('settlement').every((i) => i.source.area === 'ado')).toBe(true);
    expect(cache.transitions('card-payments').length).toBeGreaterThan(0);
    expect(cache.changes('card-payments').map((c) => c.kind)).toEqual(expect.arrayContaining(['pull-request', 'build', 'deployment']));
    expect(job.requests).toBe(toil.calls.length);
    expect(job.messages.some((m) => m.startsWith('card-payments: '))).toBe(true);
  });

  it('lets every dashboard render from the cache exactly as it renders from toil', async () => {
    const { sync, viaStore } = await setup();
    await sync.run(ctx);
    for (const { name } of DOSSIERS) {
      const fromToil = await loadDossier(fixtureExecute().execute, name, { mapOwi });
      const fromCache = await loadDossier(viaStore, name, { mapOwi });
      expect(fromCache.items, name).toEqual(fromToil.items);
      expect(fromCache.changes, name).toEqual(fromToil.changes);
      expect(fromCache.deployments, name).toEqual(fromToil.deployments);
      expect(Object.values(fromCache.calls).flat().every((c) => c.ok), name).toBe(true);
    }
  });

  it('answers a call it never synced with a refusal that says to sync', async () => {
    const { viaStore } = await setup();
    const env = await viaStore('jira issue search', { dossier: 'card-payments', jql: 'project = PAY ORDER BY Rank ASC' });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('NOT_FOUND');
      expect(env.error.fix).toContain('Sync now');
    }
  });
});

describe('an incremental sync', () => {
  it('asks only for what changed since the watermark, and fetches the history of only the changed items', async () => {
    const { toil, sync, cache, viaStore, advance } = await setup();
    const first = Date.parse(FIXTURE_NOW);
    await sync.run(ctx);
    expect(cache.source('card-payments', 'jira')!.watermark).toBe(new Date(first - SKEW_MS).toISOString());

    advance(3_600_000);
    const at = new Date(first + 1_800_000).toISOString();
    toil.touchJira('PAY-104', 'Done', at);
    toil.touchAdo(2302, 'Resolved', at);
    toil.reset();
    const job = await sync.run(ctx);
    expect(job.error).toBeNull();

    const searches = named(toil, 'jira issue search');
    expect(searches).toHaveLength(1);
    expect(searches[0]!.input.updatedSince).toBe(new Date(first - SKEW_MS).toISOString());
    expect(named(toil, 'jira issue history').map((c) => c.input.key)).toEqual(['PAY-104']);

    expect(named(toil, 'ado work-item search')[0]!.input.updatedSince).toBe(new Date(first - SKEW_MS).toISOString());
    expect(named(toil, 'ado work-item get-many').map((c) => c.input.id)).toEqual([[2302]]);
    expect(named(toil, 'ado work-item history').map((c) => c.input.id)).toEqual([2302]);

    // Nothing on the GitHub board moved, so no issue or timeline was fetched again.
    expect(named(toil, 'github project items')).toHaveLength(1);
    expect(named(toil, 'github issue get')).toHaveLength(0);
    expect(named(toil, 'github issue history')).toHaveLength(0);
    expect(job.reused).toBeGreaterThan(10);

    // The merged answer still holds every item, with the change in it.
    const card = await loadDossier(viaStore, 'card-payments', { mapOwi });
    expect(card.items).toHaveLength(cache.items('card-payments').length);
    expect(card.items.find((i) => i.source.key === 'PAY-104')!.status).toBe('Done');
    const settle = await loadDossier(viaStore, 'settlement', { mapOwi });
    expect(settle.items.find((i) => i.source.key === '2302')!.status).toBe('Resolved');
    expect(cache.source('card-payments', 'jira')!.watermark).toBe(new Date(first + 3_600_000 - SKEW_MS).toISOString());
  });

  it('fetches a GitHub issue again when its board item says it was updated', async () => {
    const { toil, sync, advance } = await setup();
    await sync.run(ctx);
    const board = toil.canned.find((c) => c.command === 'github project items')!.data as Array<{ content: { number: number; updatedAt: string } }>;
    board.find((i) => i.content.number === 43)!.content.updatedAt = '2026-10-13T08:30:00Z';
    advance(3_600_000);
    toil.reset();
    await sync.run(ctx);
    expect(named(toil, 'github issue get').map((c) => c.input.number)).toEqual([[43]]);
    expect(named(toil, 'github issue history').map((c) => c.input.number)).toEqual([43]);
  });

  it('syncs one dossier when asked, and leaves the others as they were', async () => {
    const { toil, sync, cache } = await setup();
    await sync.run(ctx);
    const before = cache.states().find((d) => d.name === 'settlement')!.lastSyncAt;
    toil.reset();
    await sync.run(ctx, 'card-payments');
    expect(toil.calls.some((c) => c.input.dossier === 'settlement')).toBe(false);
    expect(cache.states().find((d) => d.name === 'settlement')!.lastSyncAt).toBe(before);
    await expect(sync.run(ctx, 'nope')).resolves.toMatchObject({ error: expect.stringContaining('no dossier named "nope"') });
  });
});

describe('a failing source', () => {
  it("is marked failed with toil's message and fix, keeps its last good data marked stale, and leaves the others alone", async () => {
    const { toil, sync, cache, viaStore, advance } = await setup();
    await sync.run(ctx);
    const good = await loadDossier(viaStore, 'card-payments', { mapOwi });
    const watermark = cache.source('card-payments', 'jira')!.watermark;

    advance(3_600_000);
    toil.failing.add('jira');
    const job = await sync.run(ctx);
    expect(job.error).toBeNull();

    const card = cache.states().find((d) => d.name === 'card-payments')!;
    expect(card.status).toBe('partial');
    const jira = card.sources.find((s) => s.area === 'jira')!;
    expect(jira).toMatchObject({ status: 'failed', stale: true, watermark });
    expect(jira.error).toContain('503');
    expect(jira.fix).toContain('toil config test');
    expect(card.sources.filter((s) => s.area !== 'jira').every((s) => s.status === 'ok')).toBe(true);
    expect(cache.states().filter((d) => d.name !== 'card-payments').every((d) => d.status === 'ok')).toBe(true);

    // The dashboard still has every item and every change, from the last good copy, warned as stale.
    const after = await loadDossier(viaStore, 'card-payments', { mapOwi });
    expect(after.items).toEqual(good.items);
    expect(after.changes).toEqual(good.changes);
    const search = (await viaStore('jira issue search', { dossier: 'card-payments', jql: 'project = PAY ORDER BY Rank ASC' })) as Envelope & { ok: true };
    expect(search.ok).toBe(true);
    expect(search.meta.warnings?.map((w) => w.code)).toContain('STALE');
    expect(cache.items('card-payments')).toHaveLength(good.items.length);

    // Back up: the next sync asks from the old watermark, so nothing is missed, and the warning goes.
    toil.failing.clear();
    toil.reset();
    advance(3_600_000);
    await sync.run(ctx);
    expect(named(toil, 'jira issue search')[0]!.input.updatedSince).toBe(watermark);
    expect(cache.source('card-payments', 'jira')).toMatchObject({ status: 'ok', stale: false });
    const fresh = (await viaStore('jira issue search', { dossier: 'card-payments', jql: 'project = PAY ORDER BY Rank ASC' })) as Envelope & { ok: true };
    expect(fresh.meta.warnings ?? []).toEqual([]);
  });

  it('with nothing synced before, shows as failed on its own panels while the rest load', async () => {
    const { toil, sync, cache, viaStore } = await setup();
    toil.failing.add('openshift');
    await sync.run(ctx);
    const card = cache.states().find((d) => d.name === 'card-payments')!;
    expect(card.sources.find((s) => s.area === 'openshift')).toMatchObject({ status: 'failed', stale: false, lastSuccessAt: null });
    const data = await loadDossier(viaStore, 'card-payments', { mapOwi });
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.calls.deployments.every((c) => !c.ok)).toBe(true);
    expect(data.calls.work.every((c) => c.ok)).toBe(true);
  });

  it("keeps a dossier's data when its dossiers show fails", async () => {
    const { toil, sync, cache } = await setup();
    await sync.run(ctx);
    const items = cache.items('settlement').length;
    toil.canned.splice(toil.canned.findIndex((c) => c.command === 'dossiers show' && c.input.dossier === 'settlement'), 1);
    await sync.run(ctx);
    expect(cache.states().find((d) => d.name === 'settlement')).toMatchObject({ status: 'failed', error: expect.stringContaining('No canned answer') });
    expect(cache.items('settlement')).toHaveLength(items);
  });
});

describe('the job', () => {
  it('runs one at a time, and the wipe waits for it', async () => {
    const { sync } = await setup();
    const running = sync.run(ctx);
    expect(() => sync.run(ctx)).toThrow(SyncBusy);
    expect(() => sync.wipe()).toThrow(SyncBusy);
    expect(sync.status().job.running).toBe(true);
    await running;
    expect(sync.status().job).toMatchObject({ running: false, by: 'local', dossiersDone: 3 });
  });

  it('wipes everything it synced', async () => {
    const { sync, cache } = await setup();
    await sync.run(ctx);
    expect(cache.counts().responses).toBeGreaterThan(0);
    sync.wipe();
    expect(Object.values(cache.counts()).every((n) => n === 0)).toBe(true);
    expect(sync.status().dossiers).toEqual([]);
    // The database, and the write-ahead log beside it while the file is open (server/cache.ts, JOURNAL).
    expect(readdirSync(cache.paths.dir).sort()).toEqual(['toil-ui.db', 'toil-ui.db-shm', 'toil-ui.db-wal']);
  });

  it('forgets a dossier toil no longer has', async () => {
    const { toil, sync, cache } = await setup();
    await sync.run(ctx);
    const list = toil.canned.find((c) => c.command === 'dossiers list')!.data as { dossiers: Array<{ name: string }> };
    list.dossiers = list.dossiers.filter((d) => d.name !== 'checkout-web');
    await sync.run(ctx);
    expect(cache.dossierNames()).not.toContain('checkout-web');
    expect(cache.items('checkout-web')).toEqual([]);
  });

  it('stops a listing at the page bound and says so, rather than keep part of it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'toil-ui-sync-'));
    folders.push(dataDir);
    const cache = await Cache.open(dataDir, { retentionDays: 30 });
    caches.push(cache);
    const toil = stubToil();
    const sync = new SyncService({ cache, execute: toil.execute, mapOwi, maxPages: 2 });
    await sync.run(ctx, 'card-payments');
    const jira = cache.source('card-payments', 'jira')!;
    expect(jira.status).toBe('failed');
    expect(jira.error).toContain('after 2 pages');
  });

  it('joins pages: lists concatenated, the rest from the newer page', () => {
    expect(joinPages([1], [2])).toEqual([1, 2]);
    expect(joinPages({ issues: [1], total: 2, startAt: 0 }, { issues: [2], total: 2, startAt: 1 })).toEqual({ issues: [1, 2], total: 2, startAt: 1 });
  });
});
