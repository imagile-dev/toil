// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Cache, CacheError, MIGRATIONS, SCHEMA_VERSION, cachePaths, inputKey, migrate, wipeCacheFiles, type DossierSave, type Migration } from '../server/cache.ts';
import { DEFAULT_RETENTION_DAYS, parseSettings, SettingsError } from '../server/settings.ts';
import { isSqliteNotice, loadSqlite } from '../server/sqlite.ts';
import type { Envelope, WorkItem } from '../src/toil.ts';
import { MAX_ANALYSES, recordOf, type AnalysisRecord } from '../src/model/analysis.ts';

/**
 * The cache on its own, in throwaway folders under the OS temp folder: the
 * schema and its migrations, retention, the wipe, the quiet node:sqlite
 * loader, and the data folder's paths on Windows and POSIX alike.
 */

const DAY = 86_400_000;
const T0 = '2026-10-13T08:00:00.000Z';
const folders: string[] = [];
const caches: Cache[] = [];

afterEach(() => {
  while (caches.length) caches.pop()!.close();
  while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'toil-ui-cache-'));
  folders.push(dir);
  return dir;
};

async function open(dataDir: string, options: { now?: () => Date; retentionDays?: number; migrations?: readonly Migration[] } = {}) {
  const cache = await Cache.open(dataDir, { retentionDays: options.retentionDays ?? 30, now: options.now, migrations: options.migrations });
  caches.push(cache);
  return cache;
}

const envelope = (command: string, data: unknown): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: '0.1.0-alpha.2', contractVersion: 1 } }) as Envelope;

const item = (key: string): WorkItem =>
  ({
    owi: '0.1', id: `jira:${key}`, source: { area: 'jira', connection: 'jira', key, command: 'jira issue search' }, url: null, type: 'STORY', typeName: 'Story', title: key, body: null,
    status: 'Done', statusCategory: 'DONE', resolution: null, assignee: null, reporter: null, priority: null, estimate: null, labels: [], team: null, iteration: null,
    parent: null, children: [], links: [], created: null, updated: T0, resolved: null, dueDate: null,
    history: { transitions: [{ from: 'To Do', to: 'Done', fromCategory: 'TODO', toCategory: 'DONE', at: T0, by: { id: 'you', name: 'You', email: 'you@example.com' } }], iterations: [] },
    unmapped: [], native: {},
  }) as unknown as WorkItem;

const save = (at: string, over: Partial<DossierSave> = {}): DossierSave => ({
  dossier: 'card-payments',
  startedAt: at,
  finishedAt: at,
  responses: [{ command: 'jira issue search', input: { dossier: 'card-payments', jql: 'project = PAY' }, envelope: envelope('jira issue search', { issues: [{ key: 'PAY-1' }] }) }],
  items: [item('PAY-1')],
  changes: [],
  deployments: [],
  sources: [{ area: 'jira', ok: true, error: null, fix: null, watermark: at, calls: 1 }],
  ...over,
});

