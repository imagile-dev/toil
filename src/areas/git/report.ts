import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { gitArea } from './area.js';
import { execOutput, requireRepo, runGit, swallowGitFailure } from './runner.js';

/**
 * `git report`: commits, lines and files changed on a branch, by week and by
 * author, from `git log --numstat`. Lines of code per week is a metric that
 * has outlived every committee that tried to retire it.
 */

export interface CommitStats {
  hash: string;
  date: string;
  author: string;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  netLines: number;
}

export interface AuthorStats {
  author: string;
  commitCount: number;
  insertions: number;
  deletions: number;
  netLines: number;
  filesChanged: number;
}

interface Summary {
  commitCount: number;
  totalInsertions: number;
  totalDeletions: number;
  totalNetLines: number;
  totalFilesChanged: number;
}

export interface WeeklyBreakdown {
  week: string;
  weekStart: string;
  weekEnd: string;
  authors: AuthorStats[];
  summary: Summary;
}

export interface BranchReport {
  branch: string;
  since: string | null;
  until: string | null;
  commits: CommitStats[];
  weeks: WeeklyBreakdown[];
  byAuthor: AuthorStats[];
  summary: Summary;
}

/** Starts each commit's line in git's output; internal, never shown. */
const COMMIT_PREFIX = '__TOIL_COMMIT__';

/** The predecessor read up to 200 MB here, against execSync's 1 MB elsewhere. */
const REPORT_MAX_BUFFER = 200 * 1024 * 1024;

/** The Monday of a date's week, by its UTC day (#74 item 10, pinned). */
function weekMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)).toISOString().slice(0, 10);
}

function weekSunday(monday: string): string {
  const d = new Date(monday);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 6)).toISOString().slice(0, 10);
}

/** `2024-W03`: the ISO year is the Thursday's, and January 4 is always in week 1. */
function isoWeekLabel(monday: string): string {
  const d = new Date(monday);
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3));
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Monday = new Date(Date.UTC(year, 0, 4 - (jan4.getUTCDay() === 0 ? 6 : jan4.getUTCDay() - 1)));
  const weekNum = Math.round((d.getTime() - jan4Monday.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

function addTo(map: Map<string, AuthorStats>, commit: CommitStats): void {
  let stats = map.get(commit.author);
  if (!stats) {
    stats = { author: commit.author, commitCount: 0, insertions: 0, deletions: 0, netLines: 0, filesChanged: 0 };
    map.set(commit.author, stats);
  }
  stats.commitCount++;
  stats.insertions += commit.insertions;
  stats.deletions += commit.deletions;
  stats.netLines += commit.netLines;
  stats.filesChanged += commit.filesChanged;
}

const byName = (a: AuthorStats, b: AuthorStats) => a.author.localeCompare(b.author);

function weeklyBreakdown(commits: CommitStats[]): WeeklyBreakdown[] {
  const weeks = new Map<string, Map<string, AuthorStats>>();
  for (const commit of commits) {
    const monday = weekMonday(commit.date);
    if (!weeks.has(monday)) weeks.set(monday, new Map());
    addTo(weeks.get(monday)!, commit);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monday, authorMap]) => {
      const authors = [...authorMap.values()].sort(byName);
      return {
        week: isoWeekLabel(monday),
        weekStart: monday,
        weekEnd: weekSunday(monday),
        authors,
        summary: {
          commitCount: authors.reduce((s, a) => s + a.commitCount, 0),
          totalInsertions: authors.reduce((s, a) => s + a.insertions, 0),
          totalDeletions: authors.reduce((s, a) => s + a.deletions, 0),
          totalNetLines: authors.reduce((s, a) => s + a.netLines, 0),
          totalFilesChanged: authors.reduce((s, a) => s + a.filesChanged, 0),
        },
      };
    });
}

/**
 * Commits and their numstat lines, then a second filter by author date. git's
 * `--since`/`--until` walk by committer date, so absolute `YYYY-MM-DD` bounds
 * are applied again to the first ten characters of `%aI`; relative ones
 * ("2 weeks ago") are left to git. A `-` (binary) count is 0.
 */
