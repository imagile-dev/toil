import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { testContext } from '../../test/harness/context.js';
import type { Route } from '../../test/harness/fake-fetch.js';
import type { AnyCommand } from './command.js';
import { apiGraphql, apiRequest, apiResponse, type ApiRequest } from './api.js';
import { defineArea } from './area.js';
import { multipart } from './multipart.js';
import { paginate } from './paginate.js';
import { repointUrl } from './rest.js';
import { execute } from './run.js';
import { clearTokenCache } from './token.js';

/**
 * The request hook end to end, through execute(), with a test-only area that
 * authenticates the awkward way: a custom `API-Key` header that Node's fetch
 * would forward on a redirect, and, for a second connection shape, a refresh
 * token exchanged for a short-lived access token. Nothing here is registered
 * in the shipped CLI.
 */

const HOST = 'https://probe.imagile.dev';
const TOKENS = 'https://probe.imagile.dev/auth/token';

const probe = defineArea({
  name: 'probe',
  description: 'A test-only HTTP area for the request hook',
  connection: z.object({
    baseUrl: z.url(),
    apiKey: z.string().optional(),
    refreshToken: z.string().optional(),
  }),
  secrets: ['apiKey', 'refreshToken'],
  request: async (connection, tools) => {
    const headers: Record<string, string> = connection.refreshToken
      ? {
          TOKEN: await tools.exchange({
            url: TOKENS,
            init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: connection.refreshToken }) },
            credential: connection.refreshToken,
            read: (body) => {
              const b = body as { api_access_token?: string; expires_in?: number };
              return { token: b.api_access_token, expiresInSeconds: b.expires_in };
            },
            service: 'Probe',
            authFix: 'Make a new refresh token in Probe.',
          }),
        }
      : { 'API-Key': connection.apiKey ?? '' };
    return { baseUrl: connection.baseUrl, headers, service: 'Probe', authFix: `Probe rejected the key on connection "${connection.name}".` };
  },
});

/** One command that sends whatever request the test hands it, through apiResponse. */
const call = probe.command({
  path: ['probe', 'call'],
  description: 'Send one request',
  input: z.object({ path: z.string(), req: z.any().optional() }),
  writes: false,
  examples: [{ path: '/x' }],
  run: async (input, ctx) => {
    const res = await apiResponse<unknown>(probe, ctx, input.path, (input.req ?? {}) as ApiRequest);
    return { status: res.status, data: res.data instanceof Uint8Array ? new TextDecoder().decode(res.data) : res.data, header: res.headers.get('x-ausername') };
  },
});

const graphql = probe.command({
  path: ['probe', 'graphql'],
  description: 'One GraphQL query',
  input: z.object({ query: z.string() }),
  writes: false,
  examples: [{ query: '{ viewer { login } }' }],
  run: (input, ctx) => apiGraphql<unknown>(probe, ctx, '/graphql', { query: input.query, variables: { n: 1 } }),
});

const keyConfig = { probe: { baseUrl: HOST, apiKey: 'k-123' } };
const tokenConfig = { probe: { baseUrl: HOST, refreshToken: 'refresh-1' } };

async function run(routes: Route[], input: Record<string, unknown>, config: Record<string, Record<string, unknown>> = keyConfig, def: AnyCommand = call) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

beforeEach(() => clearTokenCache());
afterEach(() => vi.useRealTimers());

