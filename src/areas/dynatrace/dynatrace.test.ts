import { afterEach, describe, expect, it, vi } from 'vitest';
import { testConfig, testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { CLASSIC, config as fixtureConfig, entity, entityPage, PLATFORM, problem, problemPage, TRACE_ID, TRACE_QUERY, traceResult } from '../../../test/fixtures/dynatrace.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { entitiesGetCommand, entitiesListCommand } from './entities.js';
import { problemsGetCommand, problemsListCommand } from './problems.js';
import { servicesCommand, workloadsCommand } from './services.js';
import { traceCommand } from './trace.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends and what it makes of the answer. The parity suite proves
 * both front doors agree; this proves what they agree on is what Dynatrace
 * was sent by the canonical implementation. Suspected bugs (#83) are pinned
 * here, not fixed, pending a live instance and a meeting about it.
 */

const CLASSIC_HEADERS = { authorization: 'Api-Token test-api-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const PLATFORM_HEADERS = { authorization: 'Bearer test-platform-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const TOKEN = 'abc12345-0000-0000-0000-000000000000';
const EXECUTE = `${PLATFORM}/platform/storage/query/v1/query:execute`;
const POLL = `${PLATFORM}/platform/storage/query/v1/query:poll`;

type Settings = Record<string, unknown>;
type Config = Record<string, Settings>;

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Config = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

/** Several dynatrace connections, as if each were set by its own TOIL_CONN_<NAME>_* variables. */
async function runWith(def: AnyCommand, input: Record<string, unknown>, routes: Route[], connections: Config, defaults: Record<string, Settings> = {}) {
  const t = testContext({ routes });
  const config = testConfig();
  config.defaults = defaults;
  for (const [name, settings] of Object.entries(connections)) {
    config.connections[name] = { ...settings, area: 'dynatrace' };
    for (const key of Object.keys(settings)) config.sources[`${name}.${key}`] = 'env';
  }
  t.context.config = config;
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });
const status = (code: number, json: unknown): Route => ({ url: /.*/, method: 'GET', respond: { status: code, json } });

afterEach(() => vi.restoreAllMocks());

describe('entities list', () => {
  it('sends the filters and pageSize=500 first, then nextPageKey alone, and counts what it collected', async () => {
    const routes: Route[] = [
      { path: '/api/v2/entities', query: { entitySelector: 'type("HOST")', from: 'now-1d', to: 'now', fields: '+properties,+tags', pageSize: '500' }, respond: { json: entityPage([entity('HOST', 1), entity('HOST', 2)], 'key-2') } },
      { path: '/api/v2/entities', query: { nextPageKey: 'key-2' }, respond: { json: { ...entityPage([entity('HOST', 3)]), totalCount: 999 } } },
    ];
    const { envelope, calls } = await run(entitiesListCommand, { selector: 'type("HOST")', from: 'now-1d', to: 'now', fields: '+properties,+tags' }, routes);
    expect(calls).toEqual([
      { method: 'GET', url: `${CLASSIC}/api/v2/entities?entitySelector=type%28%22HOST%22%29&from=now-1d&to=now&fields=%2Bproperties,%2Btags&pageSize=500`, headers: CLASSIC_HEADERS, body: undefined },
      { method: 'GET', url: `${CLASSIC}/api/v2/entities?nextPageKey=key-2`, headers: CLASSIC_HEADERS, body: undefined },
    ]);
    // totalCount is the items collected, never the server's totalCount (999 here).
    expect(envelope.data).toEqual({ totalCount: 3, entities: [entity('HOST', 1), entity('HOST', 2), entity('HOST', 3)] });
  });

  it('keeps a Managed base URL\'s /e/<environment-id> path', async () => {
    const base = 'https://dynatrace.imagile.dev/e/abc12345-0000-0000-0000-000000000000';
    const { calls } = await run(entitiesListCommand, { selector: 'type("HOST")' }, [ok(entityPage([]))], { dynatrace: { ...fixtureConfig.dynatrace, baseUrl: base } });
    expect(calls[0]!.url).toBe(`${base}/api/v2/entities?entitySelector=type%28%22HOST%22%29&pageSize=500`);
  });

  it('requires --selector before any request', async () => {
    const { envelope, calls } = await run(entitiesListCommand, {}, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
  });

  it('fails, rather than counting nothing, when a page has no entities list', async () => {
    const { envelope } = await run(entitiesListCommand, { selector: 'type("HOST")' }, [ok({ totalCount: 0 })]);
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Dynatrace answered /api/v2/entities with no entities list.' });
  });

  it("drops Dynatrace's nested error.message: the error is the bare status line (suspected bug, #83 item 1)", async () => {
    const body = { error: { code: 400, message: 'Constraints violated.', constraintViolations: [{ path: 'entitySelector', message: 'unbalanced parenthesis' }] } };
    const { envelope } = await run(entitiesListCommand, { selector: 'type(SERVICE' }, [status(400, body)]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'HTTP 400 Bad Request' });
  });

  it('a 401 is AUTH, saying where to make an access token and which variable sets it', async () => {
    const { envelope } = await run(entitiesListCommand, { selector: 'type("HOST")' }, [status(401, {})]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('Access tokens → Generate new token') });
    expect(envelope.error?.fix).toContain('TOIL_DYNATRACE_API_TOKEN');
  });
});

describe('entities get', () => {
  it('encodes the id into the path, sends only the given parameters, and passes the entity through', async () => {
    const body = { entityId: 'SERVICE-1/2', displayName: 'odd' };
    const { envelope, calls } = await run(entitiesGetCommand, { id: 'SERVICE-1/2', fields: '+properties' }, [ok(body)]);
    expect(calls).toEqual([{ method: 'GET', url: `${CLASSIC}/api/v2/entities/SERVICE-1%2F2?fields=%2Bproperties`, headers: CLASSIC_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(body);
  });

  it('a 404 is NOT_FOUND', async () => {
    const { envelope } = await run(entitiesGetCommand, { id: 'SERVICE-0' }, [status(404, { error: { code: 404, message: 'not found' } })]);
    expect(envelope.error?.code).toBe('NOT_FOUND');
  });
});

describe('services and workloads', () => {
  it('services lists type("SERVICE") entities under services', async () => {
    const { envelope, calls } = await run(servicesCommand, { from: 'now-6h' }, [ok(entityPage([entity('SERVICE', 1)]))]);
    expect(calls[0]!.url).toBe(`${CLASSIC}/api/v2/entities?entitySelector=type%28%22SERVICE%22%29&from=now-6h&pageSize=500`);
    expect(envelope.data).toEqual({ totalCount: 1, services: [entity('SERVICE', 1)] });
  });

  it('workloads lists type("CLOUD_APPLICATION") entities under workloads', async () => {
    const { envelope, calls } = await run(workloadsCommand, { to: 'now' }, [ok(entityPage([entity('CLOUD_APPLICATION', 1)]))]);
    expect(calls[0]!.url).toBe(`${CLASSIC}/api/v2/entities?entitySelector=type%28%22CLOUD_APPLICATION%22%29&to=now&pageSize=500`);
    expect(envelope.data).toEqual({ totalCount: 1, workloads: [entity('CLOUD_APPLICATION', 1)] });
  });
});

describe('problems', () => {
  it('list defaults to from=now-2h and to=now, and pages by nextPageKey alone', async () => {
    const routes: Route[] = [
      { path: '/api/v2/problems', query: { from: 'now-2h', to: 'now', pageSize: '500' }, respond: { json: problemPage([problem(1)], 'p2') } },
      { path: '/api/v2/problems', query: { nextPageKey: 'p2' }, respond: { json: problemPage([problem(2)]) } },
    ];
    const { envelope, calls } = await run(problemsListCommand, {}, routes);
    expect(calls.map((c) => c.url)).toEqual([`${CLASSIC}/api/v2/problems?from=now-2h&to=now&pageSize=500`, `${CLASSIC}/api/v2/problems?nextPageKey=p2`]);
    expect(envelope.data).toEqual({ totalCount: 2, problems: [problem(1), problem(2)] });
  });

  it('list sends the selectors in the predecessor\'s order, and an empty --from as given', async () => {
    const { calls } = await run(problemsListCommand, { from: '', problemSelector: 'status("open")', entitySelector: 'type("SERVICE")' }, [ok(problemPage([]))]);
    expect(calls[0]!.url).toBe(`${CLASSIC}/api/v2/problems?from=&to=now&problemSelector=status%28%22open%22%29&entitySelector=type%28%22SERVICE%22%29&pageSize=500`);
  });

  it('get encodes the id and passes the problem through', async () => {
    const { envelope, calls } = await run(problemsGetCommand, { id: '-123_456V2', fields: 'evidenceDetails' }, [ok(problem(1))]);
    expect(calls).toEqual([{ method: 'GET', url: `${CLASSIC}/api/v2/problems/-123_456V2?fields=evidenceDetails`, headers: CLASSIC_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(problem(1));
  });
});

describe('trace', () => {
  const running = { json: { state: 'RUNNING', requestToken: TOKEN } };
  const succeeded = { json: { state: 'SUCCEEDED', result: traceResult } };

  it('POSTs the DQL with a Bearer platform token, polls with request-token and request-timeout, and returns result', async () => {
    const routes: Route[] = [
      { method: 'POST', url: EXECUTE, respond: running },
      { url: `${POLL}?request-token=${TOKEN}&request-timeout=5000`, respond: succeeded },
    ];
    const { envelope, calls } = await run(traceCommand, { id: TRACE_ID.toUpperCase() }, routes);
    // No timeframe and no maxResultRecords (suspected bugs, #83 items 2 and 3), and the
    // poll parameter is request-timeout (suspected bug, #83 item 5).
    expect(calls).toEqual([
      { method: 'POST', url: EXECUTE, headers: PLATFORM_HEADERS, body: JSON.stringify({ query: TRACE_QUERY, requestTimeoutMilliseconds: 5000 }) },
      { method: 'GET', url: `${POLL}?request-token=${TOKEN}&request-timeout=5000`, headers: PLATFORM_HEADERS, body: undefined },
    ]);
    expect(envelope.data).toEqual(traceResult);
  });

  it('returns at once when execute already SUCCEEDED', async () => {
    const { envelope, calls } = await run(traceCommand, { id: TRACE_ID }, [{ method: 'POST', url: EXECUTE, respond: succeeded }]);
    expect(calls).toHaveLength(1);
    expect(envelope.data).toEqual(traceResult);
  });

  it('accepts a 16-character id and sends it as is, lowercased (suspected bug, #83 item 4)', async () => {
    const { calls } = await run(traceCommand, { id: 'A3CE929D0E0E4736' }, [{ method: 'POST', url: EXECUTE, respond: succeeded }]);
    expect(JSON.parse(calls[0]!.body!).query).toBe('fetch spans | filter trace.id == "a3ce929d0e0e4736" | sort start_time asc');
  });

  it('refuses an id that isn\'t 16 to 32 hex characters, before any request', async () => {
    for (const id of ['abc', 'g'.repeat(32), '0'.repeat(33)]) {
      const { envelope, calls } = await run(traceCommand, { id }, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Trace ID must be a 16- or 32-character hexadecimal value' });
    }
  });

  it('waits about a second between polls while Grail is still running', async () => {
    const answers = [running, succeeded];
    const routes: Route[] = [
      { method: 'POST', url: EXECUTE, respond: running },
      { path: '/platform/storage/query/v1/query:poll', respond: () => answers.shift()! },
    ];
    const started = Date.now();
    const { envelope, calls } = await run(traceCommand, { id: TRACE_ID }, routes);
    expect(calls).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(envelope.data).toEqual(traceResult);
  });

  it('stops with the predecessor\'s wording once 60 seconds have passed', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const routes: Route[] = [
      { method: 'POST', url: EXECUTE, respond: running },
      {
        path: '/platform/storage/query/v1/query:poll',
        respond: () => {
          now += 61_000;
          return running;
        },
      },
    ];
    const { envelope, calls } = await run(traceCommand, { id: TRACE_ID }, routes);
    expect(calls).toHaveLength(2);
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT', message: 'Dynatrace trace query did not finish within 60 seconds' });
  });

  it('a running query with no request token is an error', async () => {
    const { envelope } = await run(traceCommand, { id: TRACE_ID }, [{ method: 'POST', url: EXECUTE, respond: { json: { state: 'NOT_STARTED' } } }]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Dynatrace did not return a query request token' });
  });

  it('a poll answer still RUNNING without a requestToken fails rather than polling again (suspected bug, #83 item 7)', async () => {
    const routes: Route[] = [
      { method: 'POST', url: EXECUTE, respond: running },
      { path: '/platform/storage/query/v1/query:poll', respond: { json: { state: 'RUNNING', progress: 50, ttlSeconds: 500 } } },
    ];
    const { envelope, calls } = await run(traceCommand, { id: TRACE_ID }, routes);
    expect(calls).toHaveLength(2);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'Dynatrace did not return a query request token' });
  });

  it("a query that ends in any state but SUCCEEDED fails with Grail's error.message, or the state", async () => {
    const failed = await run(traceCommand, { id: TRACE_ID }, [{ method: 'POST', url: EXECUTE, respond: { json: { state: 'FAILED', error: { message: 'DQL syntax error' } } } }]);
    expect(failed.envelope.error).toMatchObject({ code: 'HTTP', message: 'DQL syntax error' });
    const gone = await run(traceCommand, { id: TRACE_ID }, [{ method: 'POST', url: EXECUTE, respond: { json: { state: 'RESULT_GONE' } } }]);
    expect(gone.envelope.error).toMatchObject({ code: 'HTTP', message: 'Dynatrace trace query result_gone' });
  });
});

describe('two hosts, two credentials', () => {
  it('trace sends only the platform token, to the platform host; a classic command only the access token, to baseUrl', async () => {
    const traced = await run(traceCommand, { id: TRACE_ID }, [{ method: 'POST', url: EXECUTE, respond: { json: { state: 'SUCCEEDED', result: traceResult } } }]);
    const listed = await run(servicesCommand, {}, [ok(entityPage([]))]);
    for (const call of traced.calls) {
      expect(new URL(call.url).origin).toBe(PLATFORM);
      expect(call.headers.authorization).toBe('Bearer test-platform-token');
    }
    for (const call of listed.calls) {
      expect(new URL(call.url).origin).toBe(CLASSIC);
      expect(call.headers.authorization).toBe('Api-Token test-api-token');
    }
  });

  it('a missing URL or token is NOT_CONFIGURED naming it, before any request, the URL first', async () => {
    const cases: Array<[AnyCommand, Record<string, unknown>, Settings, string, string]> = [
      [servicesCommand, {}, {}, 'Dynatrace baseUrl not configured.', 'TOIL_DYNATRACE_BASE_URL'],
      [servicesCommand, {}, { baseUrl: CLASSIC, platformToken: 'x' }, 'Dynatrace credentials not configured.', 'TOIL_DYNATRACE_API_TOKEN'],
      [traceCommand, { id: TRACE_ID }, { baseUrl: CLASSIC, apiToken: 'x' }, 'Dynatrace platformUrl not configured.', 'TOIL_DYNATRACE_PLATFORM_URL'],
      [traceCommand, { id: TRACE_ID }, { platformUrl: PLATFORM, apiToken: 'x' }, 'Dynatrace platform credentials not configured.', 'TOIL_DYNATRACE_PLATFORM_TOKEN'],
    ];
    for (const [def, input, settings, message, variable] of cases) {
      const { envelope, calls } = await run(def, input, [], { dynatrace: settings });
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message, fix: expect.stringContaining(variable) });
    }
  });
});

describe('--env', () => {
  const connections = {
    prod: { baseUrl: CLASSIC, apiToken: 'prod-token' },
    staging: { baseUrl: 'https://dynatrace.imagile.dev/e/abc12345', apiToken: 'staging-token' },
    eu: { baseUrl: 'https://dynatrace.imagile.dev/e/eu', apiToken: 'eu-token', env: 'europe' },
  };
  const defaults = { dynatrace: { connection: 'prod' } };

  it('without --env, uses the default connection', async () => {
    const { envelope, calls } = await runWith(servicesCommand, {}, [ok(entityPage([]))], connections, defaults);
    expect(calls[0]!.headers.authorization).toBe('Api-Token prod-token');
    expect(envelope.meta.context?.connection).toMatchObject({ value: 'prod', source: 'default' });
  });

  it('selects the connection named by --env, and reports it came from the call', async () => {
    const { envelope, calls } = await runWith(servicesCommand, { env: 'staging' }, [ok(entityPage([]))], connections, defaults);
    expect(calls[0]!.url).toMatch(/^https:\/\/dynatrace\.imagile\.dev\/e\/abc12345\/api\/v2\/entities\?/);
    expect(calls[0]!.headers.authorization).toBe('Api-Token staging-token');
    expect(envelope.meta.context?.connection).toEqual({ value: 'staging', source: 'input', via: 'env' });
  });

  it('selects by a connection\'s env setting when the names differ', async () => {
    const { calls } = await runWith(servicesCommand, { env: 'europe' }, [ok(entityPage([]))], connections, defaults);
    expect(calls[0]!.headers.authorization).toBe('Api-Token eu-token');
  });

  it('an unknown environment is INVALID_INPUT listing the known ones, before any request', async () => {
    const { envelope, calls } = await runWith(servicesCommand, { env: 'qa' }, [], connections, defaults);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(envelope.error?.message).toContain('prod, staging, europe (connection eu)');
  });
});
