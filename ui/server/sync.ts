/**
 * The sync job (#250, #206 point 2: sync through toil, not around it). It
 * calls toil's own commands in-process through `@imagile-dev/toil/api`'s
 * `execute()`, read-only and named `toil-ui` in the audit log, so
 * connections, the credential store, dossiers, bounds and the audit log all
 * apply unchanged and Toil UI holds no credential of its own.
 *
 * **What it asks for is what the dashboards ask for.** Each dossier is loaded
 * with the views' own loader (src/load.ts), driven by `dossiers show`, through
 * an `execute()` that goes to toil, so the cache holds exactly the calls the
 * views will make and they render from it unchanged. On the way, that
 * `execute()` makes the sync incremental:
 *
 * - **Searches** (`jira issue search`, `ado work-item search`, `github
 *   list-issues`) ask only for what changed since the source's watermark, with
 *   `updatedSince`, and merge the answer into the last copy by key.
 * - **The GitHub board** (`github projects list-items`) is read whole, and an
 *   item counts as changed when its issue's `updatedAt` moved.
 * - **Batches** (`ado work-item get-many`, `github get-issue`) fetch only the
 *   changed and new items, merged into the last copy.
 * - **Histories** (`jira issue history`, `ado work-item history`, `github
 *   issue-events`) are fetched only for changed and new items; the rest are
 *   the last copy.
 * - **Everything else** (pull requests, builds, deployments, iterations) has
 *   no "changed since" in toil, so it is read again, bounded as the loader
 *   already bounds it.
 *
 * Every call follows `meta.page.nextCursor` to the end, up to `MAX_PAGES`,
 * and says so when it stops there (Bounds). Work items go through `mapOwi`.
 *
 * **A failing source never blanks the others.** Each area a dossier reads is
 * a source with its own state. When a call fails, the loader is handed that
 * call's last good copy, so the dashboard keeps it; the source is marked
 * failed with toil's message and fix, its watermark stays where it was so the
 * next sync asks again, and the views show its data as stale. A dossier
 * whose `dossiers show` fails keeps everything it had.
 *
 * Progress comes from `execute()`'s own events (requests, pages, retries) and
 * is polled by the page (GET api/sync). One job runs at a time. A relay race
 * where every runner checks the baton has the right serial number.
 */

import type { ProgressEvent } from '@imagile-dev/toil/api';
import { loadDossier } from '../src/load.ts';
import type { Envelope, WorkItem } from '../src/toil.ts';
import { areaOf, type Cache, type DossierState, type SourceResult } from './cache.ts';
import type { RequestContext } from './context.ts';
import { CALLER } from './store.ts';

/** What the sync calls: `execute()` from `@imagile-dev/toil/api`, or a stub in the tests. */
export type SyncExecute = (
  command: string,
  input: Record<string, unknown>,
  options: { readOnly: true; caller: string; signal?: AbortSignal; onProgress?: (event: ProgressEvent) => void },
) => Promise<Envelope>;

export type MapOwi = (input: unknown) => { items: WorkItem[] };

/** The most pages one call follows before it stops and says so. */
export const MAX_PAGES = 200;
/** How far back of the last sync's start the next one asks from, for clocks that disagree a little. */
export const SKEW_MS = 5 * 60_000;
/** The progress lines a job keeps for the page. */
export const MAX_MESSAGES = 50;

export interface SyncJob {
  running: boolean;
  /** Who started it: the request's viewer (#206, Hosting-ready by design). */
  by: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** The dossier being synced now. */
  dossier: string | null;
  dossiersDone: number;
  dossiersTotal: number;
  /** Calls sent to toil, and calls answered from the last copy because nothing changed. */
  fetched: number;
  reused: number;
  requests: number;
  pages: number;
  retries: number;
  /** The newest progress lines, oldest first. */
  messages: string[];
  /** What stopped the job as a whole (the dossier list failed, it was cancelled). Source failures are on the sources. */
  error: string | null;
}

export interface SyncStatus {
  job: SyncJob;
  dossiers: DossierState[];
  retentionDays: number;
}