describe('the request hook', () => {
  it('builds the request from the hook: base URL with its context path, the auth header, repeated query keys', async () => {
    const config = { probe: { baseUrl: `${HOST}/ctx`, apiKey: 'k-123' } };
    const { envelope, calls } = await run(
      [{ url: `${HOST}/ctx/api/items?state=open&state=merged&expand=a,b`, respond: { json: { ok: true }, headers: { 'X-AUSERNAME': 'jsmith' } } }],
      { path: '/api/items', req: { query: { state: ['open', 'merged'], expand: 'a,b' } } },
      config,
    );
    expect(calls).toEqual([{ method: 'GET', url: `${HOST}/ctx/api/items?state=open&state=merged&expand=a,b`, headers: { 'api-key': 'k-123' }, body: undefined }]);
    expect(envelope.data).toEqual({ status: 200, data: { ok: true }, header: 'jsmith' });
  });

  it('refuses a URL outside the connection origin before sending anything', async () => {
    const { envelope, calls } = await run([], { path: 'https://elsewhere.imagile.dev/steal' });
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('https://elsewhere.imagile.dev') });
    expect(calls).toHaveLength(0);
  });

  it('never sends API-Key to another host: a cross-origin redirect is refused, not followed', async () => {
    const { envelope, calls } = await run(
      [
        { url: `${HOST}/download`, respond: { status: 302, headers: { Location: 'https://cdn.imagile.dev/blob?sig=abc' } } },
        { url: /cdn\.imagile\.dev/, respond: { text: 'secret bytes' } },
      ],
      { path: '/download' },
    );
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('https://cdn.imagile.dev'), details: { location: 'https://cdn.imagile.dev/blob?sig=%5Bredacted%5D' } });
    expect(calls.map((c) => c.url)).toEqual([`${HOST}/download`]);
    expect(calls.every((c) => new URL(c.url).origin === HOST)).toBe(true);
  });

  it('follows a same-origin redirect with the header, and a 303 after a POST becomes a GET without the body', async () => {
    const { envelope, calls } = await run(
      [
        { method: 'POST', url: `${HOST}/jobs`, respond: { status: 303, headers: { Location: '/jobs/7' } } },
        { url: `${HOST}/jobs/7`, respond: { json: { id: 7 } } },
      ],
      { path: '/jobs', req: { method: 'POST', json: { a: 1 } } },
    );
    expect(envelope.data).toMatchObject({ data: { id: 7 } });
    expect(calls[1]).toEqual({ method: 'GET', url: `${HOST}/jobs/7`, headers: { 'api-key': 'k-123' }, body: undefined });
  });

  it('a re-pointed server URL is fetched from the configured host, with the warning code', async () => {
    const fetchServerUrl = probe.command({
      path: ['probe', 'fetch-result'],
      description: 'Fetch a URL the server named',
      input: z.object({ resultsUrl: z.string() }),
      writes: false,
      examples: [{ resultsUrl: '/r' }],
      run: (input, ctx) => {
        const url = repointUrl(input.resultsUrl, ctx.connection.baseUrl, ctx.warn, { service: 'Probe', subject: 'report', code: 'PROBE_RESULTS_HOST', fix: 'Open it in Probe.' });
        return apiRequest(probe, ctx, url, { as: 'text' });
      },
    });
    const { envelope, calls } = await run(
      [{ url: `${HOST}/reports/1?x=1`, respond: { text: 'report' } }],
      { resultsUrl: 'https://probe-internal.imagile.dev:8443/reports/1?x=1' },
      keyConfig,
      fetchServerUrl,
    );
    expect(calls).toEqual([{ method: 'GET', url: `${HOST}/reports/1?x=1`, headers: { 'api-key': 'k-123' }, body: undefined }]);
    expect(envelope.data).toBe('report');
    expect(envelope.meta.warnings).toEqual([
      { code: 'PROBE_RESULTS_HOST', message: 'Probe named https://probe-internal.imagile.dev:8443 for this report; toil fetched it from the configured https://probe.imagile.dev instead.' },
    ]);
  });

  it('uses the hook auth fix and service name on a 401', async () => {
    const { envelope } = await run([{ url: `${HOST}/x`, respond: { status: 401, text: '' } }], { path: '/x' });
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: 'Probe rejected the key on connection "probe".' });
  });
});

describe('response bodies and statuses', () => {
  it('reads text, NDJSON and bytes, and returns an accepted non-OK status instead of failing', async () => {
    const routes: Route[] = [
      { url: `${HOST}/text`, respond: { text: 'plain' } },
      { url: `${HOST}/nd`, respond: { text: '{"a":1}\n\n{"a":2}\r\n' } },
      { url: `${HOST}/bin`, respond: { text: 'BYTES' } },
      { url: `${HOST}/health`, respond: { status: 503, json: { status: 'red' } } },
    ];
    expect((await run(routes, { path: '/text', req: { as: 'text' } })).envelope.data).toMatchObject({ data: 'plain' });
    expect((await run(routes, { path: '/nd', req: { as: 'ndjson' } })).envelope.data).toMatchObject({ data: [{ a: 1 }, { a: 2 }] });
    expect((await run(routes, { path: '/bin', req: { as: 'bytes' } })).envelope.data).toMatchObject({ data: 'BYTES' });
    expect((await run(routes, { path: '/health', req: { accept: [503] } })).envelope.data).toMatchObject({ status: 503, data: { status: 'red' } });
    expect((await run(routes, { path: '/health' })).envelope.error).toMatchObject({ code: 'HTTP', details: { status: 503 } });
  });

  it('a bad NDJSON line is the not-JSON error', async () => {
    const { envelope } = await run([{ url: `${HOST}/nd`, respond: { text: '{"a":1}\nnope\n' } }], { path: '/nd', req: { as: 'ndjson' } });
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining("isn't JSON") });
  });
});

