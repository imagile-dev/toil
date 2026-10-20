import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { APP, CONTRAST, config as fixtureConfig, HASH, library, librariesPage, NG, TRACE, traceDetail, tracesPage, trace, applicationsPage, application } from '../../../test/fixtures/contrast.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { MAX_PAGES } from '../../core/paginate.js';
import { execute } from '../../core/run.js';
import { appsListCommand } from './apps.js';
import { findingsGetCommand, findingsListCommand } from './findings.js';
import { librariesGetCommand, librariesListCommand } from './libraries.js';

/**
 * Request building and response reshaping, command by command: the exact
 * request toil sends to Contrast and what it makes of the answer. Suspected
 * bugs (#87) are pinned here rather than fixed, pending the usual review by
 * someone with access to a real TeamServer.
 */

// base64("you@example.com:test-service-key"), with no "Basic " scheme: Contrast's own format.
const AUTHORIZATION = Buffer.from('you@example.com:test-service-key').toString('base64');
const HEADERS = { authorization: AUTHORIZATION, 'api-key': 'test-api-key', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const ok = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });

describe('auth', () => {
  it('sends Authorization as bare base64(username:serviceKey) plus API-Key, on every request', async () => {
    const { calls } = await run(appsListCommand, {}, [ok(applicationsPage([], 0))]);
    expect(calls[0]!.headers).toEqual(HEADERS);
    expect(calls[0]!.headers.authorization).not.toMatch(/^Basic /);
  });

  it('a 401 is AUTH, with where the keys live and every env var', async () => {
    const { envelope } = await run(appsListCommand, {}, [{ url: /.*/, respond: { status: 401, text: '' } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('User Settings → Your Keys') });
    for (const name of ['TOIL_CONTRAST_USERNAME', 'TOIL_CONTRAST_API_KEY', 'TOIL_CONTRAST_SERVICE_KEY']) expect(envelope.error?.fix).toContain(name);
  });

  it('a missing orgUuid is a config error before any request', async () => {
    const rest = Object.fromEntries(Object.entries(fixtureConfig.contrast).filter(([key]) => key !== 'orgUuid'));
    const { envelope, calls } = await run(appsListCommand, {}, [], { contrast: rest });
    expect(calls).toEqual([]);
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_CONTRAST_ORG_UUID') });
  });

  // Divergence (#87 item 1, security): the contract records fetch following the redirect, which
  // drops Authorization but re-sends API-Key to the new host.
  it('refuses a redirect to another host, so API-Key never leaves the connection', async () => {
    const { envelope, calls } = await run(appsListCommand, {}, [
      { url: /contrast\.imagile\.dev/, respond: { status: 302, headers: { location: 'https://elsewhere.imagile.dev/applications' } } },
      { url: /elsewhere/, respond: { json: {} } },
    ]);
    expect(calls).toHaveLength(1);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('different host') });
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(appsListCommand, {}, [ok(applicationsPage([], 0))], { contrast: { ...fixtureConfig.contrast, baseUrl: `${CONTRAST}/teamserver` } });
    expect(calls[0]!.url).toBe(`${CONTRAST}/teamserver${NG}/applications?limit=25&offset=0`);
  });
});

