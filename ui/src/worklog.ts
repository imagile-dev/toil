/**
 * The worklog's seam (#308): what the Worklog view reads and asks for, the
 * same whoever answers. The local server answers from its cache and the
 * Markdown pages it keeps in the data folder (ui/server/worklog.ts); the site
 * preview and `toil-ui --sample` answer from the sample data
 * (src/fixtures/worklog.ts), keeping nothing.
 *
 * Export writes a page through toil's own file service, so a file lands only
 * inside the folder the person names and never in toil's config. Publishing
 * one anywhere is a proposal: the `toil … --allow-write` line for a person to
 * run through the write gate. Toil UI posts nothing. The out tray, emptied by
 * hand, as the policy requires.
 */

import type { Proposal } from './proposal.ts';
import type { WorklogPage } from './model/worklog.ts';

export type { AgentRun, Applied, RunLine, WorklogEvent, WorklogNote, WorklogPage } from './model/worklog.ts';

/** One day in the calendar that has a page. */
export interface WorklogDaySummary {
  day: string;
  /** Lines on the page: facts, agent runs and notes. */
  lines: number;
  /** Things the page says it can't vouch for. */
  gaps: number;
}

/** A month of one dossier's worklog, for the calendar. */
export interface WorklogMonth {
  dossier: string;
  month: string;
  /** Today, UTC: the newest day a page can have. */
  today: string;
  timeZone: 'UTC';
  retentionDays: number;
  /** The first and last days with a page, across every month, or null with none. */
  first: string | null;
  last: string | null;
  days: WorklogDaySummary[];
}

/** One day's page, as built now. */
export interface WorklogDay {
  page: WorklogPage;
  markdown: string;
  /** Where the page is kept, absolute with forward slashes; null for sample data, which keeps nothing. */
  file: string | null;
}

/** A page built again, and whether it came out the same as the one kept. */
export interface WorklogRebuilt extends WorklogDay {
  /** True when the text matches the page on disk; null when there was none to compare. */
  same: boolean | null;
}

/** What an export wrote, and the proposals for publishing it. */
export interface WorklogExport {
  /** The file toil wrote, absolute with forward slashes. */
  path: string;
  bytes: number;
  proposals: Proposal[];
}

/** A day's page, or a month's pages in one file. */
export type ExportWhat = { day: string } | { month: string };

export interface WorklogApi {
  /** Why notes and export are off (sample data), or null when they work. */
  readonly disabled: string | null;
  month(dossier: string, month?: string): Promise<WorklogMonth>;
  day(dossier: string, day: string): Promise<WorklogDay>;
  /** Builds the day again from the cache and says whether it matches the page kept. */
  rebuild(dossier: string, day: string): Promise<WorklogRebuilt>;
  /** Adds a note to today's page; the server names the viewer as its author, and the page never does. */
  addNote(dossier: string, text: string, by?: string): Promise<WorklogDay>;
  /** Writes the day's or the month's Markdown into a folder, through toil's file service. */
  exportTo(dossier: string, what: ExportWhat, folder: string): Promise<WorklogExport>;
}

/** A refusal the page shows as it is: what was wrong, what to do, and the HTTP status the server answers with. */
export class WorklogRefusal extends Error {
  constructor(message: string, readonly fix: string, readonly status = 400) {
    super(message);
  }
}

/** Why sample data keeps no note and writes no file, said where those would be. */
export const WORKLOG_SAMPLE_DISABLED = 'This is sample data, so it keeps no notes and writes no files. Toil UI on your own machine keeps each page in its data folder and exports through toil.';

/** The longest note a person may add, in characters. */
export const MAX_NOTE = 2000;

/** The file an export writes: `worklog-<dossier>-<day or month>.md`. */
export const exportName = (dossier: string, what: ExportWhat) => `worklog-${dossier}-${'day' in what ? what.day : what.month}.md`;

/** What `dossiers show` says about the dossier's areas, as far as publishing needs. */
export type ShowAreas = Record<string, { connection: { value: string } | null; inputs: Record<string, string> }>;

/**
 * Where an exported worklog could be published, each as a proposal: a
 * Confluence page in the dossier's space, and a GitHub issue in its
 * repository. Each reads the exported file with `--body-file`, so a page of
 * any length fits a command line. Toil UI runs neither.
 */
export function publishProposals(dossier: string, what: ExportWhat, path: string, areas: ShowAreas): Proposal[] {
  const span = 'day' in what ? what.day : what.month;
  const title = `Worklog: ${dossier}, ${span}`;
  const out: Proposal[] = [];
  const reason = `The worklog exported to ${path}, as it stands. Check it reads as you want before it's posted: the page is the cache's record, facts only.`;
  // Confluence Data Center converts Markdown with --markdown; Confluence Cloud's page create takes storage format or wiki markup only, so it isn't offered.
  const space = areas.confluence?.inputs.space;
  if (space) {
    out.push({
      id: `worklog:${dossier}:${span}:confluence`,
      from: 'worklog',
      item: `${dossier}:${span}`,
      title: `Publish the worklog as a Confluence page in ${space}`,
      reason,
      command: 'confluence page create',
      input: { space, title, bodyFile: path, markdown: true },
      note: 'toil reads the file from its workspace: run the line from the folder the file is in, or pass --workspace with it.',
    });
  }
  const github = areas.github?.inputs;
  if (github?.owner && github.repo) {
    out.push({
      id: `worklog:${dossier}:${span}:github`,
      from: 'worklog',
      item: `${dossier}:${span}`,
      title: `Publish the worklog as a GitHub issue in ${github.owner}/${github.repo}`,
      reason,
      command: 'github issue create',
      input: { owner: github.owner, repo: github.repo, title, bodyFile: path },
      note: 'toil reads the file from its workspace: run the line from the folder the file is in, or pass --workspace with it.',
    });
  }
  return out;
}