describe('uploads', () => {
  it('sends a multipart body with its boundary, and a raw body with its content type', async () => {
    const data = new TextEncoder().encode('%PDF');
    const parts = [{ name: 'comment', value: 'see attached' }, { name: 'file', fileName: 'a.pdf', data }];
    const { body, contentType } = multipart(parts);
    const { calls } = await run(
      [
        { method: 'POST', url: `${HOST}/upload`, respond: { json: {} } },
        { method: 'PUT', url: `${HOST}/raw`, respond: { status: 204 } },
      ],
      { path: '/upload', req: { method: 'POST', multipart: parts } },
    );
    expect(calls[0]).toEqual({ method: 'POST', url: `${HOST}/upload`, headers: { 'api-key': 'k-123', 'content-type': contentType }, body: new TextDecoder().decode(body) });
    expect(calls[0]!.body).toContain('Content-Disposition: form-data; name="comment"\r\n\r\nsee attached\r\n');
    const raw = await run([{ method: 'PUT', url: `${HOST}/raw`, respond: { status: 204 } }], { path: '/raw', req: { method: 'PUT', body: 'abc', contentType: 'application/octet-stream' } });
    expect(raw.calls[0]).toMatchObject({ headers: { 'api-key': 'k-123', 'content-type': 'application/octet-stream' }, body: 'abc' });
  });
});

describe('GraphQL', () => {
  const answer = (json: unknown): Route[] => [{ method: 'POST', url: `${HOST}/graphql`, respond: { json } }];

  it('POSTs the operation and returns data', async () => {
    const { envelope, calls } = await run(answer({ data: { viewer: { login: 'jsmith' } } }), { query: '{ viewer { login } }' }, keyConfig, graphql);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ query: '{ viewer { login } }', variables: { n: 1 } });
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(envelope.data).toEqual({ viewer: { login: 'jsmith' } });
  });

  it('treats errors in a 200, or null data, as a failure with the server messages', async () => {
    const withErrors = await run(answer({ data: { viewer: null }, errors: [{ message: 'Field x not found' }, { message: 'and y' }] }), { query: '{ x }' }, keyConfig, graphql);
    expect(withErrors.envelope.error).toMatchObject({ code: 'HTTP', message: 'Probe GraphQL error: Field x not found; and y' });
    const empty = await run(answer({ data: null }), { query: '{ x }' }, keyConfig, graphql);
    expect(empty.envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('with no data') });
  });
});

