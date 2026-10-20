/**
 * The local cache (#250): one SQLite file in Toil UI's data folder
 * (`~/.toil-ui/cache/toil-ui.db`), apart from toil's own `~/.toil/`. A sync
 * (server/sync.ts) fills it; the SQLite Store (server/store.ts) answers the
 * views from it. It holds:
 *
 * - **responses**: the envelope each view's toil call got, by dossier,
 *   command and input, so the dashboards render from the cache unchanged;
 * - **items**: the dossier's OWI work items, as `mapOwi` made them;
 * - **transitions**: each item's status changes, from the history commands;
 * - **change_refs**: pull requests, builds and deployments, joined to items;
 * - **sources**: the sync state of each dossier's sources (one per area):
 *   when it last worked, when it was last tried, its error and fix, and the
 *   watermark the next incremental sync asks `--updated-since` from;
 * - **dossiers**: each dossier's last sync time and outcome.
 *
 * The schema is versioned with `PRAGMA user_version` and moved forward one
 * migration at a time inside a transaction. A file from a newer Toil UI is
 * refused with a fix rather than read wrongly. Rows older than the retention
 * period are deleted on open and after every sync, and `wipe` removes the
 * whole folder: the cache holds ticket content, so it never outstays its
 * welcome. A filing cabinet with a shredder bolted to the side.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import type { ChangeRef, Deployment, Envelope, WorkItem } from '../src/toil.ts';
import { loadSqlite, type DatabaseSync } from './sqlite.ts';

/** The path functions the cache's locations are built with: node:path, or path.win32 / path.posix in the tests. */
export type PathApi = Pick<typeof nodePath, 'join'>;

export interface CachePaths {
  /** The cache's own folder inside the data folder; `wipe` removes it whole. */
  dir: string;
  /** The database file. */
  db: string;
}

/** Where the cache lives inside a data folder. */
export function cachePaths(dataDir: string, path: PathApi = nodePath): CachePaths {
  const dir = path.join(dataDir, 'cache');
  return { dir, db: path.join(dir, 'toil-ui.db') };
}

/**
 * How the file commits (#328). SQLite's default rollback journal creates,
 * flushes and deletes a `-journal` file on every commit, and a sync commits
 * many times. On a Windows runner's system drive that measured 22 to 117 ms
 * a commit, which made a sync several times slower there than on Linux or
 * macOS. A write-ahead log appends to one file and, with `synchronous =
 * NORMAL`, flushes only at a checkpoint: 0.1 ms a commit on the same drive. A crash of Toil UI loses nothing
 * and never corrupts the file; a power cut may lose the last commits, which
 * the next sync fetches again, since everything here is a copy of what toil
 * read. The `-wal` and `-shm` files sit beside the database in the cache
 * folder, so `wipe` removes them with it, and closing the file folds the log
 * back in and deletes them.
 */
export const JOURNAL = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;';

