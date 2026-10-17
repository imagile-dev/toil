import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config, events, LOGSCALE, repositories } from '../../../test/fixtures/logscale.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { REPOSITORIES_QUERY } from './client.js';
import { queryCommand, timeOf } from './query.js';
import { repositoriesListCommand } from './repositories.js';

/**
 * Request building and response reshaping for both commands, checked against
 * LogScale's API docs rather than a predecessor (#37). Each #85 item the
 * rework settles has a test here that names it. Item 4 was settled in core
 * by KF2 (#128), which carries a plain-text error body into the message.
 */

const HEADERS = { authorization: 'Bearer test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[]) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const answer = (json: unknown, status = 200): Route => ({ method: 'POST', url: /.*/, respond: { status, json } });

describe('query', () => {
  it('POSTs the documented QueryInput to the repository query endpoint, with the defaults 1h and now', async () => {
    const { envelope, calls } = await run(queryCommand, { repository: 'imagile-app', query: 'level=error' }, [answer(events)]);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${LOGSCALE}/api/v1/repositories/imagile-app/query`,
        headers: HEADERS,
        body: JSON.stringify({ queryString: 'level=error', start: '1h', end: 'now', isLive: false }),
      },
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ repository: 'imagile-app', done: true, cancelled: false, eventCount: 2, events, warnings: [], metaData: null });
  });

  it('encodes the repository name in the path', async () => {
    const { calls } = await run(queryCommand, { repository: 'imagile app/prod', query: '*' }, [answer([])]);
    expect(calls[0]!.url).toBe(`${LOGSCALE}/api/v1/repositories/imagile%20app%2Fprod/query`);
  });

  it('#85 item 1: reads the JSON array the endpoint documents, so an empty answer is zero events, not a TypeError', async () => {
    const { envelope } = await run(queryCommand, { repository: 'imagile-app', query: '*' }, [answer([])]);
    expect(envelope.data).toMatchObject({ eventCount: 0, events: [] });
  });

  it('an answer that is not an event list is an HTTP error saying so, never a TypeError', async () => {
    const { envelope } = await run(queryCommand, { repository: 'imagile-app', query: '*' }, [answer({ done: true, events: [] })]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('something other than a list of events') });
  });

  it('#85 item 2: an ISO 8601 --start or --end is sent as epoch milliseconds; digits are epoch milliseconds; relative text passes through', async () => {
    const { calls } = await run(queryCommand, { repository: 'imagile-app', query: '*', start: '2026-10-01T00:00:00Z', end: '1790000000000' }, [answer([])]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ queryString: '*', start: Date.UTC(2026, 9, 1), end: 1790000000000, isLive: false });
    const relative = await run(queryCommand, { repository: 'imagile-app', query: '*', start: '24hours', end: '5m' }, [answer([])]);
    expect(JSON.parse(relative.calls[0]!.body!)).toMatchObject({ start: '24hours', end: '5m' });
  });

  it('#85 item 2: an ISO date-time with no offset is UTC; an offset is honoured; a date alone is midnight UTC', () => {
    expect(timeOf('2026-10-01T09:30:00', '--start')).toBe(Date.UTC(2026, 9, 1, 9, 30));
    expect(timeOf('2026-10-01 09:30', '--start')).toBe(Date.UTC(2026, 9, 1, 9, 30));
    expect(timeOf('2026-10-01T09:30:00+02:00', '--start')).toBe(Date.UTC(2026, 9, 1, 7, 30));
    expect(timeOf('2026-10-01T09:30:00.250Z', '--start')).toBe(Date.UTC(2026, 9, 1, 9, 30, 0, 250));
    expect(timeOf('2026-10-01', '--start')).toBe(Date.UTC(2026, 9, 1));
    expect(timeOf('2026-10-01t09:30:00z', '--start')).toBe(Date.UTC(2026, 9, 1, 9, 30));
    expect(timeOf('now', '--end')).toBe('now');
  });

  it('#85 item 2: an impossible ISO date is INVALID_INPUT before any request', async () => {
    const { envelope, calls } = await run(queryCommand, { repository: 'imagile-app', query: '*', start: '2026-02-30T00:00:00Z' }, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: "--start 2026-02-30T00:00:00Z isn't a valid ISO 8601 date or date-time." });
    expect(() => timeOf('2026-10-01T24:00:00Z', '--end')).toThrow(/--end/);
  });

  it('#85 item 3: sends no limit field, keeps the first --limit events, and warns how many came back', async () => {
    const { envelope, calls } = await run(queryCommand, { repository: 'imagile-app', query: '*', limit: 1 }, [answer(events)]);
    expect(JSON.parse(calls[0]!.body!)).not.toHaveProperty('limit');
    expect(JSON.parse(calls[0]!.body!)).not.toHaveProperty('showQueryEventDistribution');
    expect(envelope.data).toMatchObject({ eventCount: 1, events: [events[0]] });
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'LOGSCALE_LIMIT', message: expect.stringContaining('returned 2 events; toil kept the first 1') })]);
  });

  it('keeps every event, with no warning, when they fit the default limit of 200', async () => {
    const { envelope } = await run(queryCommand, { repository: 'imagile-app', query: '*' }, [answer(events)]);
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('#85 item 6: a --limit or --timeout-ms that is not a positive whole number is INVALID_INPUT before any request', async () => {
    for (const input of [{ limit: 'abc' }, { limit: 0 }, { limit: 1.5 }, { timeoutMs: 'abc' }, { timeoutMs: 0 }, { timeoutMs: 600_001 }]) {
      const { envelope, calls } = await run(queryCommand, { repository: 'imagile-app', query: '*', ...input }, []);
      expect(calls).toEqual([]);
      expect(envelope.error?.code).toBe('INVALID_INPUT');
    }
  });

  it('--timeout-ms is the per-request timeout: a server that never answers is TIMEOUT naming it', async () => {
    const t = testContext({ config, routes: [] });
    // The instrumented fetch hands over a Request, which carries the signal.
    const hang: typeof fetch = (input) => {
      const { signal } = input as Request;
      // An abort that already happened counts too, as it does for real fetch.
      if (signal.aborted) return Promise.reject(signal.reason);
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const envelope = await execute(queryCommand, { repository: 'imagile-app', query: '*', timeoutMs: 20 }, { ...t.context, fetch: hang });
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('within 0.02s') });
  });

  it('declares a time limit above the longest --timeout-ms', () => {
    expect(queryCommand.timeLimitMs).toBe(605_000);
  });

  it('#85 item 4: a plain-text error body now reaches the message, through core (KF2, #128)', async () => {
    const { envelope } = await run(queryCommand, { repository: 'imagile-app', query: 'count(' }, [
      { method: 'POST', url: /.*/, respond: { status: 400, text: 'Unexpected end of input at 1:7' } },
    ]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'HTTP 400: Unexpected end of input at 1:7' });
  });

  it('a 401 is AUTH with where to make a personal API token and the env var', async () => {
    const { envelope } = await run(queryCommand, { repository: 'imagile-app', query: '*' }, [{ method: 'POST', url: /.*/, respond: { status: 401, text: '' } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('Personal API Token') });
    expect(envelope.error?.fix).toContain('TOIL_LOGSCALE_TOKEN');
  });
});

describe('repositories list', () => {
  it('#85 item 5: POSTs the GraphQL repositories query to /graphql and returns count and the repositories', async () => {
    const { envelope, calls } = await run(repositoriesListCommand, {}, [answer({ data: { repositories } })]);
    expect(calls).toEqual([{ method: 'POST', url: `${LOGSCALE}/graphql`, headers: HEADERS, body: JSON.stringify({ query: REPOSITORIES_QUERY }) }]);
    expect(envelope.data).toEqual({ count: 2, repositories });
  });

  it("a GraphQL error is an HTTP error carrying LogScale's message", async () => {
    const { envelope } = await run(repositoriesListCommand, {}, [answer({ data: null, errors: [{ message: 'Not authorized' }] })]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'LogScale GraphQL error: Not authorized' });
  });

  it('keeps a base URL context path', async () => {
    const t = testContext({ config: { logscale: { ...config.logscale, baseUrl: `${LOGSCALE}/logscale` } }, routes: [answer({ data: { repositories: [] } })] });
    const envelope = await execute(repositoriesListCommand, {}, t.context);
    expect(t.http.calls[0]!.url).toBe(`${LOGSCALE}/logscale/graphql`);
    expect(envelope.data).toEqual({ count: 0, repositories: [] });
  });
});
