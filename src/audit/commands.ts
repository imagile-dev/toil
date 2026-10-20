import { z } from 'zod';
import type { AuditEntry, AuditLog } from '../core/audit.js';
import { commandName, defineConfigCommand, servedOverMcp, type AnyCommand } from '../core/command.js';
import type { CommandContext } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';
import { DIMENSIONS, FAILED, matchesFilter, summarize, unusedCommands, type Dimension, type UsageFilter } from './stats.js';

/**
 * `toil audit list | stats | path`: reading back the log execute() keeps of
 * every call (src/core/audit.ts). All three are reads of local files, served
 * over MCP too, so an agent can show a person what it did. None can change
 * the log or switch it off; that's a line in the user's own config file. The
 * minutes of the meeting are available to anyone who asks, and amendable by
 * no one who attended.
 *
 * `stats` needs the registry for `--unused`, and the registry holds these
 * commands, so it's handed in as a function and read only when one runs.
 */
export function auditCommands(registered: () => readonly AnyCommand[]): AnyCommand[] {
  const list = defineConfigCommand({
    path: ['audit', 'list'],
    description: 'List the commands toil has run, newest first, from its local audit log',
    toolDescription:
      "Lists entries from toil's local audit log, newest first: for each call, the time, front door (cli, mcp or api) and, for an API call that named itself, its caller, command, area, connection, whether it wrote and whether allowWrite was passed, the outcome (ok or the error code), the duration, the redacted input and each request's method, redacted URL and status. Filter by since (an ISO date or date-time), command (a command, or an area or group to match every command in it), connection, outcome (ok, failed for any failure, or one error code) and writesOnly. Reads local files only.",
    input: z.object({
      since: z.string().min(1).optional().describe('Only calls at or after this time: an ISO 8601 date (2026-10-01) or date-time (2026-10-01T09:00:00Z)'),
      command: z.string().min(1).optional().describe('Only this command (`jira issue get`), or every command under an area or group (`jira`)'),
      connection: z.string().min(1).optional().describe('Only calls that used this connection'),
      outcome: outcomeField(),
      writesOnly: z.boolean().optional().describe('Only calls that write'),
      limit: z.number().int().min(1).max(1000).optional().describe('Most entries to return (default 100)'),
    }),
    writes: false,
    writesLocal: false,
    options: [
      { flags: '--since <time>', field: 'since', description: 'Only calls at or after this ISO 8601 date or date-time' },
      { flags: '--command <name>', field: 'command', description: 'Only this command, or every command under an area or group' },
      { flags: '--connection <name>', field: 'connection', description: 'Only calls that used this connection' },
      { flags: '--outcome <outcome>', field: 'outcome', description: 'Only calls with this outcome: ok, failed (any failure), or an error code' },
      { flags: '--writes-only', field: 'writesOnly', description: 'Only calls that write' },
      { flags: '--limit <n>', field: 'limit', description: 'Most entries to return (default 100)' },
    ],
    examples: [{}, { since: '2026-10-01', command: 'jira', connection: 'corp-jira', outcome: 'failed', writesOnly: true, limit: 10 }],
    run: async (input, ctx) => {
      const since = input.since === undefined ? undefined : parseTime(input.since, 'since');
      const filter: UsageFilter = { since, command: input.command, connection: input.connection, outcome: input.outcome, writesOnly: input.writesOnly };
      const found = readLog(ctx, since)
        .filter((e) => matchesFilter(e, filter))
        .reverse();
      const limit = input.limit ?? 100;
      if (found.length > limit) {
        ctx.warn({ code: 'AUDIT_LIMIT', message: `Showing the newest ${limit} of ${found.length} matching entries. Narrow the filters (since, command, connection, outcome) or raise the limit.` });
      }
      return found.slice(0, limit);
    },
  });

  const stats = defineConfigCommand({
    path: ['audit', 'stats'],
    description: "Summarize toil's local audit log: calls, failures, top errors and durations by command, area, connection, caller, front door, outcome or day",
    toolDescription:
      "Summarizes toil's local audit log over a window (since, until; by default from midnight UTC 30 days ago to now). Returns totals and one group per value of the dimensions in by (command, area, connection, caller, via, outcome, day; several make a cross-tab; default command): calls, ok and failed counts, the top three error codes with each code's general fix (the log keeps the code, never the call's message), nearest-rank median and p95 duration in ms, how many calls wrote and their share, and first and last seen. Groups come most calls first, or in date order when day is first. Filter by area, command (a command, or an area or group), caller and outcome (ok, failed for any failure, or one error code). unused also lists every registered command with no matching call in the window. Reads local files only, and never groups by an input's value.",
    input: z.object({
      since: z.string().min(1).optional().describe('Only calls at or after this time: an ISO 8601 date (2026-10-01) or date-time. Default: midnight UTC 30 days ago'),
      until: z.string().min(1).optional().describe('Only calls before this time: an ISO 8601 date-time, or a date, which keeps all of that day. Default: now'),
      by: z.array(z.enum(DIMENSIONS)).optional().describe('What to group by: one or more of command, area, connection, caller, via, outcome and day (the UTC date); several make a cross-tab. Default: command'),
      area: z.string().min(1).optional().describe('Only calls to commands of this area'),
      command: z.string().min(1).optional().describe('Only this command (`jira issue get`), or every command under an area or group (`jira`)'),
      caller: z.string().min(1).optional().describe('Only calls from a program that named itself this through the API (`toil-ui`)'),
      outcome: outcomeField(),
      unused: z.boolean().optional().describe('Also list every registered command, among those the area and command filters name, with no matching call in the window'),
    }),
    writes: false,
    writesLocal: false,
    options: [
      { flags: '--since <time>', field: 'since', description: 'Only calls at or after this ISO 8601 date or date-time (default: midnight UTC 30 days ago)' },
      { flags: '--until <time>', field: 'until', description: 'Only calls before this ISO 8601 date-time, or up to the end of this date (default: now)' },
      { flags: '--by <dimension>', field: 'by', description: 'Group by command, area, connection, caller, via, outcome or day; repeat for a cross-tab (default: command)' },
      { flags: '--area <area>', field: 'area', description: 'Only calls to commands of this area' },
      { flags: '--command <name>', field: 'command', description: 'Only this command, or every command under an area or group' },
      { flags: '--caller <label>', field: 'caller', description: 'Only calls from a program that named itself this through the API' },
      { flags: '--outcome <outcome>', field: 'outcome', description: 'Only calls with this outcome: ok, failed (any failure), or an error code' },
      { flags: '--unused', field: 'unused', description: 'Also list the registered commands with no matching call in the window' },
    ],
    examples: [{}, { by: ['day'] }, { since: '2026-10-01', until: '2026-10-31', by: ['area', 'outcome'], area: 'jira', command: 'jira issue', caller: 'toil-ui', outcome: 'failed', unused: true }],
    run: async (input, ctx) => {
      const since = parseTime(input.since ?? defaultSince(), 'since');
      const until = input.until === undefined ? undefined : parseTime(input.until, 'until', true);
      if (until !== undefined && until.getTime() <= since.getTime()) {
        throw new ToilError('INVALID_INPUT', `until (${until.toISOString()}) must be later than since (${since.toISOString()}).`, { fix: 'Pass an until after since, or leave it out to summarize up to now.' });
      }
      const filter: UsageFilter = { since, until, area: input.area, command: input.command, caller: input.caller, outcome: input.outcome };
      const matching = readLog(ctx, since).filter((e) => matchesFilter(e, filter));
      const by: Dimension[] = input.by === undefined || input.by.length === 0 ? ['command'] : [...new Set(input.by)];
      const window = { since: since.toISOString(), until: until?.toISOString() ?? null };
      const summary = { window, by, ...summarize(matching, by) };
      if (input.unused !== true) return summary;
      const used = new Set(matching.map((e) => e.command));
      const all = registered().map((d) => ({ command: commandName(d), area: d.area?.name ?? null, mcp: servedOverMcp(d) }));
      return { ...summary, unused: unusedCommands(all, used, filter) };
    },
  });

  const path = defineConfigCommand({
    path: ['audit', 'path'],
    description: 'Show where the audit log is kept, and whether it is on',
    toolDescription:
      "Returns where toil keeps its local audit log (the folder of monthly <yyyy-mm>.jsonl files), whether it's on, how many months it keeps, and the config file those settings are read from. Reads local files only.",
    input: z.object({}),
    writes: false,
    writesLocal: false,
    examples: [{}],
    run: async (_input, ctx) => {
      const log = logOf(ctx);
      return { path: forwardSlashes(log.dir), enabled: log.settings.enabled, keepMonths: log.settings.keepMonths, configFile: forwardSlashes(log.configFile) };
    },
  });

  return [list, stats, path];
}