describe('the schema', () => {
  it('creates a new file at the latest version, with every table', async () => {
    const cache = await open(folder());
    expect(cache.version()).toBe(SCHEMA_VERSION);
    expect(Object.keys(cache.counts())).toEqual(['responses', 'items', 'transitions', 'change_refs', 'sources', 'dossiers', 'usage', 'worklog_events', 'sync_runs', 'agent_runs', 'notes', 'analyses']);
  });

  /** A file left at an older schema, with one dossier's row in it, as an older Toil UI wrote it. */
  async function olderFile(dir: string, version: number) {
    const { DatabaseSync } = await loadSqlite();
    mkdirSync(cachePaths(dir).dir, { recursive: true });
    const raw = new DatabaseSync(cachePaths(dir).db);
    migrate(raw, MIGRATIONS.filter((m) => m.version <= version));
    const now = new Date().toISOString();
    raw.prepare("INSERT INTO dossiers (name, last_sync_at, status, error) VALUES ('card-payments', ?, 'ok', NULL)").run(now);
    raw.prepare("INSERT INTO items (dossier, id, area, connection, native_key, type, status_category, updated, item, synced_at) VALUES ('card-payments', 'jira:PAY-1', 'jira', 'jira', 'PAY-1', 'STORY', 'DONE', NULL, ?, ?)").run(JSON.stringify(item('PAY-1')), now);
    raw.close();
  }

  it('moves an older file forward one step at a time, keeping its rows', async () => {
    const dir = folder();
    await olderFile(dir, 1);

    const next: Migration = { version: SCHEMA_VERSION + 1, description: 'a note on each dossier', sql: 'ALTER TABLE dossiers ADD COLUMN note TEXT; UPDATE dossiers SET note = \'migrated\';' };
    const second = await open(dir, { migrations: [...MIGRATIONS, next] });
    expect(second.version()).toBe(SCHEMA_VERSION + 1);
    expect(second.items('card-payments').map((i) => i.id)).toEqual(['jira:PAY-1']);
    // Schema 3 (#308) added the worklog's tables, empty, beside what schemas 1 and 2 held.
    expect(second.counts()).toMatchObject({ items: 1, dossiers: 1, worklog_events: 0, sync_runs: 0, agent_runs: 0, notes: 0 });
    const { DatabaseSync } = await loadSqlite();
    second.close();
    const raw = new DatabaseSync(cachePaths(dir).db);
    expect(raw.prepare('SELECT note FROM dossiers').all()).toEqual([{ note: 'migrated' }]);
    raw.close();
  });

  it('rolls a failed step back and says to wipe', async () => {
    const dir = folder();
    (await open(dir)).close();
    const broken: Migration = { version: SCHEMA_VERSION + 1, description: 'broken', sql: 'CREATE TABLE extra (x); SELECT * FROM no_such_table;' };
    await expect(open(dir, { migrations: [...MIGRATIONS, broken] })).rejects.toThrow(`schema ${SCHEMA_VERSION + 1} (broken) failed`);
    const { DatabaseSync } = await loadSqlite();
    const raw = new DatabaseSync(cachePaths(dir).db);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'extra'").all()).toEqual([]);
    raw.close();
  });

  it('refuses a file from a newer Toil UI rather than read it wrongly', async () => {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(CacheError);
    try {
      migrate(db);
    } catch (e) {
      expect((e as CacheError).fix).toContain('toil-ui wipe');
    }
    db.close();
  });

  it('commits to a write-ahead log, which closing folds back into the one file (#328)', async () => {
    const dir = folder();
    const cache = await open(dir);
    cache.saveDossier(save(T0));
    expect(readdirSync(cachePaths(dir).dir).sort()).toEqual(['toil-ui.db', 'toil-ui.db-shm', 'toil-ui.db-wal']);
    cache.close();
    expect(readdirSync(cachePaths(dir).dir)).toEqual(['toil-ui.db']);
    const { DatabaseSync } = await loadSqlite();
    const raw = new DatabaseSync(cachePaths(dir).db);
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    raw.close();
  });

  it('keys a call by its input whatever the order of its fields', () => {
    expect(inputKey({ b: 1, a: { d: 2, c: [3] } })).toBe(inputKey({ a: { c: [3], d: 2 }, b: 1 }));
  });
});

