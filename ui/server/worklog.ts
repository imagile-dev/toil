/**
 * The worklog, server side (#308): one Markdown page per dossier per day, kept
 * in the cache's folder in Toil UI's data folder,
 *
 *   <data folder>/cache/worklog/<dossier>/<yyyy-mm>/<yyyy-mm-dd>.md
 *   <data folder>/cache/worklog/<dossier>/runs/<run id>.md   (each agent run's transcript)
 *
 * so the cache's retention and its wipe cover the pages too: they hold ticket
 * titles and names. Each page is folded from the cache (src/model/worklog.ts)
 * by code alone. A sync records its facts as it goes (Cache.saveDossier); after
 * it, every page is folded again from what the cache holds and written only
 * where its text changed, so a page always matches the cache and building a
 * day twice gives the same file. A day the cache no longer has anything for
 * loses its page.
 *
 * Whether a person applied an agent's proposal is read from toil's own audit
 * log (`toil audit list`), never assumed. Export goes through toil's file
 * service (`toil util encode --decode --out`, which writes a new file inside
 * the workspace it's given and nowhere else), and publishing is a proposal.
 * A diary kept by the filing system, which has never once forgotten to write
 * in it.
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  buildDay, dayOf, gapsFor, isDay, isMonth, markdownOf, monthMarkdown, monthOf, transcriptOf,
  type AgentRun, type Applied, type WorklogPage,
} from '../src/model/worklog.ts';
import { POSITIONAL_FIELDS } from '../src/proposal.ts';
import type { Execute } from '../src/toil.ts';
import { exportName, MAX_NOTE, WorklogRefusal, publishProposals, type ExportWhat, type ShowAreas, type WorklogApi, type WorklogDay, type WorklogExport, type WorklogMonth, type WorklogRebuilt } from '../src/worklog.ts';
import type { Cache } from './cache.ts';
import { CALLER } from './store.ts';


/** toil's dossier names: lowercase letters, digits and single hyphens, so each is a safe folder name. */
const DOSSIER = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface WorklogOptions {
  /** The cache, as a getter, since a wipe swaps the file underneath. */
  cache: () => Cache;
  /** toil's own `execute()`: the audit log's reads, `dossiers show` and the export. */
  execute: Execute;
  now?: () => Date;
}

const fwd = (p: string) => p.replace(/\\/g, '/');

export class WorklogService implements WorklogApi {
  readonly disabled = null;
  private readonly now: () => Date;

  constructor(private readonly o: WorklogOptions) {
    this.now = o.now ?? (() => new Date());
  }

  private get cache() {
    return this.o.cache();
  }

  /** The folder a dossier's pages are kept in. */
  folder(dossier: string): string {
    return join(this.cache.paths.dir, 'worklog', dossier);
  }

  pagePath(dossier: string, day: string): string {
    return join(this.folder(dossier), monthOf(day), `${day}.md`);
  }

  private checkDossier(dossier: unknown): string {
    if (typeof dossier !== 'string' || !DOSSIER.test(dossier)) throw new WorklogRefusal('Name a dossier: lowercase letters, digits and single hyphens.', 'Use a name toil dossiers list shows.');
    if (!this.cache.states().some((s) => s.name === dossier) && !this.cache.worklogDays(dossier).length) {
      throw new WorklogRefusal(`Toil UI hasn't synced ${dossier}, so it has no worklog yet.`, 'Press Sync now in the Sync panel; each sync records the day it saw.', 404);
    }
    return dossier;
  }

  private today() {
    return dayOf(this.now().toISOString())!;
  }

  private checkDay(day: unknown): string {
    if (!isDay(day)) throw new WorklogRefusal('Name a day as yyyy-mm-dd.', 'Pick one from the calendar.');
    if (day > this.today()) throw new WorklogRefusal(`${day} hasn't happened yet, so it has no page.`, 'Pick today or an earlier day.');
    return day;
  }

