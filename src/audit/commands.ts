import { z } from 'zod';
import type { AuditEntry, AuditLog } from '../core/audit.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import type { CommandContext } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';

/**
 * `toil audit list | path`: reading back the log execute() keeps of every
 * call (src/core/audit.ts). Both are reads of local files, served over MCP
 * too, so an agent can show a person what it did. Neither can change the
 * log or switch it off; that's a line in the user's own config file. The
 * minutes of the meeting are available to anyone who asks, and amendable by
 * no one who attended.
 */
export function auditCommands(): AnyCommand[] {
  const list = defineConfigCommand({
    path: ['audit', 'list'],
    description: 'List the commands toil has run, newest first, from its local audit log',
    toolDescription:
      "Lists entries from toil's local audit log, newest first: for each call, the time, front door (cli, mcp or api) and, for an API call that named itself, its caller, command, area, connection, whether it wrote and whether allowWrite was passed, the outcome (ok or the error code), the duration, the redacted input and each request's method, redacted URL and status. Filter by since (an ISO date or date-time), command (a command, or an area or group to match every command in it), connection and writesOnly. Reads local files only.",
    input: z.object({
      since: z.string().min(1).optional().describe('Only calls at or after this time: an ISO 8601 date (2026-10-01) or date-time (2026-10-01T09:00:00Z)'),
      command: z.string().min(1).optional().describe('Only this command (`jira issue get`), or every command under an area or group (`jira`)'),
      connection: z.string().min(1).optional().describe('Only calls that used this connection'),
      writesOnly: z.boolean().optional().describe('Only calls that write'),
      limit: z.number().int().min(1).max(1000).optional().describe('Most entries to return (default 100)'),
    }),
    writes: false,
    writesLocal: false,
    options: [
      { flags: '--since <time>', field: 'since', description: 'Only calls at or after this ISO 8601 date or date-time' },
      { flags: '--command <name>', field: 'command', description: 'Only this command, or every command under an area or group' },
      { flags: '--connection <name>', field: 'connection', description: 'Only calls that used this connection' },
      { flags: '--writes-only', field: 'writesOnly', description: 'Only calls that write' },
      { flags: '--limit <n>', field: 'limit', description: 'Most entries to return (default 100)' },
    ],
    examples: [{}, { since: '2026-10-01', command: 'jira', connection: 'corp-jira', writesOnly: true, limit: 10 }],
    run: async (input, ctx) => {
      const log = logOf(ctx);
      const since = input.since === undefined ? undefined : parseSince(input.since);
      const { entries, unreadable } = log.read(since);
      if (unreadable > 0) {
        ctx.warn({ code: 'AUDIT_UNREADABLE_LINES', message: `${unreadable} line${unreadable === 1 ? '' : 's'} in ${forwardSlashes(log.dir)} couldn't be read and ${unreadable === 1 ? 'was' : 'were'} skipped.` });
      }
      if (!log.settings.enabled) ctx.warn({ code: 'AUDIT_OFF', message: `The audit log is off ("audit": { "enabled": false } in ${forwardSlashes(log.configFile)}), so nothing new is being recorded.` });
      const matches = (e: AuditEntry) =>
        (since === undefined || Date.parse(e.time) >= since.getTime()) &&
        (input.command === undefined || e.command === input.command || e.command.startsWith(`${input.command} `)) &&
        (input.connection === undefined || e.connection === input.connection) &&
        (input.writesOnly !== true || e.writes === true);
      const found = entries.filter(matches).reverse();
      const limit = input.limit ?? 100;
      if (found.length > limit) {
        ctx.warn({ code: 'AUDIT_LIMIT', message: `Showing the newest ${limit} of ${found.length} matching entries. Narrow the filters (since, command, connection) or raise the limit.` });
      }
      return found.slice(0, limit);
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

  return [list, path];
}

function logOf(ctx: CommandContext<unknown>): AuditLog {
  const log = ctx.manage?.audit;
  if (!log) throw new Error('An audit command ran without an audit log; define it with defineConfigCommand and give the context one.');
  return log;
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO 8601 date or date-time. A bare date is midnight UTC; a date-time with no zone is UTC too, so the answer doesn't depend on the machine. */
function parseSince(text: string): Date {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) || !text.includes(':') ? text : `${text}Z`;
  const time = ISO.test(text) ? Date.parse(text.includes(':') ? zoned.replace(' ', 'T') : `${text}T00:00:00Z`) : NaN;
  if (Number.isNaN(time)) {
    throw new ToilError('INVALID_INPUT', `since "${text}" isn't an ISO 8601 date or date-time.`, { fix: 'Use a date such as 2026-10-01, or a date-time such as 2026-10-01T09:00:00Z.' });
  }
  return new Date(time);
}
