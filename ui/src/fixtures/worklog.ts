/**
 * The sample worklog (#308), for the site preview and `toil-ui --sample`:
 * each sample dossier's pages folded by the same code the server folds them
 * with (src/model/worklog.ts), from the sample's own items, pull requests and
 * builds, plus a scripted fortnight of daily syncs (one of which fails), a
 * blocker one sync saw, an agent question with its proposals and a note.
 * It keeps nothing: a note or an export is refused, saying why. A diary
 * with every entry pre-printed, which is at least punctual.
 */

import type { Answer } from '../agent.ts';
import { loadDossier, type DossierData } from '../load.ts';
import {
  addDays, buildDay, dayOf, eventsFrom, gapsFor, isDay, isMonth, lineCount, markdownOf, monthOf, runFromAnswer,
  type AgentRun, type Applied, type SyncRun, type WorklogEvent, type WorklogNote, type WorklogPage,
} from '../model/worklog.ts';
import type { Execute } from '../toil.ts';
import { WORKLOG_SAMPLE_DISABLED, WorklogRefusal, type ExportWhat, type WorklogApi, type WorklogDay, type WorklogExport, type WorklogMonth, type WorklogRebuilt } from '../worklog.ts';
import { scriptedAgent } from './agent.ts';
import { FIXTURE_NOW, fixtureExecute } from './execute.ts';

/** How long the sample says its cache keeps things, as a real one does by default. */
const RETENTION = 30;
/** How many days of daily syncs the sample has. */
const SYNC_DAYS = 14;

interface Sample {
  events: WorklogEvent[];
  runs: AgentRun[];
  applied: Record<string, Applied>;
  notes: WorklogNote[];
  syncs: SyncRun[];
}

const at = (day: string, time: string) => `${day}T${time}:00.000Z`;

/** A scripted question from the day before, with its answer and proposals, the first one applied. */
async function sampleRun(dossier: string, day: string): Promise<{ run: AgentRun; applied: Record<string, Applied> } | null> {
  const agent = scriptedAgent();
  const starters = agent.starters(dossier);
  let chosen: { label: string; answer: Answer } | null = null;
  for (const s of starters) {
    const answer = await agent.ask(dossier, s.id);
    if (!chosen || (!chosen.answer.proposals.length && answer.proposals.length)) chosen = { label: s.label, answer };
  }
  if (!chosen) return null;
  const run = runFromAnswer({ id: `sample-${dossier}-1`, kind: 'ask', dossier, startedAt: at(day, '15:20'), by: 'the scripted preview', prompt: chosen.label }, at(day, '15:21'), chosen.answer);
  const first = run.proposals.find((p) => p.command);
  return { run, applied: first ? { [first.id]: { state: 'applied', at: at(day, '16:02'), via: 'cli' } } : {} };
}

