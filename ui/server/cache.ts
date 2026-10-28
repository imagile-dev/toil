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
 * - **dossiers**: each dossier's last sync time and outcome;
 * - **worklog_events**, **sync_runs**, **agent_runs** and **notes**: what
 *   the worklog (#308, src/model/worklog.ts) folds a day's page from: every
 *   fact a sync recorded, each source's syncs, the agent's runs and the
 *   lines a person added. A sync upserts its facts by key, so the same fact
 *   is one row however often it's synced.
 * - **analyses**: every Analyze (#395), its answer and a snapshot of what
 *   the dossier looked like when it was made (src/model/analysis.ts), kept
 *   per dossier like the worklog: a sync never rewrites it, and the newest
 *   100 of a dossier stay until the retention period ends or a wipe.
 * - **usage**: the agent's model usage (#295), one row per report an SDK
 *   made, apart from everything a sync writes. Forgetting a dossier or a
 *   sync's cleanup never touches it, so a total never drops and a cap never
 *   reopens; only the retention period and `wipe` remove it.
 *
 * The schema is versioned with `PRAGMA user_version` and moved forward one
 * migration at a time inside a transaction. A file from a newer Toil UI is
 * refused with a fix rather than read wrongly. Rows older than the retention
 * period are deleted on open and after every sync, and `wipe` removes the
 * whole folder: the cache holds ticket content, so it never outstays its
 * welcome. A filing cabinet with a shredder bolted to the side.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { sameReport, type UsageRecord } from '../src/model-usage.ts';
import type { ChangeRef, Deployment, Envelope, WorkItem } from '../src/toil.ts';
import { dayOf, eventsFrom, observedEvents, type AgentRun, type SyncRun, type WorklogEvent, type WorklogNote } from '../src/model/worklog.ts';
import { MAX_ANALYSES, type AnalysisRecord } from '../src/model/analysis.ts';
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
  {
    version: 2,
    description: "the agent's model usage, one row per SDK report",
    sql: `
      CREATE TABLE usage (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        at TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE INDEX usage_at ON usage (at);
      CREATE INDEX usage_chat ON usage (chat_id);
    `,
  },
  {
    version: 3,
    description: "the worklog's facts, each source's syncs, agent runs and notes (#308)",
    sql: `
      CREATE TABLE worklog_events (
        dossier TEXT NOT NULL,
        key TEXT NOT NULL,
        day TEXT NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        event TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (dossier, key)
      );
      CREATE INDEX worklog_events_day ON worklog_events (dossier, day);
      CREATE TABLE sync_runs (
        dossier TEXT NOT NULL,
        area TEXT NOT NULL,
        at TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        PRIMARY KEY (dossier, area, at)
      );
      CREATE TABLE agent_runs (
        dossier TEXT NOT NULL,
        id TEXT NOT NULL,
        day TEXT NOT NULL,
        started_at TEXT NOT NULL,
        run TEXT NOT NULL,
        PRIMARY KEY (dossier, id)
      );
      CREATE TABLE notes (
        dossier TEXT NOT NULL,
        id TEXT NOT NULL,
        day TEXT NOT NULL,
        at TEXT NOT NULL,
        note TEXT NOT NULL,
        PRIMARY KEY (dossier, id)
      );
    `,
  },
  {
    version: 4,
    description: 'every Analyze kept per dossier, with a snapshot of what it saw (#395)',
    sql: `
      CREATE TABLE analyses (
        dossier TEXT NOT NULL,
        id TEXT NOT NULL,
        at TEXT NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (dossier, id)
      );
      CREATE INDEX analyses_at ON analyses (dossier, at);
    `,
  },
  {
    version: 5,
    description: "a stored response's digest, so a sync rewrites only what changed, when each source was last read whole, and when a dossier's data was last saved (#493)",
    sql: `
      ALTER TABLE responses ADD COLUMN digest TEXT;
      ALTER TABLE sources ADD COLUMN full_read_at TEXT;
      ALTER TABLE dossiers ADD COLUMN last_saved_at TEXT;
      UPDATE dossiers SET last_saved_at = last_sync_at;
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export class CacheError extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
  }
}

/** The command whose `updatedSince` is a clock reading, not a question: the revision feed's start date moves with the day. */
const FEED_COMMAND = 'ado work-item feed';

/**
 * One string per command and input, whatever order the input's keys came in.
 * For the revision feed alone, `updatedSince` is left out (it says when the
 * call was made, and the sync adds its own to a delta read without ever
 * recording it); on any other command it still tells one answer from another.
 */
export function inputKey(input: Record<string, unknown>, command?: string): string {
  if (command === FEED_COMMAND) input = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'updatedSince'));
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
  /** When a sync last listed this source's items whole, not since a watermark: the sync drops what a whole listing no longer has (#493). */
  fullReadAt?: string | null;
  error: string | null;
  fix: string | null;
  calls: number;
  /** It failed after an earlier success, so what the views show is that older copy. */
  stale: boolean;
}

export interface DossierState {
  name: string;
  /** The last attempt, saved or failed. */
  lastSyncAt: string;
  /** The last time a sync saved data, which is what the dossier's expiry counts from; null when it only ever failed. */
  lastSavedAt: string | null;
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
  /** On success, when this sync listed the source's items whole; null when it only asked for what changed. */
  fullReadAt?: string | null;
  calls: number;
}

/** What one dossier's sync hands the cache, written in one transaction. */
export interface DossierSave {
  dossier: string;
  startedAt: string;
  finishedAt: string;
  responses: Array<{
    command: string;
    input: Record<string, unknown>;
    envelope: Envelope;
    /** The sync handed back the last copy untouched, so there is nothing to compare or rewrite. */
    unchanged?: boolean;
  }>;
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

/** The worklog's tables (#308), which a forgotten dossier takes with it. */
const WORKLOG_TABLES = ['worklog_events', 'sync_runs', 'agent_runs', 'notes'];

/** How far before the last good sync a newly listed fact may be and still count as news: the clocks may disagree (#419). */
export const NEWS_SKEW_MS = 5 * 60_000;
/** What makes two envelopes the same answer: everything but how long the call took and the requests it made. */
export function digestOf(env: Envelope): string {
  return createHash('sha256').update(JSON.stringify([env.ok, env.data, env.error, env.meta.warnings ?? null, env.meta.context ?? null])).digest('hex');
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The tables kept per dossier that a sync never rewrites: the worklog's, and the analyses (#395). */
const KEPT_TABLES = [...WORKLOG_TABLES, 'analyses'];

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
  /** When this file was opened or last wiped: an agent run that started before it isn't brought back in (#308). */
  openedAt: string;

  private constructor(dataDir: string, db: DatabaseSync, open: (path: string) => DatabaseSync, lock: CacheLock, options: CacheOptions) {
    this.dataDir = dataDir;
    this.lock = lock;
    this.paths = cachePaths(dataDir);
    this.db = db;
    this.open = open;
    this.retentionDays = options.retentionDays;
    this.now = options.now ?? (() => new Date());
    this.migrations = options.migrations ?? MIGRATIONS;
    this.openedAt = this.now().toISOString();
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
    this.openedAt = this.now().toISOString();
    this.prepare();
  }

  /** The envelope a call got on its last good sync. */
  response(dossier: string, command: string, input: Record<string, unknown>): StoredResponse | null {
    const row = this.db.prepare('SELECT envelope, area, synced_at FROM responses WHERE dossier = ? AND command = ? AND input_key = ?').get(dossier, command, inputKey(input, command)) as
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

  /** Every stored envelope for a command in a dossier, whatever its input. */
  all(dossier: string, command: string): StoredResponse[] {
    const rows = this.db.prepare('SELECT envelope, area, synced_at FROM responses WHERE dossier = ? AND command = ? ORDER BY synced_at DESC').all(dossier, command) as unknown as Array<{ envelope: string; area: string; synced_at: string }>;
    return rows.map((row) => ({ envelope: JSON.parse(row.envelope) as Envelope, area: row.area, syncedAt: row.synced_at }));
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
      lastSavedAt: d.last_saved_at ?? null,
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
      for (const table of ['responses', 'items', 'transitions', 'change_refs', 'sources', ...KEPT_TABLES]) this.db.prepare(`DELETE FROM ${table} WHERE dossier = ?`).run(dossier);
      this.db.prepare('DELETE FROM dossiers WHERE name = ?').run(dossier);
    });
  }

  /**
   * A dossier toil renamed (#342, `toil dossiers describe --name`): everything
   * synced for it moves to the new name in one transaction, so its dashboard,
   * worklog and sources carry on without a fresh sync, and the next sync's
   * cleanup doesn't forget it as a dossier toil no longer has. Anything left
   * under the new name (a dossier of that name removed and not yet forgotten)
   * goes first. A stored response is keyed by its input, which names the
   * dossier, so each key is made again, and each envelope and agent run that
   * names it is rewritten too. Returns how many rows moved.
   */
  rename(from: string, to: string): number {
    if (from === to) return 0;
    let moved = 0;
    this.transaction(() => {
      for (const table of ['responses', 'items', 'transitions', 'change_refs', 'sources', ...KEPT_TABLES]) this.db.prepare(`DELETE FROM ${table} WHERE dossier = ?`).run(to);
      this.db.prepare('DELETE FROM dossiers WHERE name = ?').run(to);
      const rows = this.db.prepare('SELECT command, input_key, envelope FROM responses WHERE dossier = ?').all(from) as unknown as Array<{ command: string; input_key: string; envelope: string }>;
      const move = this.db.prepare('UPDATE responses SET dossier = ?, input_key = ?, envelope = ? WHERE dossier = ? AND command = ? AND input_key = ?');
      for (const r of rows) {
        const input = JSON.parse(r.input_key) as Record<string, unknown>;
        if (input.dossier === from) input.dossier = to;
        const envelope = JSON.parse(r.envelope) as { meta?: { context?: { dossier?: { name?: unknown } | null } } };
        if (envelope.meta?.context?.dossier?.name === from) envelope.meta.context.dossier.name = to;
        moved += Number(move.run(to, inputKey(input, r.command), JSON.stringify(envelope), from, r.command, r.input_key).changes);
      }
      for (const table of ['items', 'transitions', 'change_refs', 'sources', 'worklog_events', 'sync_runs', 'notes']) moved += Number(this.db.prepare(`UPDATE ${table} SET dossier = ? WHERE dossier = ?`).run(to, from).changes);
      for (const r of this.db.prepare('SELECT id, run FROM agent_runs WHERE dossier = ?').all(from) as unknown as Array<{ id: string; run: string }>) {
        const run = JSON.parse(r.run) as AgentRun;
        moved += Number(this.db.prepare('UPDATE agent_runs SET dossier = ?, run = ? WHERE dossier = ? AND id = ?').run(to, JSON.stringify({ ...run, dossier: to }), from, r.id).changes);
      }
      for (const r of this.db.prepare('SELECT id, record FROM analyses WHERE dossier = ?').all(from) as unknown as Array<{ id: string; record: string }>) {
        const record = JSON.parse(r.record) as AnalysisRecord;
        moved += Number(this.db.prepare('UPDATE analyses SET dossier = ?, record = ? WHERE dossier = ? AND id = ?').run(to, JSON.stringify({ ...record, dossier: to }), from, r.id).changes);
      }
      moved += Number(this.db.prepare('UPDATE dossiers SET name = ? WHERE name = ?').run(to, from).changes);
    });
    return moved;
  }

  /** The names of every dossier the cache holds. */
  dossierNames(): string[] {
    return (this.db.prepare('SELECT name FROM dossiers UNION SELECT DISTINCT dossier FROM responses ORDER BY 1').all() as unknown as Array<{ name: string }>).map((r) => r.name);
  }

  /** A dossier whose `dossiers show` failed: its last attempt and error, and nothing else touched. `last_saved_at` stays, so a failing sync keeps no data alive. */
  saveFailure(dossier: string, at: string, error: string) {
    this.db.prepare('INSERT INTO dossiers (name, last_sync_at, status, error) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET last_sync_at = excluded.last_sync_at, status = excluded.status, error = excluded.error').run(dossier, at, 'failed', error);
  }

  /**
   * One dossier's sync, in one transaction. Responses are upserted; a source
   * whose sync worked drops its responses this sync didn't touch, while a
   * failed one keeps its last good copy. Items, transitions and change refs
   * are the dossier's whole picture as the sync saw it (the sync hands the
   * loader a failed source's last good copy, so a failure never blanks them).
   *
   * Returns the facts this sync recorded for the first time (#419), which the
   * theme moments play: none on a dossier's first sync, when everything in its
   * history would be new, and none from before the last good sync, so a fact
   * a source only now lists (an old build, a closed issue) isn't news.
   */
  saveDossier(save: DossierSave): WorklogEvent[] {
    const at = save.finishedAt;
    let news: WorklogEvent[] = [];
    this.transaction(() => {
      // The last good picture, for what the trackers record no time for (a new blocker, a deployment that failed). The items
      // table keeps it through a failed sync, so a change made during the failure is still seen by the next good one.
      const previous = this.db.prepare('SELECT name FROM dossiers WHERE name = ?').get(save.dossier);
      const lastGood = (this.db.prepare('SELECT MAX(at) AS at FROM sync_runs WHERE dossier = ? AND ok = 1').get(save.dossier) as { at: string | null }).at;
      // A row last synced before this is refreshed to `at`: a quarter of the retention period back, so an unchanged row is
      // written about four times in a retention period instead of on every sync, and is never left older than the period.
      const refresh = new Date(Date.parse(at) - (this.retentionDays * DAY) / 4).toISOString();
      const itemRows = this.db.prepare('SELECT id, item FROM items WHERE dossier = ? ORDER BY id').all(save.dossier) as unknown as Array<{ id: string; item: string }>;
      const refRows = this.db.prepare('SELECT kind, id, ref FROM change_refs WHERE dossier = ?').all(save.dossier) as unknown as Array<{ kind: string; id: string; ref: string }>;
      const before = previous ? { items: itemRows.map((r) => JSON.parse(r.item) as WorkItem), deployments: refRows.filter((c) => c.kind === 'deployment').sort(byId).map((c) => JSON.parse(c.ref) as Deployment) } : null;
      const builds = (this.db.prepare("SELECT event FROM worklog_events WHERE dossier = ? AND kind LIKE 'build-%'").all(save.dossier) as unknown as Array<{ event: string }>).map((r) => JSON.parse(r.event) as WorklogEvent);
      const facts = [...eventsFrom({ items: save.items, changes: save.changes }, builds), ...observedEvents(before, { items: save.items, deployments: save.deployments }, at, lastGood)];
      const fact = this.db.prepare(`INSERT INTO worklog_events (dossier, key, day, at, kind, event, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (dossier, key) DO UPDATE SET day = excluded.day, at = excluded.at, kind = excluded.kind, event = excluded.event, synced_at = excluded.synced_at`);
      const known = new Map((this.db.prepare('SELECT key, event, synced_at FROM worklog_events WHERE dossier = ?').all(save.dossier) as unknown as Array<{ key: string; event: string; synced_at: string }>).map((r) => [r.key, r]));
      const since = lastGood ? Date.parse(lastGood) - NEWS_SKEW_MS : null;
      news = previous && since !== null ? facts.filter((e) => !known.has(e.key) && (e.observed !== null || Date.parse(e.at) >= since)) : [];
      for (const e of facts) {
        const text = JSON.stringify(e);
        const old = known.get(e.key);
        if (old && old.event === text && old.synced_at >= refresh) continue;
        fact.run(save.dossier, e.key, dayOf(e.at)!, e.at, e.kind, text, at);
      }
      const run = this.db.prepare('INSERT OR REPLACE INTO sync_runs (dossier, area, at, ok, error) VALUES (?, ?, ?, ?, ?)');
      for (const s of save.sources) run.run(save.dossier, s.area, at, s.ok ? 1 : 0, s.error);

      // Responses: a row is rewritten only when its envelope changed. One the sync reused is not even compared; one that
      // came back the same is told apart by its digest, which leaves out how long the call took.
      const stored = new Map((this.db.prepare('SELECT command, input_key, area, digest FROM responses WHERE dossier = ?').all(save.dossier) as unknown as Array<{ command: string; input_key: string; area: string; digest: string | null }>).map((r) => [`${r.command}\n${r.input_key}`, r]));
      const okAreas = save.sources.filter((s) => s.ok).map((s) => s.area);
      const put = this.db.prepare('INSERT INTO responses (dossier, command, input_key, area, envelope, synced_at, digest) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dossier, command, input_key) DO UPDATE SET area = excluded.area, envelope = excluded.envelope, synced_at = excluded.synced_at, digest = excluded.digest');
      const touch = this.db.prepare('UPDATE responses SET synced_at = ? WHERE dossier = ? AND command = ? AND input_key = ? AND synced_at < ?');
      const wanted = new Set<string>();
      for (const r of save.responses) {
        const key = inputKey(r.input, r.command);
        const id = `${r.command}\n${key}`;
        wanted.add(id);
        const old = stored.get(id);
        const digest = r.unchanged && old?.digest ? old.digest : digestOf(r.envelope);
        if (old && old.digest === digest) {
          // A failed source's rows are outside the bulk refresh below, and the sync did read this one.
          if (!okAreas.includes(old.area)) touch.run(at, save.dossier, r.command, key, refresh);
          continue;
        }
        put.run(save.dossier, r.command, key, areaOf(r.command), JSON.stringify(r.envelope), at, digest);
      }
      // A source whose sync worked drops the responses this sync didn't ask for; a failed one keeps its last good copy.
      const drop = this.db.prepare('DELETE FROM responses WHERE dossier = ? AND command = ? AND input_key = ?');
      for (const [id, r] of stored) if (!wanted.has(id) && okAreas.includes(r.area)) drop.run(save.dossier, id.slice(0, id.indexOf('\n')), id.slice(id.indexOf('\n') + 1));
      if (okAreas.length) this.db.prepare(`UPDATE responses SET synced_at = ? WHERE dossier = ? AND synced_at < ? AND area IN (${okAreas.map(() => '?').join(', ')})`).run(at, save.dossier, refresh, ...okAreas);

      // Items, transitions and change refs are the dossier's whole picture as the sync saw it (the sync hands the loader a
      // failed source's last good copy, so a failure never blanks them). Only a row that changed is written, a row that is
      // gone is deleted, and the rest are refreshed in one statement each.
      const oldItems = new Map(itemRows.map((r) => [r.id, r.item]));
      const nowItems = new Map(save.items.map((i) => [i.id, i]));
      const item = this.db.prepare('INSERT OR REPLACE INTO items (dossier, id, area, connection, native_key, type, status_category, updated, item, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const dropTransitions = this.db.prepare('DELETE FROM transitions WHERE dossier = ? AND item_id = ?');
      const transition = this.db.prepare('INSERT OR REPLACE INTO transitions (dossier, item_id, seq, from_status, to_status, from_category, to_category, at, by_name, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [id, i] of nowItems) {
        const text = JSON.stringify(i);
        if (oldItems.get(id) === text) continue;
        item.run(save.dossier, i.id, i.source.area, i.source.connection, i.source.key, i.type, i.statusCategory, i.updated, text, at);
        dropTransitions.run(save.dossier, id);
        (i.history?.transitions ?? []).forEach((t, seq) => transition.run(save.dossier, i.id, seq, t.from, t.to, t.fromCategory, t.toCategory, t.at, t.by?.name ?? null, at));
      }
      const dropItem = this.db.prepare('DELETE FROM items WHERE dossier = ? AND id = ?');
      for (const id of oldItems.keys()) if (!nowItems.has(id)) dropItem.run(save.dossier, id);
      this.db.prepare('DELETE FROM transitions WHERE dossier = ? AND item_id NOT IN (SELECT id FROM items WHERE dossier = ?)').run(save.dossier, save.dossier);

      const nowRefs = new Map<string, { kind: string; id: string; values: Array<string | null>; text: string }>();
      for (const c of save.changes) nowRefs.set(`${c.kind}\n${c.id}`, { kind: c.kind, id: c.id, text: JSON.stringify(c), values: [c.source, c.command, c.state, c.outcome, c.at || null, JSON.stringify(c.items)] });
      for (const d of save.deployments) nowRefs.set(`deployment\n${d.id}`, { kind: 'deployment', id: d.id, text: JSON.stringify(d), values: [d.source, d.command, d.state, d.outcome, null, JSON.stringify(d.items)] });
      const oldRefs = new Map(refRows.map((r) => [`${r.kind}\n${r.id}`, r.ref]));
      const change = this.db.prepare('INSERT OR REPLACE INTO change_refs (dossier, id, kind, area, command, state, outcome, at, items, ref, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [key, c] of nowRefs) if (oldRefs.get(key) !== c.text) change.run(save.dossier, c.id, c.kind, ...c.values, c.text, at);
      const dropRef = this.db.prepare('DELETE FROM change_refs WHERE dossier = ? AND kind = ? AND id = ?');
      for (const key of oldRefs.keys()) if (!nowRefs.has(key)) dropRef.run(save.dossier, key.slice(0, key.indexOf('\n')), key.slice(key.indexOf('\n') + 1));
      for (const table of ['items', 'transitions', 'change_refs']) this.db.prepare(`UPDATE ${table} SET synced_at = ? WHERE dossier = ? AND synced_at < ?`).run(at, save.dossier, refresh);

      const source = this.db.prepare(`INSERT INTO sources (dossier, area, status, last_attempt_at, last_success_at, watermark, full_read_at, error, fix, calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (dossier, area) DO UPDATE SET status = excluded.status, last_attempt_at = excluded.last_attempt_at,
          last_success_at = COALESCE(excluded.last_success_at, sources.last_success_at), watermark = COALESCE(excluded.watermark, sources.watermark),
          full_read_at = COALESCE(excluded.full_read_at, sources.full_read_at),
          error = excluded.error, fix = excluded.fix, calls = excluded.calls`);
      for (const s of save.sources) source.run(save.dossier, s.area, s.ok ? 'ok' : 'failed', at, s.ok ? at : null, s.ok ? s.watermark : null, s.ok ? (s.fullReadAt ?? null) : null, s.error, s.fix, s.calls);
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
      this.db.prepare('INSERT INTO dossiers (name, last_sync_at, last_saved_at, status, error) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_saved_at = excluded.last_saved_at, status = excluded.status, error = excluded.error').run(save.dossier, at, at, status, error);
    });
    this.prune();
    return news;
  }

  // The worklog (#308) ---------------------------------------------------------------

  /** The facts a sync recorded for a dossier: one day's, or every one the cache holds. */
  worklogEvents(dossier: string, day?: string): WorklogEvent[] {
    const rows = (day === undefined
      ? this.db.prepare('SELECT event FROM worklog_events WHERE dossier = ? ORDER BY at, key').all(dossier)
      : this.db.prepare('SELECT event FROM worklog_events WHERE dossier = ? AND day = ? ORDER BY at, key').all(dossier, day)) as unknown as Array<{ event: string }>;
    return rows.map((r) => JSON.parse(r.event) as WorklogEvent);
  }

  /** Every day the worklog has a page for: one with a fact, an agent run or a note, or a sync that found nothing. */
  worklogDays(dossier: string): string[] {
    return (this.db.prepare('SELECT day FROM worklog_events WHERE dossier = ? UNION SELECT day FROM agent_runs WHERE dossier = ? UNION SELECT day FROM notes WHERE dossier = ? UNION SELECT substr(at, 1, 10) FROM sync_runs WHERE dossier = ? ORDER BY 1').all(dossier, dossier, dossier, dossier) as unknown as Array<{ day: string }>).map((r) => r.day);
  }

  /** Each source's syncs of a dossier that the cache still holds, oldest first. */
  syncRuns(dossier: string): SyncRun[] {
    return (this.db.prepare('SELECT area, at, ok, error FROM sync_runs WHERE dossier = ? ORDER BY at, area').all(dossier) as unknown as Array<{ area: string; at: string; ok: number; error: string | null }>).map((r) => ({ area: r.area, at: r.at, ok: Number(r.ok) === 1, error: r.error }));
  }

  /** Records an agent run, or its end: the same id replaces what was there. */
  saveRun(run: AgentRun) {
    this.db.prepare('INSERT OR REPLACE INTO agent_runs (dossier, id, day, started_at, run) VALUES (?, ?, ?, ?, ?)').run(run.dossier, run.id, dayOf(run.startedAt)!, run.startedAt, JSON.stringify(run));
  }

  runs(dossier: string, day?: string): AgentRun[] {
    const rows = (day === undefined
      ? this.db.prepare('SELECT run FROM agent_runs WHERE dossier = ? ORDER BY started_at, id').all(dossier)
      : this.db.prepare('SELECT run FROM agent_runs WHERE dossier = ? AND day = ? ORDER BY started_at, id').all(dossier, day)) as unknown as Array<{ run: string }>;
    return rows.map((r) => JSON.parse(r.run) as AgentRun);
  }

  addNote(dossier: string, note: WorklogNote) {
    this.db.prepare('INSERT INTO notes (dossier, id, day, at, note) VALUES (?, ?, ?, ?, ?)').run(dossier, note.id, dayOf(note.at)!, note.at, JSON.stringify(note));
  }

  notes(dossier: string, day?: string): WorklogNote[] {
    const rows = (day === undefined
      ? this.db.prepare('SELECT note FROM notes WHERE dossier = ? ORDER BY at, id').all(dossier)
      : this.db.prepare('SELECT note FROM notes WHERE dossier = ? AND day = ? ORDER BY at, id').all(dossier, day)) as unknown as Array<{ note: string }>;
    return rows.map((r) => JSON.parse(r.note) as WorklogNote);
  }

  // The analyses (#395) ---------------------------------------------------------------

  /** Keeps one Analyze, and only the newest MAX_ANALYSES of its dossier. */
  saveAnalysis(record: AnalysisRecord) {
    this.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO analyses (dossier, id, at, record) VALUES (?, ?, ?, ?)').run(record.dossier, record.id, record.at, JSON.stringify(record));
      this.db.prepare('DELETE FROM analyses WHERE dossier = ? AND id NOT IN (SELECT id FROM analyses WHERE dossier = ? ORDER BY at DESC, id DESC LIMIT ?)').run(record.dossier, record.dossier, MAX_ANALYSES);
    });
  }

  /** A dossier's analyses, oldest first. */
  analyses(dossier: string): AnalysisRecord[] {
    return (this.db.prepare('SELECT record FROM analyses WHERE dossier = ? ORDER BY at, id').all(dossier) as unknown as Array<{ record: string }>).map((r) => JSON.parse(r.record) as AnalysisRecord);
  }

  /**
   * Deletes what is older than the retention period. Returns how many went.
   * Everything a sync writes goes per dossier, together, by one date: `dossiers.last_saved_at`, the last time a sync
   * saved data (a failed `dossiers show` moves `last_sync_at`, the last attempt, and leaves this alone, so a failing sync
   * keeps nothing alive). A dossier is kept while last_saved_at >= now - retention. A dossier that is not kept loses its
   * responses, items, transitions, change refs, worklog facts and sources, and then its row, in this one transaction, so
   * a dossier is never half there. (One that only ever failed has no last_saved_at; its row goes by last_sync_at.) The
   * rows' own synced_at values differ by up to a quarter of the period (saveDossier refreshes only the unchanged rows it
   * finds old), so they can't decide on their own. The rest goes by its own date.
   *
   * Worklog facts also go by their own date, 1.25 x retention. saveDossier only upserts a fact, so one that no sync produces
   * any more (its item left the sync) would otherwise live as long as the dossier keeps saving. A fact a sync still
   * produces is refreshed at a save whenever it is more than retention/4 old. While the dossier is kept its last save was
   * at or after now - retention, and at that save the fact's synced_at became at least save - retention/4, so it is at or
   * after now - 1.25 x retention and this rule never touches it. A fact nothing produces goes about 1.25 x retention after
   * it was last seen. Once saves stop, the whole dossier goes at retention, before this rule matters.
   */
  prune(): number {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * DAY).toISOString();
    let removed = 0;
    this.transaction(() => {
      const kept = 'SELECT name FROM dossiers WHERE last_saved_at >= ?';
      for (const table of ['responses', 'items', 'transitions', 'change_refs', 'worklog_events', 'sources']) removed += Number(this.db.prepare(`DELETE FROM ${table} WHERE dossier NOT IN (${kept})`).run(cutoff).changes);
      const stale = new Date(this.now().getTime() - this.retentionDays * 1.25 * DAY).toISOString();
      removed += Number(this.db.prepare('DELETE FROM worklog_events WHERE synced_at < ?').run(stale).changes);
      removed += Number(this.db.prepare('DELETE FROM dossiers WHERE last_saved_at < ? OR (last_saved_at IS NULL AND last_sync_at < ?)').run(cutoff, cutoff).changes);
      // A test's own migration list may stop short of the usage table; every real file has it.
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage'").get()) removed += Number(this.db.prepare('DELETE FROM usage WHERE at < ?').run(cutoff).changes);
      // The worklog's other records (schema 3): a sync, a run and a note by when it happened.
      removed += Number(this.db.prepare('DELETE FROM sync_runs WHERE at < ?').run(cutoff).changes);
      removed += Number(this.db.prepare('DELETE FROM agent_runs WHERE started_at < ?').run(cutoff).changes);
      removed += Number(this.db.prepare('DELETE FROM notes WHERE at < ?').run(cutoff).changes);
      // An analysis by when it was made (schema 4): it quotes ticket titles, so it never outstays the rest.
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'analyses'").get()) removed += Number(this.db.prepare('DELETE FROM analyses WHERE at < ?').run(cutoff).changes);
    });
    return removed;
  }

  /**
   * Records what an SDK reported (#295). A report seen before (the same id)
   * merges with what's stored by the meter's own rule, so a running total
   * repeated never counts twice and a row never shrinks.
   */
  addUsage(records: readonly UsageRecord[]) {
    if (!records.length) return;
    this.transaction(() => {
      const get = this.db.prepare('SELECT record FROM usage WHERE id = ?');
      const put = this.db.prepare('INSERT INTO usage (id, chat_id, adapter, at, record) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at, record = excluded.record');
      for (const r of records) {
        const seen = get.get(r.id) as { record: string } | undefined;
        const merged = seen ? sameReport(JSON.parse(seen.record) as UsageRecord, r) : r;
        put.run(merged.id, merged.chatId, merged.adapter, merged.at, JSON.stringify(merged));
      }
    });
  }

  /** Usage reported at or after an instant, oldest first. */
  usageSince(since: string): UsageRecord[] {
    return (this.db.prepare('SELECT record FROM usage WHERE at >= ? ORDER BY at, id').all(since) as unknown as Array<{ record: string }>).map((r) => JSON.parse(r.record) as UsageRecord);
  }

  /** Every report for one chat. */
  usageOfChat(chatId: string): UsageRecord[] {
    return (this.db.prepare('SELECT record FROM usage WHERE chat_id = ? ORDER BY at, id').all(chatId) as unknown as Array<{ record: string }>).map((r) => JSON.parse(r.record) as UsageRecord);
  }

  /** Row counts per table, for the tests and the wipe's report. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of ['responses', 'items', 'transitions', 'change_refs', 'sources', 'dossiers', 'usage', ...KEPT_TABLES]) out[table] = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
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
  full_read_at?: string | null;
  error: string | null;
  fix: string | null;
  calls: number;
}
interface DossierRow {
  name: string;
  last_sync_at: string;
  last_saved_at?: string | null;
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
    fullReadAt: r.full_read_at ?? null,
    error: r.error,
    fix: r.fix,
    calls: Number(r.calls),
    stale: status === 'failed' && r.last_success_at !== null,
  };
}

