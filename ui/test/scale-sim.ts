/**
 * A large Jira or Azure DevOps project, simulated (#493): thousands of issues,
 * most of them closed long ago, behind a fake `execute()` that answers the
 * queries the way the trackers do (the old whole-project query, and the
 * windowed one), pages Jira by 100, chunks Azure DevOps batches by 200, and
 * counts what it was asked. The same file runs against the code before the
 * change and after it, which is how the numbers in the PR were made.
 *
 * Three thousand tickets were harmed in the making of this fixture, none of
 * them real, all of them closed in a quarterly clean-up nobody remembers.
 */

import { mapOwi } from '@imagile-dev/toil/api';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cache } from '../server/cache.ts';
import type { RequestContext } from '../server/context.ts';
import { SyncService, type SyncExecute } from '../server/sync.ts';
import { ADO_BATCH, ADO_REVISIONS, JIRA_CHANGELOGS, JIRA_SEARCH } from '../src/fixtures/work.ts';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import type { Envelope } from '../src/toil.ts';
import { stubToil } from './toil-stub.ts';

type Rec = Record<string, unknown>;
const DAY = 86_400_000;
const NOW = Date.parse(FIXTURE_NOW);
const ctx: RequestContext = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal };
const JIRA_PAGE_SIZE = 100;
const ADO_BATCH_SIZE = 200;

export interface Counts {
  /** Every execute() the sync made, pages included. */
  toilCalls: number;
  /** The HTTP requests those calls stand for: a Jira page is one, an Azure DevOps batch of 200 is one. */
  requests: number;
  /** Calls to the tracker (search, history, get-many), by command. */
  tracker: Record<string, number>;
  /** Rows the cache wrote, updated or deleted during the sync (SQLite's total_changes()). */
  rowsWritten: number;
  items: number;
  seconds: number;
}

export interface Sim {
  /** Runs a sync `afterMs` after the last one and counts it. */
  sync(afterMs: number): Promise<Counts>;
  /** Changes one live item, as a person would. */
  touch(n: number): void;
  /** Deletes a live item from the tracker. */
  remove(n: number): void;
  /** Makes Jira send a shortened changelog for an item, as it does for a very long history. */
  cutShort(n: number): void;
  close(): void;
}