export class SyncBusy extends Error {
  constructor() {
    super('A sync is already running.');
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);

/** A search whose answer is a list of items with ids, which `updatedSince` narrows. `list` is null when the answer is the list itself. */
const SEARCHES: Record<string, { list: string | null; id: (r: Rec) => string }> = {
  'jira issue search': { list: 'issues', id: (r) => String(r.key) },
  'jira-cloud issue search': { list: 'issues', id: (r) => String(r.key) },
  'ado work-item search': { list: 'workItems', id: (r) => String(r.id) },
  'ado-cloud work-item search': { list: 'workItems', id: (r) => String(r.id) },
  'github list-issues': { list: null, id: (r) => String(r.number) },
};
/** A batch get by ids: the input field holding them, and where the answer lists the items. */
const BATCHES: Record<string, { field: string; list: string; id: (r: Rec) => string }> = {
  'ado work-item get-many': { field: 'id', list: 'value', id: (r) => String(r.id) },
  'ado-cloud work-item get-many': { field: 'id', list: 'value', id: (r) => String(r.id) },
  'github get-issue': { field: 'number', list: 'issues', id: (r) => String(r.number) },
};
/** One item's history: the input field naming the item. */
const HISTORIES: Record<string, string> = {
  'jira issue history': 'key',
  'jira-cloud issue history': 'key',
  'ado work-item history': 'id',
  'ado-cloud work-item history': 'id',
  'github issue-events': 'number',
};
const BOARD = 'github projects list-items';

/** Two pages of one listing as one answer: lists concatenated, the rest from the newer page. */
export function joinPages(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (isRec(a) && isRec(b)) {
    const out: Rec = { ...a, ...b };
    for (const [k, v] of Object.entries(b)) if (Array.isArray(v) && Array.isArray(a[k])) out[k] = [...(a[k] as unknown[]), ...v];
    return out;
  }
  return b;
}

/** `items` replaced and extended by `fresh`, matched by id; the order is the old one, new items last. */
function mergeById(items: Rec[], fresh: Rec[], id: (r: Rec) => string): Rec[] {
  const byId = new Map(fresh.map((r) => [id(r), r]));
  const out = items.map((r) => byId.get(id(r)) ?? r);
  const seen = new Set(items.map(id));
  for (const r of fresh) if (!seen.has(id(r))) out.push(r);
  return out;
}

interface Source {
  area: string;
  calls: number;
  error: { message: string; fix: string | null } | null;
  /** Ids that changed since the watermark, or null when this sync read the source whole. */
  changed: Set<string> | null;
}

interface Run {
  dossier: string;
  startedAt: string;
  sources: Map<string, Source>;
  responses: Array<{ command: string; input: Rec; envelope: Envelope }>;
}

export interface SyncOptions {
  cache: Cache;
  execute: SyncExecute;
  mapOwi: MapOwi;
  now?: () => Date;
  maxPages?: number;
}

export class SyncService {
  private readonly cache: Cache;
  private readonly toil: SyncExecute;
  private readonly mapOwi: MapOwi;
  private readonly now: () => Date;
  private readonly maxPages: number;
  private job: SyncJob = idle();
  private current: Promise<SyncJob> | null = null;
  private controller: AbortController | null = null;

  constructor(options: SyncOptions) {
    this.cache = options.cache;
    this.toil = options.execute;
    this.mapOwi = options.mapOwi;
    this.now = options.now ?? (() => new Date());
    this.maxPages = options.maxPages ?? MAX_PAGES;
  }

  status(): SyncStatus {
    return { job: structuredClone(this.job), dossiers: this.cache.states(), retentionDays: this.cache.retentionDays };
  }

  get running(): boolean {
    return this.current !== null;
  }

  /** Starts a sync of every dossier, or of one, and returns at once; poll `status()`. Throws SyncBusy while one runs. */
  start(ctx: RequestContext, dossier?: string): SyncJob {
    void this.run(ctx, dossier).catch(() => {});
    return structuredClone(this.job);
  }

  /** Runs a sync to the end. */
  run(ctx: RequestContext, dossier?: string): Promise<SyncJob> {
    if (this.current) throw new SyncBusy();
    this.controller = new AbortController();
    this.job = { ...idle(), running: true, by: ctx.viewer.id, startedAt: this.now().toISOString() };
    this.current = this.sync(dossier, this.controller.signal).finally(() => {
      this.current = null;
      this.controller = null;
    });
    return this.current;
  }

  /** Empties the cache. Refused while a sync runs, so the two never interleave. */
  wipe() {
    if (this.current) throw new SyncBusy();
    this.cache.wipe();
    this.job = idle();
  }

  /** Stops a running sync and waits for it. */
  async close() {
    this.controller?.abort();
    await this.current?.catch(() => {});
  }

  private say(message: string) {
    this.job.messages.push(message);
    if (this.job.messages.length > MAX_MESSAGES) this.job.messages.splice(0, this.job.messages.length - MAX_MESSAGES);
  }