  /**
   * What toil's audit log says about the proposals agent runs made, by
   * proposal id: one read of the log for every run passed. A matching write is
   * the same command, writing, succeeding, after the run finished, naming the
   * same item in its positional fields (the id the command acts on).
   */
  private async applied(runs: AgentRun[]): Promise<Record<string, Applied>> {
    const wanted = runs.flatMap((r) => r.proposals.filter((p) => p.command).map((p) => ({ p, after: r.finishedAt ?? r.startedAt })));
    if (!wanted.length) return {};
    const since = wanted.map((w) => w.after).sort()[0]!;
    const env = await this.o.execute('audit list', { since, writesOnly: true, limit: 1000 }, { readOnly: true, caller: CALLER });
    const out: Record<string, Applied> = {};
    if (!env.ok) {
      for (const { p } of wanted) out[p.id] = { state: 'unknown', why: `${env.error.message}${env.error.fix ? ` ${env.error.fix}` : ''}` };
      return out;
    }
    const entries = (Array.isArray(env.data) ? env.data : []) as Array<{ time: string; via: string; command: string; writes: boolean; outcome: string; input: unknown }>;
    for (const { p, after } of wanted) {
      const ids = POSITIONAL_FIELDS.get(p.command!) ?? [];
      const hit = entries
        .filter((e) => e.command === p.command && e.writes && e.outcome === 'ok' && e.time >= after)
        .filter((e) => ids.every((f) => typeof e.input === 'object' && e.input !== null && String((e.input as Record<string, unknown>)[f]) === String(p.input?.[f])))
        .sort((a, b) => (a.time < b.time ? -1 : 1))[0];
      out[p.id] = hit ? { state: 'applied', at: hit.time, via: hit.via } : { state: 'not-applied' };
    }
    return out;
  }

  /** The pages for some days, as the cache has them now, with the audit log read once for all of them. */
  private async pages(dossier: string, days: string[]): Promise<WorklogPage[]> {
    const runs = days.flatMap((d) => this.cache.runs(dossier, d));
    const applied = await this.applied(runs);
    const syncs = this.cache.syncRuns(dossier);
    const now = this.now().toISOString();
    return days.map((day) =>
      buildDay({ dossier, day, events: this.cache.worklogEvents(dossier, day), runs: runs.filter((r) => dayOf(r.startedAt) === day), applied, notes: this.cache.notes(dossier, day), syncs, now, retentionDays: this.cache.retentionDays }),
    );
  }