/** `total` items numbered 1 to total, the last `live` of them open or touched within a week; the rest closed 60 to 1500 days ago. */
export async function simulate(kind: 'jira' | 'ado', total: number, live: number, retentionDays = 30): Promise<Sim> {
  const dir = mkdtempSync(join(tmpdir(), 'toil-ui-scale-'));
  let clock = NOW;
  const now = () => new Date(clock);
  const cache = await Cache.open(dir, { retentionDays, now });
  const toil = stubToil();

  const updatedAt = (n: number) => (n > total - live ? NOW - (1 + (n % 7)) * DAY : NOW - (60 + (n % 1440)) * DAY);
  const open = (n: number) => n > total - live && n % 4 !== 0;
  const touched = new Map<number, number>();
  const removed = new Set<number>();
  const cut = new Set<number>();
  const changed = (n: number) => touched.get(n) ?? updatedAt(n);
  const ids = () => Array.from({ length: total }, (_, i) => i + 1).filter((n) => !removed.has(n));

  const jiraTemplate = JIRA_SEARCH.issues[0] as Rec & { fields: Rec };
  const doneStatus = { name: 'Done', id: '10001', statusCategory: { id: 3, key: 'done', name: 'Done' } };
  const openStatus = { name: 'In Progress', id: '3', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } };
  const jiraIssue = (n: number): Rec => ({ ...jiraTemplate, id: String(10000 + n), key: `PAY-${n}`, fields: { ...jiraTemplate.fields, summary: `Issue ${n}`, updated: new Date(changed(n)).toISOString(), status: open(n) ? openStatus : doneStatus } });
  // The inline changelog Jira sends with --changelog: the whole history, or the first entry of a longer one.
  const withChangelog = (n: number): Rec => {
    const histories = JIRA_CHANGELOGS['PAY-101'] as unknown[];
    return { ...jiraIssue(n), changelog: { startAt: 0, maxResults: 100, total: cut.has(n) ? histories.length + 50 : histories.length, histories: cut.has(n) ? histories.slice(0, 1) : histories } };
  };
  const adoTemplate = ADO_BATCH.value[0]!;
  const adoItem = (n: number): Rec => ({ ...adoTemplate, id: 5000 + n, fields: { ...adoTemplate.fields, 'System.Title': `Item ${n}`, 'System.State': open(n) ? 'Active' : 'Closed', 'System.ChangedDate': new Date(changed(n)).toISOString(), ...(open(n) ? {} : { 'Microsoft.VSTS.Common.ClosedDate': new Date(changed(n)).toISOString() }) } });

  let toilCalls = 0;
  let requests = 0;
  let tracker: Record<string, number> = {};
  const ok = (command: string, data: unknown, page?: { nextCursor: string | null; limit: number }): Envelope =>
    ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 'sim', contractVersion: 1, ...(page ? { page } : {}) } }) as Envelope;

  const execute: SyncExecute = async (command, input, options) => {
    toilCalls++;
    const request = (count = 1) => {
      for (let i = 0; i < count; i++) {
        requests++;
        options.onProgress?.({ type: 'request', method: 'POST', url: 'https://sim.imagile.dev/', status: 200, durationMs: 1, command, message: command } as never);
      }
    };
    const bump = () => (tracker[command] = (tracker[command] ?? 0) + 1);
    const since = typeof input.updatedSince === 'string' ? Date.parse(input.updatedSince) : null;
    await Promise.resolve();

    if (kind === 'jira' && command === 'jira issue search') {
      bump();
      request();
      const jql = String(input.jql);
      const window = /updated >= -(\d+)d/.exec(jql);
      const select = ids().filter((n) => (window ? open(n) || changed(n) >= clock - Number(window[1]) * DAY : true)).filter((n) => since === null || changed(n) >= since);
      const start = typeof input.cursor === 'string' ? Number(input.cursor) : 0;
      const page = select.slice(start, start + JIRA_PAGE_SIZE);
      const issues = page.map((n) => (input.fields === 'key' ? { key: `PAY-${n}` } : input.changelog === true ? withChangelog(n) : jiraIssue(n)));
      const next = start + JIRA_PAGE_SIZE < select.length ? String(start + JIRA_PAGE_SIZE) : null;
      return ok(command, { startAt: start, maxResults: JIRA_PAGE_SIZE, total: select.length, issues }, { nextCursor: next, limit: JIRA_PAGE_SIZE });
    }
    if (kind === 'jira' && command === 'jira issue history') {
      bump();
      request();
      return ok(command, JIRA_CHANGELOGS['PAY-101']);
    }
    if (kind === 'ado' && command === 'ado work-item search') {
      bump();
      request();
      const wiql = String(input.wiql);
      const window = /@Today - (\d+)\)/.exec(wiql);
      const select = ids().filter((n) => (window ? open(n) || changed(n) >= clock - Number(window[1]) * DAY : true)).filter((n) => since === null || changed(n) >= since);
      return ok(command, { queryType: 'flat', workItems: select.map((n) => ({ id: 5000 + n, url: `https://ado.imagile.dev/_apis/wit/workItems/${5000 + n}` })) });
    }
    if (kind === 'ado' && command === 'ado work-item get-many') {
      bump();
      const wanted = (input.id as number[]).map(Number);
      request(Math.ceil(wanted.length / ADO_BATCH_SIZE));
      return ok(command, { count: wanted.length, value: wanted.map((id) => adoItem(id - 5000)), missing: [] });
    }
    if (kind === 'ado' && command === 'ado work-item history') {
      bump();
      request();
      return ok(command, ADO_REVISIONS[Object.keys(ADO_REVISIONS).map(Number)[0]!]);
    }
    // The dossier itself, and the pull requests, builds and deployments around it: the preview's canned answers.
    request();
    return toil.execute(command, input, options);
  };

  const sync = new SyncService({ cache, execute, mapOwi, now });
  const dossier = kind === 'jira' ? 'card-payments' : 'settlement';
  const db = (cache as unknown as { db: { prepare(sql: string): { get(): { n: number } } } }).db;
  const changes = () => Number(db.prepare('SELECT total_changes() AS n').get().n);

  return {
    async sync(afterMs) {
      clock += afterMs;
      toilCalls = 0;
      requests = 0;
      tracker = {};
      const before = changes();
      const started = performance.now();
      const job = await sync.run(ctx, dossier);
      const seconds = (performance.now() - started) / 1000;
      if (job.error) throw new Error(job.error);
      const failed = cache.states().flatMap((d) => d.sources.filter((s) => s.status === 'failed').map((s) => `${s.area}: ${s.error}`));
      if (failed.length) throw new Error(failed.join('; '));
      return { toilCalls, requests, tracker: { ...tracker }, rowsWritten: changes() - before, items: cache.items(dossier).length, seconds };
    },
    touch(n) {
      touched.set(n, clock + 60_000);
    },
    remove(n) {
      removed.add(n);
    },
    cutShort(n) {
      cut.add(n);
    },
    close() {
      cache.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