describe('retention', () => {
  it('keeps rows inside the period and deletes them after it, on open and after a sync', async () => {
    const dir = folder();
    let now = Date.parse(T0);
    const cache = await open(dir, { now: () => new Date(now), retentionDays: 30 });
    cache.saveDossier(save(T0));
    expect(cache.counts()).toMatchObject({ responses: 1, items: 1, transitions: 1, sources: 1, dossiers: 1 });

    now += 29 * DAY;
    expect(cache.prune()).toBe(0);
    // Past the period and the quarter that a lazily refreshed row gets on top.
    now += 9 * DAY;
    expect(cache.prune()).toBeGreaterThan(0);
    expect(Object.values(cache.counts()).every((n) => n === 0)).toBe(true);

    // On open, too: a file left alone past its retention opens empty.
    cache.saveDossier(save(new Date(now).toISOString()));
    cache.close();
    const later = await open(dir, { now: () => new Date(now + 38 * DAY), retentionDays: 30 });
    expect(later.counts().items).toBe(0);
  });

  it('defaults to 30 days and takes a flag over its env var', () => {
    const home = '/home/you';
    expect(parseSettings([], {}, home, posix).settings.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(parseSettings([], { TOIL_UI_RETENTION_DAYS: '7' }, home, posix).settings.retentionDays).toBe(7);
    expect(parseSettings(['--retention-days', '90'], { TOIL_UI_RETENTION_DAYS: '7' }, home, posix).settings.retentionDays).toBe(90);
    for (const bad of ['0', '-1', 'week', '1.5', '99999']) expect(() => parseSettings(['--retention-days', bad], {}, home, posix), bad).toThrow(SettingsError);
  });
});

describe('the wipe', () => {
  it('removes the whole cache folder, and an open cache starts again empty', async () => {
    const dir = folder();
    const cache = await open(dir);
    cache.saveDossier(save(new Date().toISOString()));
    cache.wipe();
    expect(Object.values(cache.counts()).every((n) => n === 0)).toBe(true);
    expect(cache.version()).toBe(SCHEMA_VERSION);
    cache.close();
    wipeCacheFiles(dir);
    expect(existsSync(cachePaths(dir).dir)).toBe(false);
    expect(existsSync(dir)).toBe(true);
    // Nothing there is no error.
    expect(() => wipeCacheFiles(dir)).not.toThrow();
  });

  it('is toil-ui wipe, which takes only the data folder', () => {
    const parsed = parseSettings(['wipe', '--data-dir', '/tmp/toil-ui-elsewhere'], {}, '/home/you', posix);
    expect(parsed.command).toBe('wipe');
    expect(parsed.settings.dataDir).toBe('/tmp/toil-ui-elsewhere');
    expect(parseSettings([], {}, '/home/you', posix).command).toBe('serve');
    expect(() => parseSettings(['wipe', '--port', '4000'], {}, '/home/you', posix)).toThrow(SettingsError);
    expect(() => parseSettings(['--port', '4000', 'wipe'], {}, '/home/you', posix)).toThrow(SettingsError);
  });
});

describe('the data folder on each OS', () => {
  it('is ~/.toil-ui, and the cache sits in its cache folder, on Windows', () => {
    const home = 'C:\\Users\\you';
    const { dataDir } = parseSettings([], {}, home, win32).settings;
    expect(dataDir).toBe('C:\\Users\\you\\.toil-ui');
    expect(cachePaths(dataDir, win32)).toEqual({ dir: 'C:\\Users\\you\\.toil-ui\\cache', db: 'C:\\Users\\you\\.toil-ui\\cache\\toil-ui.db' });
    expect(parseSettings([], { TOIL_UI_DATA_DIR: '~\\toil-data' }, home, win32).settings.dataDir).toBe('C:\\Users\\you\\toil-data');
    expect(parseSettings([], { TOIL_UI_DATA_DIR: '~/toil-data' }, home, win32).settings.dataDir).toBe('C:\\Users\\you\\toil-data');
    expect(parseSettings(['--data-dir', 'D:\\cache\\toil-ui'], {}, home, win32).settings.dataDir).toBe('D:\\cache\\toil-ui');
    expect(parseSettings(['--data-dir', '\\\\files.imagile.dev\\share\\toil-ui'], {}, home, win32).settings.dataDir).toBe('\\\\files.imagile.dev\\share\\toil-ui');
  });

  it('is ~/.toil-ui, and the cache sits in its cache folder, on macOS and Linux', () => {
    const home = '/Users/you';
    const { dataDir } = parseSettings([], {}, home, posix).settings;
    expect(dataDir).toBe('/Users/you/.toil-ui');
    expect(cachePaths(dataDir, posix)).toEqual({ dir: '/Users/you/.toil-ui/cache', db: '/Users/you/.toil-ui/cache/toil-ui.db' });
    expect(parseSettings([], { TOIL_UI_DATA_DIR: '~/toil-data' }, home, posix).settings.dataDir).toBe('/Users/you/toil-data');
    expect(parseSettings([], { TOIL_UI_DATA_DIR: '~' }, home, posix).settings.dataDir).toBe('/Users/you');
    // `~name` is another user's home in a shell; it isn't expanded here.
    expect(parseSettings([], { TOIL_UI_DATA_DIR: '/srv/~shared' }, home, posix).settings.dataDir).toBe('/srv/~shared');
  });
});

describe('node:sqlite', () => {
  it('loads without its experimental notice, and lets every other warning through', () => {
    expect(isSqliteNotice('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning')).toBe(true);
    expect(isSqliteNotice('SQLite is an experimental feature and might change at any time', { type: 'ExperimentalWarning' })).toBe(true);
    expect(isSqliteNotice('WASI is an experimental feature', 'ExperimentalWarning')).toBe(false);
    expect(isSqliteNotice('SQLite something', 'DeprecationWarning')).toBe(false);
  });

  it('restores process.emitWarning once loaded', async () => {
    const before = process.emitWarning;
    await loadSqlite();
    expect(process.emitWarning).toBe(before);
  });
});

describe('renaming a dossier (#342)', () => {
  it('moves everything synced for it to the new name, re-keying each response, so it answers under the new name only', async () => {
    const cache = await open(folder(), { now: () => new Date(T0) });
    cache.saveDossier(save(T0));
    cache.addNote('card-payments', { id: 'n1', at: T0, by: 'You', text: 'A note' });
    cache.saveRun({ id: 'r1', kind: 'ask', dossier: 'card-payments', startedAt: T0, finishedAt: T0, outcome: 'finished', by: 'Codex', prompt: 'Hi', answer: 'Hello', error: null, citations: [], unverified: [], proposals: [] });
    // A dossier of the new name that was removed and never forgotten: its rows go, rather than mix with the renamed one's.
    cache.saveDossier(save(T0, { dossier: 'payments-v2', items: [item('OLD-1')] }));
    const before = cache.counts();
    expect(cache.rename('card-payments', 'payments-v2')).toBeGreaterThan(0);
    expect(cache.response('card-payments', 'jira issue search', { dossier: 'card-payments', jql: 'project = PAY' })).toBeNull();
    expect(cache.response('payments-v2', 'jira issue search', { jql: 'project = PAY', dossier: 'payments-v2' })?.envelope.data).toEqual({ issues: [{ key: 'PAY-1' }] });
    expect(cache.items('payments-v2').map((i) => i.id)).toEqual(['jira:PAY-1']);
    expect(cache.transitions('payments-v2')).toHaveLength(1);
    expect(cache.notes('payments-v2').map((n) => n.text)).toEqual(['A note']);
    expect(cache.runs('payments-v2').map((r) => r.dossier)).toEqual(['payments-v2']);
    expect(cache.source('payments-v2', 'jira')?.status).toBe('ok');
    expect(cache.states().map((s) => s.name)).toEqual(['payments-v2']);
    expect(cache.dossierNames()).toEqual(['payments-v2']);
    expect(cache.worklogDays('payments-v2').length).toBeGreaterThan(0);
    expect(cache.counts().items).toBe(before.items! - 1);
  });

  it('does nothing for the same name, or a dossier it never synced', async () => {
    const cache = await open(folder(), { now: () => new Date(T0) });
    cache.saveDossier(save(T0));
    expect(cache.rename('card-payments', 'card-payments')).toBe(0);
    expect(cache.rename('nothing-here', 'elsewhere')).toBe(0);
    expect(cache.dossierNames()).toEqual(['card-payments']);
  });
});

describe('the analyses (#395)', () => {
  const analysis = (id: string, at: string, dossier = 'card-payments'): AnalysisRecord =>
    recordOf({ prompt: 'Analyze', parts: [{ text: `Recommendation: Fix [[jira:PAY-1]] (${id}).` }], citations: ['jira:PAY-1'], by: 'Codex', adapter: 'codex', model: 'gpt-5.5', proposals: [] }, { id, dossier, startedAt: at, at, snapshot: { blocked: [], points: {}, sprint: null } });

  it('keeps every Analyze across a restart, oldest first, and only the newest of each dossier', async () => {
    const dir = folder();
    const cache = await open(dir, { now: () => new Date(T0) });
    cache.saveAnalysis(analysis('b', '2026-10-12T09:00:00.000Z'));
    cache.saveAnalysis(analysis('a', '2026-10-11T09:00:00.000Z'));
    cache.saveAnalysis(analysis('s', '2026-10-11T09:00:00.000Z', 'settlement'));
    cache.close();
    caches.splice(caches.indexOf(cache), 1);
    const again = await open(dir, { now: () => new Date(T0) });
    expect(again.analyses('card-payments').map((r) => [r.id, r.recommendation])).toEqual([
      ['a', 'Fix [[jira:PAY-1]] (a).'],
      ['b', 'Fix [[jira:PAY-1]] (b).'],
    ]);
    expect(again.analyses('settlement').map((r) => r.id)).toEqual(['s']);
    for (let i = 0; i < MAX_ANALYSES; i++) again.saveAnalysis(analysis(`n${i}`, new Date(Date.parse(T0) - (MAX_ANALYSES - i) * 60_000).toISOString()));
    const kept = again.analyses('card-payments');
    expect(kept).toHaveLength(MAX_ANALYSES);
    expect(kept.some((r) => r.id === 'a' || r.id === 'b')).toBe(false);
    expect(again.analyses('settlement')).toHaveLength(1);
  });

  it('goes with the wipe, the retention period, a forgotten dossier, and follows a rename', async () => {
    let now = Date.parse(T0);
    const cache = await open(folder(), { now: () => new Date(now), retentionDays: 30 });
    cache.saveDossier(save(T0));
    cache.saveAnalysis(analysis('a', T0));
    expect(cache.counts().analyses).toBe(1);
    cache.rename('card-payments', 'payments-v2');
    expect(cache.analyses('payments-v2').map((r) => [r.id, r.dossier])).toEqual([['a', 'payments-v2']]);
    expect(cache.analyses('card-payments')).toEqual([]);
    cache.forget('payments-v2');
    expect(cache.counts().analyses).toBe(0);
    cache.saveAnalysis(analysis('b', T0));
    now += 31 * DAY;
    cache.prune();
    expect(cache.counts().analyses).toBe(0);
    cache.saveAnalysis(analysis('c', new Date(now).toISOString()));
    cache.wipe();
    expect(cache.counts().analyses).toBe(0);
  });
});
