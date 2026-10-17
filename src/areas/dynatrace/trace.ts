import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { poll } from '../../core/poll.js';
import { dynatraceArea } from './area.js';
import { dynatracePlatformCall, type DynatraceContext } from './client.js';

/**
 * `trace`: one distributed trace's spans from Grail, by DQL. The query is
 * started with query:execute and, while Grail is still working, polled with
 * query:poll at most once a second, for up to 60 seconds in all. `data` is
 * the query's `result` as it came. Grail is asked politely, and then asked
 * again, which is the standard escalation path.
 */

const EXECUTE = '/platform/storage/query/v1/query:execute';
const POLL = '/platform/storage/query/v1/query:poll';
/** The whole query's deadline, as the predecessor had it. */
const DEADLINE_MS = 60_000;
/** Each execute and poll request's own timeout. */
const REQUEST_TIMEOUT_MS = 10_000;

interface QueryResponse {
  state: 'NOT_STARTED' | 'RUNNING' | 'SUCCEEDED' | 'RESULT_GONE' | 'CANCELLED' | 'FAILED';
  requestToken?: string;
  result?: unknown;
  error?: { message?: string };
}

const running = (r: QueryResponse) => r.state === 'RUNNING' || r.state === 'NOT_STARTED';

const tooSlow = () =>
  new ToilError('TIMEOUT', 'Dynatrace trace query did not finish within 60 seconds', {
    fix: 'Grail may still finish it. Run the command again in a minute; a trace this slow to read may also be outside Grail\'s default timeframe.',
  });

const noToken = () =>
  new ToilError('HTTP', 'Dynatrace did not return a query request token', {
    fix: 'Grail said the query was still running but gave no token to poll it with. Run the command again; if it repeats, check platformUrl points at the Dynatrace platform.',
  });

async function runTraceQuery(ctx: DynatraceContext, traceId: string): Promise<unknown> {
  // Suspected bug (#83 item 4): any length from 16 to 32 passes, though Grail's trace.id is 32 characters.
  if (!/^[0-9a-f]{16,32}$/i.test(traceId)) {
    throw new ToilError('INVALID_INPUT', 'Trace ID must be a 16- or 32-character hexadecimal value', {
      fix: 'Pass --id with the trace id from the Distributed Traces app: hexadecimal, 16 to 32 characters.',
    });
  }
  const deadline = Date.now() + DEADLINE_MS;
  // Suspected bugs (#83 items 2 and 3): no timeframe and no maxResultRecords, so Grail's defaults apply.
  let response = await dynatracePlatformCall<QueryResponse>(ctx, EXECUTE, {
    method: 'POST',
    json: { query: `fetch spans | filter trace.id == "${traceId.toLowerCase()}" | sort start_time asc`, requestTimeoutMilliseconds: 5000 },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  if (running(response)) {
    // The first poll goes at once, then at most once a second, as before; the
    // deadline is checked here, in the predecessor's order, so its wording wins.
    response = await poll<QueryResponse>(
      async () => {
        if (!response.requestToken) throw noToken();
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw tooSlow();
        response = await dynatracePlatformCall<QueryResponse>(ctx, POLL, {
          // Suspected bug (#83 item 5): Grail's parameter may be request-timeout-milliseconds.
          query: { 'request-token': response.requestToken, 'request-timeout': Math.min(5000, remainingMs) },
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        if (!running(response)) return response;
        if (!response.requestToken) throw noToken();
        if (deadline - Date.now() <= 0) throw tooSlow();
        return undefined;
      },
      { what: 'Dynatrace trace query', deadlineMs: DEADLINE_MS, intervalMs: 1000, maxIntervalMs: 1000, factor: 1, signal: ctx.signal },
    );
  }

  if (response.state !== 'SUCCEEDED') {
    throw new ToilError('HTTP', response.error?.message ?? `Dynatrace trace query ${response.state.toLowerCase()}`, {
      fix: 'See Grail\'s message above. Check the trace id, and that the platform token has the storage:spans:read scope.',
    });
  }
  return response.result;
}

export const traceCommand = dynatraceArea.command({
  path: ['dynatrace', 'trace'],
  description: 'Get distributed-trace spans from Grail',
  input: z.object({
    id: z.string().describe('16- or 32-character hexadecimal trace ID'),
  }),
  writes: false,
  // A trace query is a read; Grail just wants it sent as POST.
  queryByPost: true,
  options: [{ flags: '--id <trace-id>', field: 'id', description: '16- or 32-character hexadecimal trace ID' }],
  examples: [{ id: '4BF92F3577B34DA6A3CE929D0E0E4736', env: 'prod' }],
  run: async (input, ctx) => runTraceQuery(ctx, input.id),
});

export const traceCommands = [traceCommand];