export function parseReport(raw: string, branch: string, opts: { since?: string | undefined; until?: string | undefined }): BranchReport {
  const commits: CommitStats[] = [];
  let current: CommitStats | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith(COMMIT_PREFIX)) {
      if (current) commits.push(current);
      const parts = line.slice(COMMIT_PREFIX.length).split('\t');
      current = { hash: parts[0] ?? '', author: parts[1] ?? '', date: parts[2] ?? '', message: parts[3] ?? '', filesChanged: 0, insertions: 0, deletions: 0, netLines: 0 };
    } else if (current && /^(\d+|-)\t(\d+|-)/.test(line)) {
      const [ins, del] = line.split('\t');
      const insertions = ins === '-' ? 0 : parseInt(ins ?? '0', 10);
      const deletions = del === '-' ? 0 : parseInt(del ?? '0', 10);
      if (!isNaN(insertions) && !isNaN(deletions)) {
        current.insertions += insertions;
        current.deletions += deletions;
        current.filesChanged++;
        current.netLines = current.insertions - current.deletions;
      }
    }
  }
  if (current) commits.push(current);

  const absolute = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);
  const sinceDate = opts.since && absolute(opts.since) ? opts.since.slice(0, 10) : null;
  const untilDate = opts.until && absolute(opts.until) ? opts.until.slice(0, 10) : null;
  const filtered =
    sinceDate || untilDate
      ? commits.filter((c) => {
          const d = c.date.slice(0, 10);
          if (sinceDate && d < sinceDate) return false;
          if (untilDate && d > untilDate) return false;
          return true;
        })
      : commits;

  const totalInsertions = filtered.reduce((sum, c) => sum + c.insertions, 0);
  const totalDeletions = filtered.reduce((sum, c) => sum + c.deletions, 0);
  const byAuthor = new Map<string, AuthorStats>();
  for (const c of filtered) addTo(byAuthor, c);
  return {
    branch,
    since: opts.since ?? null,
    until: opts.until ?? null,
    commits: filtered,
    weeks: weeklyBreakdown(filtered),
    byAuthor: [...byAuthor.values()].sort(byName),
    summary: {
      commitCount: filtered.length,
      totalInsertions,
      totalDeletions,
      totalNetLines: totalInsertions - totalDeletions,
      totalFilesChanged: filtered.reduce((sum, c) => sum + c.filesChanged, 0),
    },
  };
}

/**
 * A plain `YYYY-MM-DD` gets a time and `+00:00`, so git uses its strict ISO
 * parser rather than approxidate. That makes `--until` the start of its day,
 * so the day itself is left out (#74 item 8, pinned).
 */