/** One schema step: run once, in order, inside a transaction, taking `user_version` to `version`. */
export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'responses, OWI items, transitions, change refs, per-source sync state and per-dossier sync times',
    sql: `
      CREATE TABLE responses (
        dossier TEXT NOT NULL,
        command TEXT NOT NULL,
        input_key TEXT NOT NULL,
        area TEXT NOT NULL,
        envelope TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (dossier, command, input_key)
      );
      CREATE INDEX responses_synced ON responses (synced_at);
      CREATE TABLE items (
        dossier TEXT NOT NULL,
        id TEXT NOT NULL,
        area TEXT NOT NULL,
        connection TEXT NOT NULL,
        native_key TEXT NOT NULL,
        type TEXT NOT NULL,
        status_category TEXT NOT NULL,
        updated TEXT,
        item TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (dossier, id)
      );
      CREATE TABLE transitions (
        dossier TEXT NOT NULL,
        item_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        from_category TEXT,
        to_category TEXT NOT NULL,
        at TEXT NOT NULL,
        by_name TEXT,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (dossier, item_id, seq)
      );
      CREATE TABLE change_refs (
        dossier TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        area TEXT NOT NULL,
        command TEXT NOT NULL,
        state TEXT NOT NULL,
        outcome TEXT NOT NULL,
        at TEXT,
        items TEXT NOT NULL,
        ref TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (dossier, kind, id)
      );
      CREATE TABLE sources (
        dossier TEXT NOT NULL,
        area TEXT NOT NULL,
        status TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT,
        watermark TEXT,
        error TEXT,
        fix TEXT,
        calls INTEGER NOT NULL,
        PRIMARY KEY (dossier, area)
      );
      CREATE TABLE dossiers (
        name TEXT PRIMARY KEY,
        last_sync_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT
      );
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export class CacheError extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
  }
}

/** One string per command and input, whatever order the input's keys came in. */
export function inputKey(input: Record<string, unknown>): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(input));
}

/** The area a command belongs to: `jira` for `jira issue search`. A source, in the sync's terms. */
export const areaOf = (command: string) => command.split(' ')[0]!;

export interface StoredResponse {
  envelope: Envelope;
  area: string;
  syncedAt: string;
}

export interface SourceState {
  area: string;
  status: 'ok' | 'failed';
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  /** The instant the next incremental sync asks for changes since. */
  watermark: string | null;
  error: string | null;
  fix: string | null;
  calls: number;
  /** It failed after an earlier success, so what the views show is that older copy. */
  stale: boolean;
}

export interface DossierState {
  name: string;
  lastSyncAt: string;
  status: 'ok' | 'partial' | 'failed';
  error: string | null;
  sources: SourceState[];
}

export interface TransitionRow {
  itemId: string;
  seq: number;
  from: string | null;
  to: string;
  fromCategory: string | null;
  toCategory: string;
  at: string;
  by: string | null;
}

export interface ChangeRow {
  id: string;
  kind: 'pull-request' | 'build' | 'deployment';
  area: string;
  state: string;
  outcome: string;
  at: string | null;
  items: string[];
  ref: ChangeRef | Deployment;
}

export interface SourceResult {
  area: string;
  ok: boolean;
  error: string | null;
  fix: string | null;
  /** On success: where the next sync starts from. */
  watermark: string | null;
  calls: number;
}

/** What one dossier's sync hands the cache, written in one transaction. */
export interface DossierSave {
  dossier: string;
  startedAt: string;
  finishedAt: string;
  responses: Array<{ command: string; input: Record<string, unknown>; envelope: Envelope }>;
  items: WorkItem[];
  changes: ChangeRef[];
  deployments: Deployment[];
  sources: SourceResult[];
}

export interface CacheOptions {
  /** Days a row is kept after it was last synced. */
  retentionDays: number;
  now?: () => Date;
  /** The tests pass their own steps to prove the migration path. */
  migrations?: readonly Migration[];
}

const DAY = 86_400_000;

/** The lock a running Toil UI holds on its data folder: which process, and a token only the holder knows. */
export interface CacheLock {
  pid: number;
  token: string;
  startedAt: string;
}

/** The one message every OS gives for a wipe while Toil UI runs. */
export const RUNNING_MESSAGE = 'Toil UI is running; stop it, or use Wipe in the UI.';

/** True while a process with this id exists (EPERM: it exists, under another account). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The lock on the data folder, if one is there and its process is alive; a stale or unreadable one counts as none. */
export function liveLock(dataDir: string): CacheLock | null {
  let lock: CacheLock;
  try {
    lock = JSON.parse(readFileSync(lockPath(dataDir), 'utf8')) as CacheLock;
  } catch {
    return null;
  }
  return typeof lock?.pid === 'number' && typeof lock.token === 'string' && pidAlive(lock.pid) ? lock : null;
}

const lockPath = (dataDir: string) => nodePath.join(dataDir, 'toil-ui.lock');

/**
 * Takes the data folder's lock for this process, so `toil-ui wipe` can tell a
 * running Toil UI is using the cache on every OS (POSIX would otherwise unlink
 * the open file under it). A lock whose process is gone is taken over.
 */
export function acquireLock(dataDir: string): CacheLock {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lock: CacheLock = { pid: process.pid, token: randomBytes(16).toString('hex'), startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(dataDir), JSON.stringify(lock), { flag: 'wx', mode: 0o600 });
      return lock;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = liveLock(dataDir);
      // This process hasn't taken the lock yet, so a lock naming its pid was left by a crash and the pid reused (common in containers).
      if (held && held.pid !== process.pid) {
        throw new CacheError(`Another Toil UI (process ${held.pid}) is using ${dataDir}.`, `Stop it first, or start this one with another --data-dir; or, if no Toil UI is running, delete ${lockPath(dataDir)}.`);
      }
      rmSync(lockPath(dataDir), { force: true });
    }
  }
  throw new CacheError(`Couldn't take the lock on ${dataDir}.`, 'Start Toil UI again.');
}