async function sampleOf(data: DossierData, now: string): Promise<Sample> {
  const today = dayOf(now)!;
  const yesterday = addDays(today, -1);
  const events = eventsFrom({ items: data.items, changes: data.changes });
  const areas = data.sources.map((s) => s.area);
  // A sync every morning for a fortnight; the day before yesterday's first one failed.
  const syncs: SyncRun[] = [];
  for (let n = SYNC_DAYS; n >= 0; n--) {
    const day = addDays(today, -n);
    for (const area of areas) {
      if (n === 2 && area === areas[0]) syncs.push({ area, at: at(day, '06:40'), ok: false, error: 'toil timed out after 120 s waiting for the server.' });
      syncs.push({ area, at: at(day, n === 0 ? '07:55' : '07:00'), ok: true, error: null });
    }
  }
  // The one blocker a sync saw yesterday: the first unfinished item another unfinished one blocks.
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const blocked = data.items.find((i) => i.statusCategory !== 'DONE' && i.links.some((l) => l.type === 'blocks' && l.direction === 'inward' && byId.get(l.target)?.statusCategory !== 'DONE'));
  if (blocked) {
    const by = blocked.links.find((l) => l.type === 'blocks' && l.direction === 'inward' && byId.get(l.target)?.statusCategory !== 'DONE')!.target;
    const blocker = byId.get(by)!;
    const label = (k: string) => k.replace(/^[^/]+\//, '');
    events.push({
      key: `blocker:${blocked.id}:${by}:${at(yesterday, '07:00')}`,
      kind: 'blocker',
      at: at(yesterday, '07:00'),
      subject: blocked.id,
      source: blocked.source.area,
      label: label(blocked.source.key),
      title: blocked.title,
      url: blocked.url,
      by: null,
      text: `blocked by [[${by}]]`,
      cites: [blocked.id, by],
      refs: { [blocked.id]: { label: label(blocked.source.key), url: blocked.url }, [by]: { label: label(blocker.source.key), url: blocker.url } },
      observed: { previousSync: at(addDays(yesterday, -1), '07:00') },
    });
  }
  const scripted = await sampleRun(data.name, yesterday);
  return {
    events,
    runs: scripted ? [scripted.run] : [],
    applied: scripted?.applied ?? {},
    notes: [{ id: `sample-${data.name}-note`, at: at(yesterday, '17:30'), by: 'Sample person', text: 'Paired on the retry fix; the review is booked for the morning.' }],
    syncs,
  };
}

/** The sample worklog, over the fixture `execute()` and its fixed clock. */
export function fixtureWorklog(execute: Execute = fixtureExecute().execute, now: string = FIXTURE_NOW): WorklogApi {
  const loaded = new Map<string, Promise<Sample>>();
  const sample = (dossier: string) => {
    if (!loaded.has(dossier)) loaded.set(dossier, loadDossier(execute, dossier).then((d) => sampleOf(d, now)));
    return loaded.get(dossier)!.catch((e: unknown) => {
      loaded.delete(dossier);
      throw new WorklogRefusal(e instanceof Error ? e.message : String(e), 'Pick one of the sample dossiers.', 404);
    });
  };
  const today = dayOf(now)!;
  const contentDays = (s: Sample) => [...new Set([...s.events.map((e) => dayOf(e.at)!), ...s.runs.map((r) => dayOf(r.startedAt)!), ...s.notes.map((n) => dayOf(n.at)!), ...s.syncs.map((x) => dayOf(x.at)!)])].filter((d) => d <= today).sort();
  const page = (dossier: string, s: Sample, day: string): WorklogPage => buildDay({ dossier, day, events: s.events, runs: s.runs, applied: s.applied, notes: s.notes, syncs: s.syncs, now, retentionDays: RETENTION });
  const checkDay = (day: string) => {
    if (!isDay(day)) throw new WorklogRefusal('Name a day as yyyy-mm-dd.', 'Pick one from the calendar.');
    if (day > today) throw new WorklogRefusal(`${day} hasn't happened yet, so it has no page.`, 'Pick today or an earlier day.');
    return day;
  };
  const dayOfSample = async (dossier: string, day: string): Promise<WorklogDay> => {
    const p = page(dossier, await sample(dossier), checkDay(day));
    return { page: p, markdown: markdownOf(p), file: null };
  };
  return {
    disabled: WORKLOG_SAMPLE_DISABLED,
    async month(dossier, month): Promise<WorklogMonth> {
      const s = await sample(dossier);
      const wanted = month ?? monthOf(today);
      if (!isMonth(wanted)) throw new WorklogRefusal('Name a month as yyyy-mm.', "Use the calendar's arrows.");
      const all = contentDays(s);
      return {
        dossier,
        month: wanted,
        today,
        timeZone: 'UTC',
        retentionDays: RETENTION,
        first: all[0] ?? null,
        last: all.at(-1) ?? null,
        days: all.filter((d) => monthOf(d) === wanted).map((day) => ({ day, lines: lineCount(page(dossier, s, day)), gaps: gapsFor({ day, syncs: s.syncs, now, retentionDays: RETENTION }).length })),
      };
    },
    day: dayOfSample,
    async rebuild(dossier, day): Promise<WorklogRebuilt> {
      return { ...(await dayOfSample(dossier, day)), same: null };
    },
    async addNote(): Promise<WorklogDay> {
      throw new WorklogRefusal(WORKLOG_SAMPLE_DISABLED, 'Run toil-ui on your own machine to keep notes.');
    },
    async exportTo(_dossier: string, _what: ExportWhat): Promise<WorklogExport> {
      throw new WorklogRefusal(WORKLOG_SAMPLE_DISABLED, 'Run toil-ui on your own machine to export a page.');
    },
  };
}