export function normalizeGitDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00+00:00` : date;
}

/** `base..branch`, `base..HEAD`, `branch`, or none for HEAD. */
export function reportRange(opts: { branch?: string | undefined; base?: string | undefined }): string[] {
  if (opts.base && opts.branch) return [`${opts.base}..${opts.branch}`];
  if (opts.base) return [`${opts.base}..HEAD`];
  if (opts.branch) return [opts.branch];
  return [];
}

export const CSV_HEADER = ['week', 'week_start', 'author', 'commits', 'insertions', 'deletions', 'net_lines', 'files_changed'];

/** One row per week and author, then a TOTAL row. */
export function reportCsvRows(report: BranchReport): unknown[][] {
  const rows: unknown[][] = report.weeks.flatMap((w) => w.authors.map((a) => [w.week, w.weekStart, a.author, a.commitCount, a.insertions, a.deletions, a.netLines, a.filesChanged]));
  const s = report.summary;
  rows.push(['TOTAL', '', '', s.commitCount, s.totalInsertions, s.totalDeletions, s.totalNetLines, s.totalFilesChanged]);
  return rows;
}

export const reportCommand = gitArea.command({
  path: ['git', 'report'],
  kind: 'area-local',
  description: 'Report lines of code and commit counts for a branch, optionally filtered by date',
  toolDescription:
    'Commit counts and lines changed for a branch of the git repository in the workspace, from git log --numstat: { branch, since, until, commits[], weeks[] (ISO weeks, Monday to Sunday, UTC), byAuthor[], summary }. branch defaults to the current one; with base the range is base..branch (or base..HEAD). since and until take YYYY-MM-DD or anything git accepts. With csv and out, the weekly rows are also written as CSV to that new file in the workspace, and data adds its path as file. Runs the git on PATH; a failing git gives an empty report.',
  input: z.object({
    branch: z.string().optional().describe('Branch to report on (defaults to current branch)'),
    base: z.string().optional().describe('Base ref to compare against, e.g. "main" (base..branch, or base..HEAD if --branch is omitted)'),
    since: z.string().optional().describe('Include commits on or after this date (e.g. "2024-01-01")'),
    until: z.string().optional().describe('Include commits on or before this date (e.g. "2024-12-31")'),
    csv: z.boolean().optional().describe('Also write the weekly rows as CSV to the --out file'),
    out: z.string().optional().describe('The CSV file to write, inside the workspace; it must not exist yet. Required with --csv'),
  }),
  writes: false,
  options: [
    { flags: '--branch <name>', field: 'branch', description: 'Branch to report on (defaults to current branch)' },
    { flags: '--base <ref>', field: 'base', description: 'Base ref to compare against, e.g. "main" (base..branch, or base..HEAD if --branch is omitted)' },
    { flags: '--since <date>', field: 'since', description: 'Include commits on or after this date (e.g. "2024-01-01")' },
    { flags: '--until <date>', field: 'until', description: 'Include commits on or before this date (e.g. "2024-12-31")' },
    { flags: '--csv', field: 'csv', description: 'Also write the weekly rows as CSV to the --out file' },
    { flags: '--out <file>', field: 'out', description: 'The CSV file to write, inside the workspace; it must not exist yet. Required with --csv' },
  ],
  examples: [{}, { branch: 'feature/retries', base: 'main', since: '2026-09-01', until: '2026-09-30', csv: true, out: 'report.csv' }],
  run: async (input, ctx) => {
    // Checked before git runs, so a missing file name costs nothing.
    if (input.csv && !input.out) {
      throw new ToilError('INVALID_INPUT', '--csv writes the CSV to a file, and no --out <file> was given.', { fix: 'Pass --out <file> (a new file inside the workspace) with --csv, or drop --csv for the JSON report alone.' });
    }
    if (input.out && !input.csv) {
      throw new ToilError('INVALID_INPUT', "--out names the CSV file, but --csv wasn't given.", { fix: 'Pass --csv with --out <file>, or drop --out for the JSON report alone.' });
    }
    const repo = await requireRepo(ctx);
    const options = [`--format=${COMMIT_PREFIX}%H\t%an\t%aI\t%s`, '--numstat'];
    // User values in options: each joined to its flag with =, so each is one argv token git reads as a date, never as a flag of its own (core's GitCall.options says never user input; this is the exception).
    if (input.since) options.push(`--since=${normalizeGitDate(input.since)}`);
    if (input.until) options.push(`--until=${normalizeGitDate(input.until)}`);
    const range = reportRange(input);
    // A misspelt branch or a bad date is an empty report, as it was (#74 item 9).
    const raw = await swallowGitFailure(
      async () => execOutput('git log', await runGit(ctx, { subcommand: 'log', options, ...(range.length ? { revisions: range } : {}) }), REPORT_MAX_BUFFER),
      () => '',
    );
    // The current branch from .git, as `git rev-parse --abbrev-ref HEAD` printed it; HEAD where that failed.
    const branch = input.branch || (repo.branch === 'unknown' ? 'HEAD' : repo.branch);
    const report = parseReport(raw, branch, input);
    if (!input.csv) return report;
    return { ...report, file: ctx.files.writeCsv(input.out!, CSV_HEADER, reportCsvRows(report)) };
  },
});

export const reportCommands = [reportCommand];