/** Gives the lock back, if it is still this holder's. */
export function releaseLock(dataDir: string, lock: CacheLock) {
  try {
    const held = JSON.parse(readFileSync(lockPath(dataDir), 'utf8')) as CacheLock;
    if (held.token === lock.token) rmSync(lockPath(dataDir), { force: true });
  } catch {
    // Already gone.
  }
}

/**
 * Removes the cache folder and everything in it. Safe when there is none.
 * Refused while a running Toil UI holds the folder's lock, unless the caller
 * is that holder (the in-app wipe, which has closed the file first).
 */
export function wipeCacheFiles(dataDir: string, holder?: CacheLock): CachePaths {
  const paths = cachePaths(dataDir);
  const held = liveLock(dataDir);
  if (held && held.token !== holder?.token) throw new CacheError(RUNNING_MESSAGE, `It holds ${lockPath(dataDir)} (process ${held.pid}). Press Ctrl+C where it runs, then run toil-ui wipe again.`);
  try {
    rmSync(paths.dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new CacheError(RUNNING_MESSAGE, `${paths.dir} is in use. Press Ctrl+C where Toil UI runs, then run toil-ui wipe again.`);
    }
    throw e;
  }
  return paths;
}

/** Applies every migration above the file's version, each in its own transaction. */
export function migrate(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS, file = 'the cache'): number {
  const latest = migrations.length ? migrations[migrations.length - 1]!.version : 0;
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > latest) {
    throw new CacheError(`${file} was written by a newer Toil UI (schema ${current}; this one knows up to ${latest}).`, 'Upgrade Toil UI, or run toil-ui wipe to start the cache again; the next sync fetches everything.');
  }
  for (const step of migrations) {
    if (step.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(step.sql);
      db.exec(`PRAGMA user_version = ${Math.trunc(step.version)}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new CacheError(`Migrating ${file} to schema ${step.version} (${step.description}) failed: ${e instanceof Error ? e.message : String(e)}`, 'Run toil-ui wipe to start the cache again; the next sync fetches everything.');
    }
  }
  return latest;
}

export class Cache {
  readonly dataDir: string;
  readonly paths: CachePaths;
  readonly retentionDays: number;
  private db: DatabaseSync;
  private readonly now: () => Date;
  private readonly migrations: readonly Migration[];
  private readonly open: (path: string) => DatabaseSync;
  private readonly lock: CacheLock;

  private constructor(dataDir: string, db: DatabaseSync, open: (path: string) => DatabaseSync, lock: CacheLock, options: CacheOptions) {
    this.dataDir = dataDir;
    this.lock = lock;
    this.paths = cachePaths(dataDir);
    this.db = db;
    this.open = open;
    this.retentionDays = options.retentionDays;
    this.now = options.now ?? (() => new Date());
    this.migrations = options.migrations ?? MIGRATIONS;
  }

  /**
   * Opens the cache in `dataDir`, creating the folder (owner only) and
   * migrating the file. It holds the folder's lock until `close()`, so
   * `toil-ui wipe` refuses while it's open.
   */
  static async open(dataDir: string, options: CacheOptions): Promise<Cache> {
    const { DatabaseSync } = await loadSqlite();
    const lock = acquireLock(dataDir);
    const open = (path: string) => {
      const paths = cachePaths(dataDir);
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      try {
        chmodSync(paths.dir, 0o700);
      } catch {
        // Windows has no POSIX modes; the folder is under the user's profile there.
      }
      const db = new DatabaseSync(path, { timeout: 5000 });
      db.exec(JOURNAL);
      return db;
    };
    let db: DatabaseSync | undefined;
    try {
      db = open(cachePaths(dataDir).db);
      const cache = new Cache(dataDir, db, open, lock, options);
      cache.prepare();
      return cache;
    } catch (e) {
      db?.close();
      releaseLock(dataDir, lock);
      throw e;
    }
  }

  private prepare() {
    migrate(this.db, this.migrations, this.paths.db);
    this.prune();
  }

  /** The schema version of the open file. */
  version(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  }

  /** Closes the file and gives the data folder's lock back. */
  close() {
    if (this.db.isOpen) this.db.close();
    releaseLock(this.dataDir, this.lock);
  }

  /**
   * Deletes the whole cache folder and starts an empty one: nothing synced is
   * left on disk, and nothing is left serving an unlinked file. The file is
   * closed before it's deleted, and the lock is kept throughout.
   */
  wipe() {
    if (this.db.isOpen) this.db.close();
    wipeCacheFiles(this.dataDir, this.lock);
    this.db = this.open(this.paths.db);
    this.prepare();
  }

  /** The envelope a call got on its last good sync. */
  response(dossier: string, command: string, input: Record<string, unknown>): StoredResponse | null {
    const row = this.db.prepare('SELECT envelope, area, synced_at FROM responses WHERE dossier = ? AND command = ? AND input_key = ?').get(dossier, command, inputKey(input)) as
      | { envelope: string; area: string; synced_at: string }
      | undefined;
    return row ? { envelope: JSON.parse(row.envelope) as Envelope, area: row.area, syncedAt: row.synced_at } : null;
  }

  /** The newest envelope for a command in a dossier, whatever its input: what an incremental batch merges into. */
  latest(dossier: string, command: string): StoredResponse | null {
    const row = this.db.prepare('SELECT envelope, area, synced_at FROM responses WHERE dossier = ? AND command = ? ORDER BY synced_at DESC LIMIT 1').get(dossier, command) as
      | { envelope: string; area: string; synced_at: string }
      | undefined;
    return row ? { envelope: JSON.parse(row.envelope) as Envelope, area: row.area, syncedAt: row.synced_at } : null;
  }

  source(dossier: string, area: string): SourceState | null {
    const row = this.db.prepare('SELECT * FROM sources WHERE dossier = ? AND area = ?').get(dossier, area) as SourceRow | undefined;
    return row ? sourceOf(row) : null;
  }

  /** Every dossier's last sync and its sources, for the sync panel. */
  states(): DossierState[] {
    const dossiers = this.db.prepare('SELECT * FROM dossiers ORDER BY name').all() as unknown as DossierRow[];
    const sources = this.db.prepare('SELECT * FROM sources ORDER BY dossier, area').all() as unknown as SourceRow[];
    return dossiers.map((d) => ({
      name: d.name,
      lastSyncAt: d.last_sync_at,
      status: d.status as DossierState['status'],
      error: d.error,
      sources: sources.filter((s) => s.dossier === d.name).map(sourceOf),
    }));
  }

  items(dossier: string): WorkItem[] {
    return (this.db.prepare('SELECT item FROM items WHERE dossier = ? ORDER BY id').all(dossier) as unknown as Array<{ item: string }>).map((r) => JSON.parse(r.item) as WorkItem);
  }

  transitions(dossier: string, itemId?: string): TransitionRow[] {
    const rows = (itemId === undefined
      ? this.db.prepare('SELECT * FROM transitions WHERE dossier = ? ORDER BY item_id, seq').all(dossier)
      : this.db.prepare('SELECT * FROM transitions WHERE dossier = ? AND item_id = ? ORDER BY seq').all(dossier, itemId)) as unknown as TransitionDbRow[];
    return rows.map((r) => ({ itemId: r.item_id, seq: r.seq, from: r.from_status, to: r.to_status, fromCategory: r.from_category, toCategory: r.to_category, at: r.at, by: r.by_name }));
  }

  changes(dossier: string): ChangeRow[] {
    const rows = this.db.prepare('SELECT * FROM change_refs WHERE dossier = ? ORDER BY kind, id').all(dossier) as unknown as ChangeDbRow[];
    return rows.map((r) => ({ id: r.id, kind: r.kind as ChangeRow['kind'], area: r.area, state: r.state, outcome: r.outcome, at: r.at, items: JSON.parse(r.items) as string[], ref: JSON.parse(r.ref) as ChangeRef | Deployment }));
  }

  /** A dossier toil no longer has: everything synced for it goes. */
  forget(dossier: string) {
    this.transaction(() => {
      for (const table of ['responses', 'items', 'transitions', 'change_refs', 'sources']) this.db.prepare(`DELETE FROM ${table} WHERE dossier = ?`).run(dossier);
      this.db.prepare('DELETE FROM dossiers WHERE name = ?').run(dossier);
    });
  }

  /** The names of every dossier the cache holds. */
  dossierNames(): string[] {
    return (this.db.prepare('SELECT name FROM dossiers UNION SELECT DISTINCT dossier FROM responses ORDER BY 1').all() as unknown as Array<{ name: string }>).map((r) => r.name);
  }

  /** A dossier whose `dossiers show` failed: its last sync time and error, and nothing else touched. */
  saveFailure(dossier: string, at: string, error: string) {
    this.db.prepare('INSERT INTO dossiers (name, last_sync_at, status, error) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET last_sync_at = excluded.last_sync_at, status = excluded.status, error = excluded.error').run(dossier, at, 'failed', error);
  }

  /**
   * One dossier's sync, in one transaction. Responses are upserted; a source
   * whose sync worked drops its responses this sync didn't touch, while a
   * failed one keeps its last good copy. Items, transitions and change refs
   * are the dossier's whole picture as the sync saw it (the sync hands the
   * loader a failed source's last good copy, so a failure never blanks them).
   */
  saveDossier(save: DossierSave) {
    const at = save.finishedAt;
    this.transaction(() => {
      const put = this.db.prepare('INSERT INTO responses (dossier, command, input_key, area, envelope, synced_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (dossier, command, input_key) DO UPDATE SET area = excluded.area, envelope = excluded.envelope, synced_at = excluded.synced_at');
      for (const r of save.responses) put.run(save.dossier, r.command, inputKey(r.input), areaOf(r.command), JSON.stringify(r.envelope), at);
      const drop = this.db.prepare('DELETE FROM responses WHERE dossier = ? AND area = ? AND synced_at < ?');
      for (const s of save.sources) if (s.ok) drop.run(save.dossier, s.area, at);

      for (const table of ['items', 'transitions', 'change_refs']) this.db.prepare(`DELETE FROM ${table} WHERE dossier = ?`).run(save.dossier);
      const item = this.db.prepare('INSERT OR REPLACE INTO items (dossier, id, area, connection, native_key, type, status_category, updated, item, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const transition = this.db.prepare('INSERT OR REPLACE INTO transitions (dossier, item_id, seq, from_status, to_status, from_category, to_category, at, by_name, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const i of save.items) {
        item.run(save.dossier, i.id, i.source.area, i.source.connection, i.source.key, i.type, i.statusCategory, i.updated, JSON.stringify(i), at);
        (i.history?.transitions ?? []).forEach((t, seq) => transition.run(save.dossier, i.id, seq, t.from, t.to, t.fromCategory, t.toCategory, t.at, t.by?.name ?? null, at));
      }
      const change = this.db.prepare('INSERT OR REPLACE INTO change_refs (dossier, id, kind, area, command, state, outcome, at, items, ref, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const c of save.changes) change.run(save.dossier, c.id, c.kind, c.source, c.command, c.state, c.outcome, c.at || null, JSON.stringify(c.items), JSON.stringify(c), at);
      for (const d of save.deployments) change.run(save.dossier, d.id, 'deployment', d.source, d.command, d.state, d.outcome, null, JSON.stringify(d.items), JSON.stringify(d), at);

      const source = this.db.prepare(`INSERT INTO sources (dossier, area, status, last_attempt_at, last_success_at, watermark, error, fix, calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (dossier, area) DO UPDATE SET status = excluded.status, last_attempt_at = excluded.last_attempt_at,
          last_success_at = COALESCE(excluded.last_success_at, sources.last_success_at), watermark = COALESCE(excluded.watermark, sources.watermark),
          error = excluded.error, fix = excluded.fix, calls = excluded.calls`);
      for (const s of save.sources) source.run(save.dossier, s.area, s.ok ? 'ok' : 'failed', at, s.ok ? at : null, s.ok ? s.watermark : null, s.error, s.fix, s.calls);
      // A source the dossier no longer reads (its area left the dossier) goes with its data.
      const areas = save.sources.map((s) => s.area);
      for (const old of this.db.prepare('SELECT area FROM sources WHERE dossier = ?').all(save.dossier) as unknown as Array<{ area: string }>) {
        if (!areas.includes(old.area)) {
          this.db.prepare('DELETE FROM sources WHERE dossier = ? AND area = ?').run(save.dossier, old.area);
          this.db.prepare('DELETE FROM responses WHERE dossier = ? AND area = ?').run(save.dossier, old.area);
        }
      }

      const failed = save.sources.filter((s) => !s.ok);
      const status = failed.length === 0 ? 'ok' : failed.length === save.sources.length ? 'failed' : 'partial';
      const error = failed.length ? failed.map((s) => `${s.area}: ${s.error ?? 'failed'}`).join(' ') : null;
      this.db.prepare('INSERT INTO dossiers (name, last_sync_at, status, error) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET last_sync_at = excluded.last_sync_at, status = excluded.status, error = excluded.error').run(save.dossier, at, status, error);
    });
    this.prune();
  }

  /** Deletes every row last synced before the retention period. Returns how many went. */
  prune(): number {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * DAY).toISOString();
    let removed = 0;
    this.transaction(() => {
      for (const table of ['responses', 'items', 'transitions', 'change_refs']) removed += Number(this.db.prepare(`DELETE FROM ${table} WHERE synced_at < ?`).run(cutoff).changes);
      removed += Number(this.db.prepare('DELETE FROM sources WHERE last_attempt_at < ?').run(cutoff).changes);
      removed += Number(this.db.prepare('DELETE FROM dossiers WHERE last_sync_at < ?').run(cutoff).changes);
    });
    return removed;
  }

  /** Row counts per table, for the tests and the wipe's report. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of ['responses', 'items', 'transitions', 'change_refs', 'sources', 'dossiers']) out[table] = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    return out;
  }

  private transaction(fn: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

interface SourceRow {
  dossier: string;
  area: string;
  status: string;
  last_attempt_at: string;
  last_success_at: string | null;
  watermark: string | null;
  error: string | null;
  fix: string | null;
  calls: number;
}
interface DossierRow {
  name: string;
  last_sync_at: string;
  status: string;
  error: string | null;
}
interface TransitionDbRow {
  item_id: string;
  seq: number;
  from_status: string | null;
  to_status: string;
  from_category: string | null;
  to_category: string;
  at: string;
  by_name: string | null;
}
interface ChangeDbRow {
  id: string;
  kind: string;
  area: string;
  state: string;
  outcome: string;
  at: string | null;
  items: string;
  ref: string;
}

function sourceOf(r: SourceRow): SourceState {
  const status = r.status === 'ok' ? 'ok' : 'failed';
  return {
    area: r.area,
    status,
    lastAttemptAt: r.last_attempt_at,
    lastSuccessAt: r.last_success_at,
    watermark: r.watermark,
    error: r.error,
    fix: r.fix,
    calls: Number(r.calls),
    stale: status === 'failed' && r.last_success_at !== null,
  };
}