  private async sync(only: string | undefined, signal: AbortSignal): Promise<SyncJob> {
    const job = this.job;
    try {
      const list = await this.call('dossiers list', {}, signal);
      if (!list.ok) throw new Error(`dossiers list failed: ${list.error.message}${list.error.fix ? ` ${list.error.fix}` : ''}`);
      const names = recs((list.data as Rec).dossiers)
        .filter((d) => d.shadowedBy === null || d.shadowedBy === undefined)
        .map((d) => String(d.name));
      if (only !== undefined && !names.includes(only)) throw new Error(`toil has no dossier named ${JSON.stringify(only)}. Run toil dossiers list to see them.`);
      // A dossier toil no longer has is forgotten, with everything synced for it.
      if (only === undefined) for (const old of this.cache.dossierNames()) if (!names.includes(old)) this.cache.forget(old);
      const targets = only === undefined ? names : [only];
      job.dossiersTotal = targets.length;
      if (!targets.length) this.say('No dossiers to sync: add one with toil dossiers add.');
      for (const name of targets) {
        if (signal.aborted) throw new Error('The sync was cancelled.');
        job.dossier = name;
        this.say(`${name}: syncing`);
        await this.syncDossier(name, signal);
        job.dossiersDone++;
      }
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e);
      this.say(`Stopped: ${job.error}`);
    } finally {
      job.running = false;
      job.dossier = null;
      job.finishedAt = this.now().toISOString();
    }
    return structuredClone(job);
  }

  /** One call to toil, every page of it, with its progress counted. */
  private async call(command: string, input: Rec, signal: AbortSignal): Promise<Envelope> {
    const onProgress = (event: ProgressEvent) => {
      if (event.type === 'request') this.job.requests++;
      else if (event.type === 'page') this.job.pages++;
      else if (event.type === 'retry') this.job.retries++;
      if (event.type !== 'request') this.say(event.message);
    };
    let env = await this.toil(command, input, { readOnly: true, caller: CALLER, signal, onProgress });
    this.job.fetched++;
    let pages = 1;
    while (env.ok && env.meta.page?.nextCursor) {
      if (pages >= this.maxPages) {
        return {
          ok: false,
          data: null,
          error: { code: 'INVALID_INPUT', message: `${command} still had more after ${this.maxPages} pages, so the sync stopped there rather than keep only part of it.`, fix: 'Narrow the dossier\'s query (a Jira project with fewer issues, a WIQL with a date bound), then sync again.' },
          meta: env.meta,
        } as Envelope;
      }
      const next = await this.toil(command, { ...input, cursor: env.meta.page.nextCursor }, { readOnly: true, caller: CALLER, signal, onProgress });
      this.job.fetched++;
      pages++;
      if (!next.ok) return next;
      env = { ...next, data: joinPages(env.data, next.data) };
    }
    if (env.ok && env.meta.page) env = { ...env, meta: { ...env.meta, page: undefined } } as Envelope;
    return env;
  }

  private async syncDossier(name: string, signal: AbortSignal) {
    const run: Run = { dossier: name, startedAt: this.now().toISOString(), sources: new Map(), responses: [] };
    const syncing = (command: string, input: Record<string, unknown> = {}) => this.answer(run, command, input, signal);
    let loaded;
    try {
      loaded = await loadDossier(syncing, name, { mapOwi: this.mapOwi });
    } catch (e) {
      // `dossiers show` failed: the dossier keeps everything it had.
      const message = e instanceof Error ? e.message : String(e);
      this.cache.saveFailure(name, this.now().toISOString(), message);
      this.say(`${name}: failed, ${message}`);
      return;
    }
    const sources: SourceResult[] = [...run.sources.values()].map((s) => ({
      area: s.area,
      ok: s.error === null,
      error: s.error?.message ?? null,
      fix: s.error?.fix ?? null,
      watermark: s.error === null ? new Date(Date.parse(run.startedAt) - SKEW_MS).toISOString() : null,
      calls: s.calls,
    }));
    this.cache.saveDossier({
      dossier: name,
      startedAt: run.startedAt,
      finishedAt: this.now().toISOString(),
      responses: run.responses,
      items: loaded.items,
      changes: loaded.changes,
      deployments: loaded.deployments,
      sources,
    });
    const failed = sources.filter((s) => !s.ok);
    this.say(`${name}: ${loaded.items.length} items, ${loaded.changes.length} changes, ${loaded.deployments.length} deployments${failed.length ? `; ${failed.map((s) => s.area).join(', ')} failed, showing the last good copy` : ''}`);
  }

  private source(run: Run, area: string): Source {
    let s = run.sources.get(area);
    if (!s) {
      s = { area, calls: 0, error: null, changed: null };
      run.sources.set(area, s);
    }
    return s;
  }

  /**
   * The loader's `execute()` during a sync: toil, made incremental, with a
   * failed call answered by its last good copy so nothing blanks.
   */
  private async answer(run: Run, command: string, input: Rec, signal: AbortSignal): Promise<Envelope> {
    // The dossier itself is read fresh, and isn't a source: it's toil's own config.
    if (command === 'dossiers show' || command === 'dossiers list') return this.call(command, input, signal);
    const area = areaOf(command);
    const source = this.source(run, area);
    source.calls++;
    const env = await this.fetch(run, source, command, input, signal);
    if (env.ok) {
      run.responses.push({ command, input, envelope: env });
      return env;
    }
    source.error ??= { message: `${command}: ${env.error.message}`, fix: env.error.fix ?? null };
    this.say(`${run.dossier}: ${command} failed, ${env.error.message}`);
    const last = this.cache.response(run.dossier, command, input);
    return last ? last.envelope : env;
  }