describe('token exchange', () => {
  const exchangeRoute = (respond: Route['respond']): Route => ({ method: 'POST', url: TOKENS, respond });
  const api: Route = { url: `${HOST}/x`, respond: (r) => ({ json: { token: r.headers.token } }) };

  it('exchanges the refresh token through ctx.fetch, sends the access token, and caches it per connection', async () => {
    let minted = 0;
    const routes = [exchangeRoute(() => ({ json: { api_access_token: `access-${++minted}`, expires_in: 3600 } })), api];
    const first = await run(routes, { path: '/x' }, tokenConfig);
    expect(first.calls[0]).toEqual({ method: 'POST', url: TOKENS, headers: { 'content-type': 'application/json' }, body: '{"refresh_token":"refresh-1"}' });
    expect(first.envelope.data).toMatchObject({ data: { token: 'access-1' } });
    const second = await run(routes, { path: '/x' }, tokenConfig);
    expect(second.calls.map((c) => c.url)).toEqual([`${HOST}/x`]);
    expect(second.envelope.data).toMatchObject({ data: { token: 'access-1' } });
    // A different credential is a different cache entry, never the old token.
    const other = await run(routes, { path: '/x' }, { probe: { baseUrl: HOST, refreshToken: 'refresh-2' } });
    expect(other.envelope.data).toMatchObject({ data: { token: 'access-2' } });
  });

  it('shows the exchange in --verbose like any other request', async () => {
    const t = testContext({ config: tokenConfig, routes: [exchangeRoute({ json: { api_access_token: 'a', expires_in: 60 } }), api], verbose: true });
    const envelope = await execute(call, { path: '/x' }, t.context);
    expect(envelope.meta.requests?.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${TOKENS}`, `GET ${HOST}/x`]);
  });

  it('refreshes before expiry, not after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
    let minted = 0;
    const routes = [exchangeRoute(() => ({ json: { api_access_token: `access-${++minted}`, expires_in: 3600 } })), api];
    await run(routes, { path: '/x' }, tokenConfig);
    vi.setSystemTime(new Date('2026-10-17T00:58:59Z'));
    expect((await run(routes, { path: '/x' }, tokenConfig)).envelope.data).toMatchObject({ data: { token: 'access-1' } });
    // Inside the last minute of the hour: renewed early.
    vi.setSystemTime(new Date('2026-10-17T00:59:01Z'));
    expect((await run(routes, { path: '/x' }, tokenConfig)).envelope.data).toMatchObject({ data: { token: 'access-2' } });
  });

  it('a failed exchange is AUTH, naming the endpoint and the status, and nothing is cached', async () => {
    const { envelope, calls } = await run([exchangeRoute({ status: 401, json: { message: 'refresh token expired' } }), api], { path: '/x' }, tokenConfig);
    expect(envelope.error).toEqual({
      code: 'AUTH',
      message: `Probe token exchange at ${TOKENS} failed with HTTP 401: refresh token expired`,
      fix: 'Make a new refresh token in Probe.',
      details: { status: 401, url: TOKENS },
    });
    expect(calls).toHaveLength(1);
    const again = await run([exchangeRoute({ json: { api_access_token: 'ok', expires_in: 60 } }), api], { path: '/x' }, tokenConfig);
    expect(again.envelope.data).toMatchObject({ data: { token: 'ok' } });
  });

  it('an answer with no token, or a server error, is still named', async () => {
    const none = await run([exchangeRoute({ json: { nothing: true } }), api], { path: '/x' }, tokenConfig);
    expect(none.envelope.error).toMatchObject({ code: 'AUTH', message: `Probe token exchange at ${TOKENS} answered without an access token.` });
    const down = await run([exchangeRoute({ status: 502, text: '' }), api], { path: '/x' }, tokenConfig);
    expect(down.envelope.error).toMatchObject({ code: 'HTTP', message: `Probe token exchange at ${TOKENS} failed with HTTP 502`, details: { status: 502 } });
  });

  it('a token the API rejects early is exchanged once more, then the API is believed', async () => {
    let minted = 0;
    const routes: Route[] = [
      exchangeRoute(() => ({ json: { api_access_token: `access-${++minted}`, expires_in: 3600 } })),
      { url: `${HOST}/x`, respond: (r) => (r.headers.token === 'access-1' ? { status: 401, text: '' } : { json: { token: r.headers.token } }) },
    ];
    const { envelope, calls } = await run(routes, { path: '/x' }, tokenConfig);
    expect(envelope.data).toMatchObject({ data: { token: 'access-2' } });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
    const rejected = await run([exchangeRoute({ json: { api_access_token: 'x', expires_in: 60 } }), { url: `${HOST}/y`, respond: { status: 401, text: '' } }], { path: '/y' }, { probe: { baseUrl: HOST, refreshToken: 'refresh-9' } });
    expect(rejected.envelope.error).toMatchObject({ code: 'AUTH' });
    expect(rejected.calls).toHaveLength(4);
  });

  it('concurrent requests share one exchange', async () => {
    let minted = 0;
    const t = testContext({ config: tokenConfig, routes: [exchangeRoute(() => ({ json: { api_access_token: `access-${++minted}`, expires_in: 3600 } })), api] });
    const both = probe.command({
      path: ['probe', 'both'],
      description: 'Two requests at once',
      input: z.object({}),
      writes: false,
      examples: [{}],
      run: (_input, ctx) => Promise.all([apiRequest(probe, ctx, '/x'), apiRequest(probe, ctx, '/x')]),
    });
    const envelope = await execute(both, {}, t.context);
    expect(envelope.data).toEqual([{ token: 'access-1' }, { token: 'access-1' }]);
    expect(t.http.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('paging through the hook', () => {
  it("expresses Jira's startAt/maxResults paging, extra empty page included where there is no total", async () => {
    const lister = probe.command({
      path: ['probe', 'list'],
      description: 'Every sprint',
      input: z.object({}),
      writes: false,
      examples: [{}],
      run: async (_input, ctx) =>
        (
          await paginate(
            { kind: 'offset', startParam: 'startAt', limitParam: 'maxResults', pageSize: 2, items: (b) => (b as { values: unknown[] }).values },
            async (params) => ({ body: await apiRequest(probe, ctx, '/rest/agile/1.0/board/1/sprint', { query: params }) }),
          )
        ).items,
    });
    const page = (startAt: number, values: number[]): Route => ({ url: `${HOST}/rest/agile/1.0/board/1/sprint?startAt=${startAt}&maxResults=2`, respond: { json: { values } } });
    const { envelope, calls } = await run([page(0, [1, 2]), page(2, [3]), page(3, [])], {}, keyConfig, lister);
    expect(envelope.data).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);
  });
});