  /** Writes a page where its text changed; returns whether it wrote. Owner-only, like the cache. */
  private write(path: string, text: string): boolean {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
    const dir = join(path, '..');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows has no POSIX modes; the file is under the user's profile there.
    }
    return true;
  }

  /**
   * Folds every day of a dossier that has anything into its page, writing
   * only those whose text changed, and removes pages and transcripts the
   * cache no longer backs. Returns the days it wrote.
   */
  async reconcile(dossier: string): Promise<string[]> {
    if (!DOSSIER.test(dossier)) return [];
    const days = this.cache.worklogDays(dossier);
    const written: string[] = [];
    for (const page of await this.pages(dossier, days)) if (this.write(this.pagePath(dossier, page.day), markdownOf(page))) written.push(page.day);
    const runs = new Set(this.cache.runs(dossier).map((r) => r.id));
    for (const run of this.cache.runs(dossier)) this.write(join(this.folder(dossier), 'runs', `${run.id}.md`), transcriptOf(run));
    // What the cache no longer backs goes: a day pruned past retention, a run's transcript, a month left empty.
    const root = this.folder(dossier);
    if (existsSync(root)) {
      for (const entry of readdirSync(root)) {
        const dir = join(root, entry);
        if (!statSync(dir).isDirectory()) continue;
        for (const file of readdirSync(dir)) {
          const id = file.replace(/\.md$/, '');
          const keep = entry === 'runs' ? runs.has(id) : isMonth(entry) && days.includes(id);
          if (!keep) rmSync(join(dir, file), { force: true });
        }
        if (!readdirSync(dir).length) rmSync(dir, { recursive: true, force: true });
      }
    }
    return written.sort();
  }

  /** Every dossier the cache holds, and the folders of any it has forgotten. */
  async reconcileAll(): Promise<void> {
    const names = this.cache.dossierNames();
    for (const name of names) await this.reconcile(name);
    const root = join(this.cache.paths.dir, 'worklog');
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root)) if (!names.includes(entry)) rmSync(join(root, entry), { recursive: true, force: true });
  }

  async month(dossier: string, month?: string): Promise<WorklogMonth> {
    const name = this.checkDossier(dossier);
    const today = this.today();
    const wanted = month ?? monthOf(today);
    if (!isMonth(wanted)) throw new WorklogRefusal('Name a month as yyyy-mm.', 'Use the calendar\'s arrows.');
    const all = this.cache.worklogDays(name);
    const syncs = this.cache.syncRuns(name);
    const now = this.now().toISOString();
    const days = all.filter((d) => monthOf(d) === wanted && d <= today);
    return {
      dossier: name,
      month: wanted,
      today,
      timeZone: 'UTC',
      retentionDays: this.cache.retentionDays,
      first: all[0] ?? null,
      last: all.filter((d) => d <= today).at(-1) ?? null,
      days: days.map((day) => {
        const events = this.cache.worklogEvents(name, day).filter((e) => e.kind !== 'build-passed').length;
        return { day, lines: events + this.cache.runs(name, day).length + this.cache.notes(name, day).length, gaps: gapsFor({ day, syncs, now, retentionDays: this.cache.retentionDays }).length };
      }),
    };
  }

  /** One day's page, built now, and written if it changed. */
  async day(dossier: string, day: string): Promise<WorklogDay> {
    const name = this.checkDossier(dossier);
    const d = this.checkDay(day);
    const [page] = await this.pages(name, [d]);
    const markdown = markdownOf(page!);
    const path = this.pagePath(name, d);
    // A day the cache has nothing for has no page to keep: it's shown, never written.
    if (this.cache.worklogDays(name).includes(d)) this.write(path, markdown);
    return { page: page!, markdown, file: existsSync(path) ? fwd(path) : null };
  }

  async rebuild(dossier: string, day: string): Promise<WorklogRebuilt> {
    const name = this.checkDossier(dossier);
    const d = this.checkDay(day);
    const path = this.pagePath(name, d);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const built = await this.day(name, d);
    return { ...built, same: before === null ? null : before === built.markdown };
  }

  async addNote(dossier: string, text: string, by = 'You'): Promise<WorklogDay> {
    const name = this.checkDossier(dossier);
    if (typeof text !== 'string' || !text.trim()) throw new WorklogRefusal('A note needs some text.', 'Type the note, then add it.');
    if (text.length > MAX_NOTE) throw new WorklogRefusal(`A note is at most ${MAX_NOTE} characters.`, 'Shorten it, or add it as two notes.');
    const at = this.now().toISOString();
    this.cache.addNote(name, { id: randomUUID(), at, by, text: text.trim().replace(/\s*\r?\n\s*/g, ' ') });
    return this.day(name, dayOf(at)!);
  }

  /**
   * Records an agent run as it starts and again as it ends, writes its
   * transcript, and folds its day's page again. The Ask pane's questions
   * come here from the agent host; assign-to-agent (#293) will send its
   * assignments the same way.
   */
  async recordRun(run: AgentRun): Promise<void> {
    if (!DOSSIER.test(run.dossier)) return;
    this.cache.saveRun(run);
    this.write(join(this.folder(run.dossier), 'runs', `${run.id}.md`), transcriptOf(run));
    await this.day(run.dossier, dayOf(run.startedAt)!).catch(() => undefined);
  }

  /**
   * The day's or the month's Markdown, written through toil's file service
   * into `folder`: `toil util encode base64 --decode --out <file>`, run with
   * that folder as its workspace. toil writes a new file only, inside the
   * workspace, never into its own config, and records the call in its audit
   * log. Then the proposals for publishing it.
   */
  async exportTo(dossier: string, what: ExportWhat, folder: string): Promise<WorklogExport> {
    const name = this.checkDossier(dossier);
    if (typeof folder !== 'string' || !folder.trim() || !isAbsolute(folder.trim())) throw new WorklogRefusal('Name the folder to export into, as a full path.', 'Type a folder that exists, such as your Documents folder.');
    let markdown: string;
    if ('day' in what) {
      markdown = (await this.day(name, this.checkDay(what.day))).markdown;
    } else {
      if (!isMonth(what.month)) throw new WorklogRefusal('Name a month as yyyy-mm.', 'Export the month the calendar shows.');
      const days = this.cache.worklogDays(name).filter((d) => monthOf(d) === what.month && d <= this.today());
      if (!days.length) throw new WorklogRefusal(`${what.month} has no worklog pages to export.`, 'Pick a month the calendar shows pages in.');
      markdown = monthMarkdown(name, what.month, await this.pages(name, days));
    }
    const file = exportName(name, what);
    const env = await this.o.execute('util encode', { scheme: 'base64', decode: true, text: Buffer.from(markdown, 'utf8').toString('base64'), out: file }, { readOnly: false, caller: CALLER, workspace: folder.trim() });
    if (!env.ok) throw new WorklogRefusal(`toil couldn't write the export: ${env.error.message}`, env.error.fix ?? 'Check the folder, then try again.');
    const path = typeof (env.data as { file?: unknown }).file === 'string' ? ((env.data as { file: string }).file) : fwd(join(folder.trim(), file));
    const show = await this.o.execute('dossiers show', { dossier: name }, { readOnly: true, caller: CALLER });
    const areas = show.ok && typeof show.data === 'object' && show.data !== null ? ((show.data as { areas?: ShowAreas }).areas ?? {}) : {};
    return { path, bytes: Buffer.byteLength(markdown, 'utf8'), proposals: publishProposals(name, what, path, areas) };
  }
}