  private async fetch(run: Run, source: Source, command: string, input: Rec, signal: AbortSignal): Promise<Envelope> {
    const { dossier } = run;
    const state = this.cache.source(dossier, source.area);
    const watermark = state?.watermark ?? null;

    const search = SEARCHES[command];
    if (search) {
      const last = this.cache.response(dossier, command, input);
      if (!watermark || !last?.envelope.ok) return this.call(command, input, signal);
      const delta = await this.call(command, { ...input, updatedSince: watermark }, signal);
      if (!delta.ok) return delta;
      const listOf = (data: unknown) => recs(search.list === null ? data : (data as Rec)[search.list]);
      const fresh = listOf(delta.data);
      source.changed = new Set([...(source.changed ?? []), ...fresh.map(search.id)]);
      this.say(`${dossier}: ${command} since ${watermark}: ${fresh.length} changed`);
      const merged = mergeById(listOf(last.envelope.data), fresh, search.id);
      if (search.list === null) return { ...delta, data: merged };
      const data: Rec = { ...(last.envelope.data as Rec), [search.list]: merged };
      if ('total' in data) data.total = merged.length;
      if ('maxResults' in data) data.maxResults = merged.length;
      return { ...delta, data };
    }

    if (command === BOARD) {
      const env = await this.call(command, input, signal);
      if (!env.ok) return env;
      const last = this.cache.response(dossier, command, input);
      if (last?.envelope.ok && watermark) {
        const before = new Map(recs(last.envelope.data).map((i) => [numberOf(i), updatedOf(i)]));
        const changed = recs(env.data).filter((i) => before.get(numberOf(i)) !== updatedOf(i) || !before.has(numberOf(i))).map(numberOf);
        source.changed = new Set([...(source.changed ?? []), ...changed]);
        this.say(`${dossier}: ${command}: ${changed.length} changed since the last sync`);
      }
      return env;
    }

    const batch = BATCHES[command];
    if (batch && Array.isArray(input[batch.field]) && (input[batch.field] as unknown[]).length > 1) {
      const wanted = (input[batch.field] as unknown[]).map(String);
      const last = this.cache.latest(dossier, command);
      const changed = source.changed;
      if (changed === null || !last?.envelope.ok) return this.call(command, input, signal);
      const cached = new Map(recs((last.envelope.data as Rec)[batch.list]).map((r) => [batch.id(r), r]));
      const toFetch = wanted.filter((id) => changed.has(id) || !cached.has(id));
      if (!toFetch.length) {
        this.job.reused++;
        return { ...last.envelope, data: { ...(last.envelope.data as Rec), [batch.list]: wanted.flatMap((id) => (cached.has(id) ? [cached.get(id)!] : [])) } };
      }
      const asInput = (ids: string[]) => (input[batch.field] as unknown[]).filter((v) => ids.includes(String(v)));
      const delta = await this.call(command, { ...input, [batch.field]: asInput(toFetch) }, signal);
      if (!delta.ok) return delta;
      const data = delta.data as Rec;
      // One id comes back as the item itself (github get-issue), several as a list.
      const fresh = Array.isArray(data[batch.list]) ? recs(data[batch.list]) : isRec(data) ? [data] : [];
      for (const r of fresh) cached.set(batch.id(r), r);
      const list = wanted.flatMap((id) => (cached.has(id) ? [cached.get(id)!] : []));
      const base = Array.isArray(data[batch.list]) ? data : (last.envelope.data as Rec);
      return { ...delta, data: { ...base, [batch.list]: list, ...('count' in base ? { count: list.length } : {}) } };
    }

    const field = HISTORIES[command];
    if (field !== undefined && source.changed !== null && !source.changed.has(String(input[field]))) {
      const last = this.cache.response(dossier, command, input);
      if (last?.envelope.ok) {
        this.job.reused++;
        return last.envelope;
      }
    }
    return this.call(command, input, signal);
  }
}

const numberOf = (item: Rec) => (isRec(item.content) ? String(item.content.number) : String(item.id));
const updatedOf = (item: Rec) => (isRec(item.content) && typeof item.content.updatedAt === 'string' ? item.content.updatedAt : typeof item.updatedAt === 'string' ? item.updatedAt : null);

function idle(): SyncJob {
  return { running: false, by: null, startedAt: null, finishedAt: null, dossier: null, dossiersDone: 0, dossiersTotal: 0, fetched: 0, reused: 0, requests: 0, pages: 0, retries: 0, messages: [], error: null };
}