const outcomeField = () => z.string().min(1).optional().describe(`Only calls with this outcome: ok, ${FAILED} for any failure, or one error code (AUTH)`);

/** Midnight UTC 30 days before today: a default that holds still all day, so two calls a second apart agree on it. */
function defaultSince(): string {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 30)).toISOString();
}

/** The log's lines from `since`'s month on, warning about any that couldn't be read and about a log that's off. */
function readLog(ctx: CommandContext<unknown>, since: Date | undefined): AuditEntry[] {
  const log = logOf(ctx);
  const { entries, unreadable } = log.read(since);
  if (unreadable > 0) {
    ctx.warn({ code: 'AUDIT_UNREADABLE_LINES', message: `${unreadable} line${unreadable === 1 ? '' : 's'} in ${forwardSlashes(log.dir)} couldn't be read and ${unreadable === 1 ? 'was' : 'were'} skipped.` });
  }
  if (!log.settings.enabled) ctx.warn({ code: 'AUDIT_OFF', message: `The audit log is off ("audit": { "enabled": false } in ${forwardSlashes(log.configFile)}), so nothing new is being recorded.` });
  return entries;
}

function logOf(ctx: CommandContext<unknown>): AuditLog {
  const log = ctx.manage?.audit;
  if (!log) throw new Error('An audit command ran without an audit log; define it with defineConfigCommand and give the context one.');
  return log;
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * An ISO 8601 date or date-time. A bare date is midnight UTC, or with
 * `endOfDay` the midnight after it, so `--until 2026-10-18` keeps all of the
 * 18th. A date-time with no zone is UTC too, so the answer doesn't depend on
 * the machine.
 */
function parseTime(text: string, field: string, endOfDay = false): Date {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) || !text.includes(':') ? text : `${text}Z`;
  const time = ISO.test(text) ? Date.parse(text.includes(':') ? zoned.replace(' ', 'T') : `${text}T00:00:00Z`) : NaN;
  if (Number.isNaN(time)) {
    throw new ToilError('INVALID_INPUT', `${field} "${text}" isn't an ISO 8601 date or date-time.`, { fix: 'Use a date such as 2026-10-01, or a date-time such as 2026-10-01T09:00:00Z.' });
  }
  return new Date(endOfDay && !text.includes(':') ? time + 24 * 60 * 60 * 1000 : time);
}