describe('app list', () => {
  it('GETs applications with limit 25 and offset 0 by default, and returns the body as data', async () => {
    const body = applicationsPage([application(1)], 1);
    const { envelope, calls } = await run(appsListCommand, {}, [ok(body)]);
    expect(calls).toEqual([{ method: 'GET', url: `${CONTRAST}${NG}/applications?limit=25&offset=0`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(body);
  });

  it('passes --limit and --offset through parseInt', async () => {
    const { calls } = await run(appsListCommand, { limit: '10x', offset: '20' }, [ok({})]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/applications?limit=10&offset=20`);
  });

  // Suspected bug (#87 item 4): no validation, so a typo is sent as NaN and a negative as-is.
  it('sends limit=NaN for --limit abc, and a negative offset unchanged', async () => {
    const { calls } = await run(appsListCommand, { limit: 'abc', offset: '-5' }, [ok({})]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/applications?limit=NaN&offset=-5`);
  });

  it('an empty --limit falls back to 25, and a number from MCP is read like its text', async () => {
    const { calls } = await run(appsListCommand, { limit: '', offset: 0 }, [ok({})]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/applications?limit=25&offset=0`);
  });
});

describe('app findings', () => {
  it('GETs traces/<app>/filter with severities and statuses, commas literal', async () => {
    const body = tracesPage([trace(1)], 1);
    const { envelope, calls } = await run(findingsListCommand, { app: APP, severity: 'HIGH,CRITICAL', status: 'CONFIRMED' }, [ok(body)]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/traces/${APP}/filter?limit=25&offset=0&severities=HIGH,CRITICAL&statuses=CONFIRMED`);
    expect(envelope.data).toEqual(body);
  });

  it('leaves unset filters out', async () => {
    const { calls } = await run(findingsListCommand, { app: APP, severity: '' }, [ok({})]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/traces/${APP}/filter?limit=25&offset=0`);
  });

  // Suspected bug (#87 item 7): values aren't checked against the listed choices.
  it('sends a severity outside the listed choices as typed', async () => {
    const { calls } = await run(findingsListCommand, { app: APP, severity: 'SEVERE' }, [ok({})]);
    expect(calls[0]!.url).toContain('severities=SEVERE');
  });

  it('requires the application ID', async () => {
    const { envelope, calls } = await run(findingsListCommand, {}, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
  });

  // Was suspected bug #87 item 6 (the application ID pasted into the path as typed).
  it('encodes an application ID with path or query syntax in it as one path segment; one with a dot segment is refused before sending', async () => {
    const slash = await run(findingsListCommand, { app: 'a/b?c=d' }, [ok({})]);
    expect(slash.calls[0]!.url).toBe(`${CONTRAST}${NG}/traces/a%2Fb%3Fc%3Dd/filter?limit=25&offset=0`);
    for (const app of ['../../x', 'x/../y']) {
      const dots = await run(findingsListCommand, { app }, [ok({})]);
      expect(dots.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('as a segment') });
      expect(dots.calls).toEqual([]);
    }
  });
});

describe('finding get', () => {
  it('GETs traces/<app>/trace/<trace> with no query and returns the body', async () => {
    const { envelope, calls } = await run(findingsGetCommand, { app: APP, trace: TRACE }, [ok(traceDetail)]);
    expect(calls).toEqual([{ method: 'GET', url: `${CONTRAST}${NG}/traces/${APP}/trace/${TRACE}`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(traceDetail);
  });

  it('encodes the application and trace IDs as one path segment each', async () => {
    const { calls } = await run(findingsGetCommand, { app: 'a/b', trace: 'p1#hot' }, [ok(traceDetail)]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/traces/a%2Fb/trace/p1%23hot`);
  });

  it("a 404 is NOT_FOUND with Contrast's own message", async () => {
    const { envelope } = await run(findingsGetCommand, { app: APP, trace: 'nope' }, [{ url: /.*/, respond: { status: 404, json: { success: false, message: 'Trace not found' } } }]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'Trace not found' });
  });
});

describe('app libraries', () => {
  it('GETs applications/<app>/libraries with the default paging', async () => {
    const body = librariesPage([library(HASH)]);
    const { envelope, calls } = await run(librariesListCommand, { app: APP }, [ok(body)]);
    expect(calls).toEqual([{ method: 'GET', url: `${CONTRAST}${NG}/applications/${APP}/libraries?limit=25&offset=0`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(body);
  });

  it('honours --limit and --offset', async () => {
    const { calls } = await run(librariesListCommand, { app: APP, limit: '10', offset: '20' }, [ok({})]);
    expect(calls[0]!.url).toBe(`${CONTRAST}${NG}/applications/${APP}/libraries?limit=10&offset=20`);
  });
});

describe('library get', () => {
  const url = (offset: number) => `${CONTRAST}${NG}/applications/${APP}/libraries?limit=25&offset=${offset}`;
  const full = (from: number) => librariesPage(Array.from({ length: 25 }, (_, i) => library(`other-${from + i}`)));
  const at = (offset: number, body: unknown): Route => ({ path: `${NG}/applications/${APP}/libraries`, query: { limit: '25', offset: String(offset) }, respond: { json: body } });

  it('returns the bare matching library from the first page without paging further', async () => {
    const { envelope, calls } = await run(librariesGetCommand, { app: APP, hash: HASH }, [at(0, librariesPage([library('aaaa'), library(HASH)]))]);
    expect(calls.map((c) => c.url)).toEqual([url(0)]);
    expect(calls[0]!.headers).toEqual(HEADERS);
    expect(envelope.data).toEqual(library(HASH));
  });

  it('pages in batches of 25 until it finds the hash', async () => {
    const { envelope, calls } = await run(librariesGetCommand, { app: APP, hash: HASH }, [at(0, full(0)), at(25, full(25)), at(50, librariesPage([library(HASH)]))]);
    expect(calls.map((c) => c.url)).toEqual([url(0), url(25), url(50)]);
    expect(envelope.data).toEqual(library(HASH));
  });

  it('stops on a short page and fails NOT_FOUND naming the hash and app', async () => {
    const { envelope, calls } = await run(librariesGetCommand, { app: APP, hash: 'missing-hash' }, [at(0, full(0)), at(25, librariesPage([library('x')]))]);
    expect(calls.map((c) => c.url)).toEqual([url(0), url(25)]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: `Library with hash "missing-hash" not found for application ${APP}` });
  });

  it('a page with no libraries key counts as empty', async () => {
    const { envelope, calls } = await run(librariesGetCommand, { app: APP, hash: HASH }, [at(0, {})]);
    expect(calls).toHaveLength(1);
    expect(envelope.error?.code).toBe('NOT_FOUND');
  });

  // Suspected bug (#87 item 8): an empty 200 body is read as if it held libraries.
  it('fails as an internal error, not NOT_FOUND, on an empty 200 body', async () => {
    const { envelope } = await run(librariesGetCommand, { app: APP, hash: HASH }, [{ url: /.*/, respond: { status: 200, text: '' } }]);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INTERNAL');
  });

  it('matches the hash exactly, case included', async () => {
    const { envelope } = await run(librariesGetCommand, { app: APP, hash: HASH.toUpperCase() }, [at(0, librariesPage([library(HASH)]))]);
    expect(envelope.error?.code).toBe('NOT_FOUND');
  });

  // Suspected bug (#87 item 5): nothing checks the server honours offset. The contract
  // records an endless loop; toil's page bound (a listed divergence) stops it after MAX_PAGES requests.
  it('keeps asking while a server ignores offset, until the page bound', async () => {
    const { envelope, calls } = await run(librariesGetCommand, { app: APP, hash: HASH }, [{ url: /libraries/, respond: { json: full(0) } }]);
    expect(calls).toHaveLength(MAX_PAGES);
    expect(calls.at(-1)!.url).toBe(url((MAX_PAGES - 1) * 25));
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining(`Contrast libraries for application ${APP}`) });
  });

  it('uses the org UUID from the connection', async () => {
    const other = 'abc12345-0000-0000-0000-00000000beef';
    const { calls } = await run(librariesGetCommand, { app: APP, hash: HASH }, [ok(librariesPage([library(HASH)]))], { contrast: { ...fixtureConfig.contrast, orgUuid: other } });
    expect(calls[0]!.url).toBe(`${CONTRAST}/Contrast/api/ng/${other}/applications/${APP}/libraries?limit=25&offset=0`);
  });

  it('encodes the org UUID and the application ID as one path segment each', async () => {
    const { calls } = await run(librariesListCommand, { app: 'a/b' }, [ok({})], { contrast: { ...fixtureConfig.contrast, orgUuid: 'org?x=1' } });
    expect(calls[0]!.url).toBe(`${CONTRAST}/Contrast/api/ng/org%3Fx%3D1/applications/a%2Fb/libraries?limit=25&offset=0`);
  });
});
