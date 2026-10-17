import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { logscaleArea } from './area.js';
import { DEFAULT_TIMEOUT_MS, searchRepository, type QueryInput } from './client.js';

/**
 * One synchronous search against one repository. LogScale reads a number as
 * epoch milliseconds and any string as a relative time
 * (https://library.humio.com/logscale-api/api-search-timespec.html), so an
 * ISO 8601 value becomes epoch milliseconds here, rather than reaching the
 * server as a relative time nobody has heard of.
 */

/** The longest --timeout-ms toil takes; the command's own time limit sits just above it. */
export const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_LIMIT = 200;

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

function invalidTime(flag: string, value: string): ToilError {
  return new ToilError('INVALID_INPUT', `${flag} ${value} isn't a valid ISO 8601 date or date-time.`, {
    fix: 'Use a date such as 2026-10-01, a date-time such as 2026-10-01T09:30:00Z, epoch milliseconds, or a relative time such as 1h.',
  });
}

/** A --start or --end value as LogScale takes it: epoch ms for digits or ISO 8601, the text as given for a relative time. */
export function timeOf(value: string, flag: string): string | number {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const iso = ISO.exec(text);
  if (!iso) return value;
  const [, y, mo, d, h = '0', mi = '0', s = '0', offset] = iso;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const realDate = day.getUTCFullYear() === Number(y) && day.getUTCMonth() === Number(mo) - 1 && day.getUTCDate() === Number(d);
  if (!realDate || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) throw invalidTime(flag, value);
  // A date-time with no offset is read as UTC, not as this machine's zone.
  const normalized = text.toUpperCase().replace(' ', 'T') + (iso[4] !== undefined && offset === undefined ? 'Z' : '');
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) throw invalidTime(flag, value);
  return ms;
}

const TIME_HELP = 'epoch milliseconds, ISO 8601 (UTC unless it has an offset), or relative such as 1h or 24h';

export const queryCommand = logscaleArea.command({
  path: ['logscale', 'query'],
  description: 'Execute a LogScale Query Language (LQL) search against a repository',
  toolDescription: 'Run one LogScale Query Language search against a repository or view over a time window, and return its events (at most limit). Suited to filter queries over short windows. logscale_repositories_list gives repository names.',
  input: z.object({
    repository: z.string().min(1).describe('Repository name to query'),
    query: z.string().min(1).describe('LogScale Query Language expression (e.g. "error" or "level=error | count()")'),
    start: z.string().min(1).optional().describe(`Start time: ${TIME_HELP} (default: "1h")`),
    end: z.string().min(1).optional().describe(`End time: ${TIME_HELP} (default: "now")`),
    limit: z.number().int().positive().optional().describe(`Maximum number of events to return (default: ${DEFAULT_LIMIT})`),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().describe(`Client-side HTTP timeout in milliseconds, at most ${MAX_TIMEOUT_MS} (default: ${DEFAULT_TIMEOUT_MS})`),
  }),
  writes: false,
  // LogScale takes the search as a POST body.
  queryByPost: true,
  // Room for the longest --timeout-ms, so the request's own timeout is what reports it.
  timeLimitMs: MAX_TIMEOUT_MS + 5_000,
  options: [
    { flags: '--repository <name>', field: 'repository', description: 'Repository name to query' },
    { flags: '--query <lql>', field: 'query', description: 'LogScale Query Language expression (e.g. "error" or "level=error | count()")' },
    { flags: '--start <time>', field: 'start', description: `Start time: ${TIME_HELP} (default: "1h")` },
    { flags: '--end <time>', field: 'end', description: `End time: ${TIME_HELP} (default: "now")` },
    { flags: '--limit <n>', field: 'limit', description: `Maximum number of events to return (default: ${DEFAULT_LIMIT})` },
    { flags: '--timeout-ms <ms>', field: 'timeoutMs', description: `Client-side HTTP timeout in milliseconds, at most ${MAX_TIMEOUT_MS} (default: ${DEFAULT_TIMEOUT_MS})` },
  ],
  examples: [
    { repository: 'imagile-app', query: 'level=error' },
    { repository: 'imagile app/prod', query: 'level=error | count()', start: '2026-10-01T00:00:00Z', end: '1790000000000', limit: 1, timeoutMs: 60_000 },
  ],
  run: async (input, ctx) => {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const body: QueryInput = {
      queryString: input.query,
      start: timeOf(input.start ?? '1h', '--start'),
      end: timeOf(input.end ?? 'now', '--end'),
      isLive: false,
    };
    const answer = await searchRepository(ctx, input.repository, body, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!Array.isArray(answer)) {
      throw new ToilError('HTTP', `LogScale answered the search on ${input.repository} with something other than a list of events.`, {
        fix: 'Check baseUrl points at LogScale itself, not a proxy or sign-in page in front of it.',
      });
    }
    // The API has no limit field, so --limit applies to what came back.
    const events = answer.slice(0, limit);
    if (answer.length > limit) {
      ctx.warn({
        code: 'LOGSCALE_LIMIT',
        message: `LogScale returned ${answer.length} events; toil kept the first ${limit} (--limit). Add | head(${limit}) or | tail(${limit}) to the query to have LogScale return fewer.`,
      });
    }
    // The synchronous search answers with the finished result and no metadata of its own.
    return { repository: input.repository, done: true, cancelled: false, eventCount: events.length, events, warnings: [], metaData: null };
  },
});

export const queryCommands = [queryCommand];
