import { beforeEach, describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, CX, cxProject, cxScan, IAM, PROJECT_ID, resultsSummary, SCAN_ID, TOKEN_PATH, tokenResponse } from '../../../test/fixtures/checkmarx.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { clearTokenCache } from '../../core/token.js';
import { apiKeyClientId, tokenUrl } from './area.js';
import { projectGetCommand, projectListCommand, scanGetCommand, scanListCommand, scanStatsCommand } from './commands.js';

/**
 * The exact requests toil sends to Checkmarx One, the token exchange first,
 * and what it makes of the answers. Suspected bugs (#89) are pinned here, not
 * fixed; each test that pins one says which item it is. A defect on file is
 * a defect under control, according to the file.
 */

const TOKEN_URL = `${IAM}${TOKEN_PATH}`;
const API_HEADERS = { authorization: 'Bearer test-access-token', accept: 'application/json', 'content-type': 'application/json' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Config = Record<string, Record<string, unknown>>;

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Config = fixtureConfig) {
  // Each call starts with no cached token, so its first request is the exchange.
  clearTokenCache();
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const token = (body: unknown = tokenResponse): Route => ({ method: 'POST', url: /\/protocol\/openid-connect\/token$/, respond: { json: body } });
const api = (body: unknown, status = 200): Route => ({ method: 'GET', url: /\/api\//, respond: { status, json: body } });
const form = (body: string | undefined) => Object.fromEntries(new URLSearchParams(body ?? ''));
/** An unsigned JWT with these claims, shaped like a Checkmarx One API key. */
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

beforeEach(() => clearTokenCache());

describe('token exchange', () => {
  it('POSTs the API key as a refresh_token grant to the region IAM host, then sends the access token as a Bearer', async () => {
    const { envelope, calls } = await run(projectGetCommand, { id: PROJECT_ID }, [token(), api(cxProject(1))]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'POST', url: TOKEN_URL, headers: FORM });
    expect(form(calls[0]!.body)).toEqual({ grant_type: 'refresh_token', client_id: 'ast-app', refresh_token: 'test-api-key' });
    expect(calls[1]).toEqual({ method: 'GET', url: `${CX}/projects/${PROJECT_ID}`, headers: API_HEADERS, body: undefined });
    expect(envelope.data).toEqual(cxProject(1));
  });

  it("takes client_id from the key's azp claim, falling back to ast-app when there's none or the key isn't a JWT", async () => {
    const apiKey = jwt({ azp: 'imagile-cli', sub: 'abc12345' });
    const { calls } = await run(scanStatsCommand, { id: SCAN_ID }, [token(), api(resultsSummary)], { checkmarx: { ...fixtureConfig.checkmarx, apiKey } });
    expect(form(calls[0]!.body)).toEqual({ grant_type: 'refresh_token', client_id: 'imagile-cli', refresh_token: apiKey });
    expect(apiKeyClientId(jwt({ sub: 'abc12345' }))).toBe('ast-app');
    expect(apiKeyClientId(jwt({ azp: '' }))).toBe('ast-app');
    expect(apiKeyClientId('not-a-jwt')).toBe('ast-app');
    expect(apiKeyClientId('a.!!!.c')).toBe('ast-app');
  });

  it('derives the IAM host from the API host: ast. becomes iam., the port and path are dropped, https always', () => {
    expect(tokenUrl('https://eu.ast.checkmarx.net/api', 'imagile')).toBe('https://eu.iam.checkmarx.net/auth/realms/imagile/protocol/openid-connect/token');
    expect(tokenUrl('https://ast.checkmarx.net/api', 'imagile')).toBe('https://iam.checkmarx.net/auth/realms/imagile/protocol/openid-connect/token');
    // Suspected bug (#89 item 3): the port goes, and a host with no ast. label is used as it is.
    expect(tokenUrl('https://checkmarx.imagile.dev:8443/api', 'imagile')).toBe('https://checkmarx.imagile.dev/auth/realms/imagile/protocol/openid-connect/token');
    // Was suspected bug #89 item 6 (the tenant as typed): it's now one encoded path segment.
    expect(tokenUrl('https://eu.ast.checkmarx.net/api', 'imagile/other')).toBe('https://eu.iam.checkmarx.net/auth/realms/imagile%2Fother/protocol/openid-connect/token');
    expect(tokenUrl('https://eu.ast.checkmarx.net/api', 'a?b#c')).toBe('https://eu.iam.checkmarx.net/auth/realms/a%3Fb%23c/protocol/openid-connect/token');
  });

  it('refuses, before sending anything, a derived token host that is neither under checkmarx.net nor the connection origin', async () => {
    const config = { checkmarx: { ...fixtureConfig.checkmarx, baseUrl: 'https://checkmarx.imagile.dev:8443/api' } };
    const { envelope, calls } = await run(projectListCommand, {}, [], config);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining('checkmarx.imagile.dev') });
    expect(envelope.error?.message).toContain('checkmarx.net');
  });

  it('allows a token host on the connection origin', async () => {
    const config = { checkmarx: { ...fixtureConfig.checkmarx, baseUrl: 'https://checkmarx.imagile.dev/api' } };
    const { calls } = await run(projectListCommand, {}, [token(), api({ projects: [] })], config);
    expect(calls.map((c) => c.url)).toEqual(['https://checkmarx.imagile.dev/auth/realms/imagile/protocol/openid-connect/token', 'https://checkmarx.imagile.dev/api/projects?limit=100']);
  });

  it('reuses the token until 60 s before expires_in, across commands on one connection', async () => {
    const routes = [token({ ...tokenResponse, expires_in: 1800 }), api(cxScan(1))];
    const t = testContext({ config: fixtureConfig, routes });
    await execute(scanGetCommand, { id: SCAN_ID }, t.context);
    await execute(scanGetCommand, { id: SCAN_ID }, t.context);
    expect(t.http.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET']);
  });

  it('exchanges again on every request when the answer has no expires_in (suspected bug, #89 item 5)', async () => {
    const routes = [token({ access_token: 'test-access-token', token_type: 'Bearer' }), api(cxScan(1))];
    const t = testContext({ config: fixtureConfig, routes });
    await execute(scanGetCommand, { id: SCAN_ID }, t.context);
    await execute(scanGetCommand, { id: SCAN_ID }, t.context);
    expect(t.http.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
  });

  it('a refused exchange is AUTH naming the token endpoint, with where to make a key; a 500 is HTTP', async () => {
    const refused = await run(projectListCommand, {}, [{ method: 'POST', url: TOKEN_URL, respond: { status: 400, json: { error: 'invalid_grant' } } }]);
    expect(refused.calls).toHaveLength(1);
    expect(refused.envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining(TOKEN_URL) });
    expect(refused.envelope.error?.fix).toContain('TOIL_CHECKMARX_API_KEY');
    const down = await run(projectListCommand, {}, [{ method: 'POST', url: TOKEN_URL, respond: { status: 500, text: '' } }]);
    expect(down.envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining(TOKEN_URL) });
  });

  it('an exchange answer without access_token is AUTH, and no API request follows', async () => {
    const { envelope, calls } = await run(projectListCommand, {}, [token({ expires_in: 300 })]);
    expect(calls).toHaveLength(1);
    expect(envelope.error).toMatchObject({ code: 'AUTH', message: expect.stringContaining('without an access token') });
  });
});

describe('project list', () => {
  it('GETs projects with limit=100 and returns the bare projects array', async () => {
    const { envelope, calls } = await run(projectListCommand, {}, [token(), api({ projects: [cxProject(1), cxProject(2)], totalCount: 2, filteredTotalCount: 2 })]);
    expect(calls[1]).toEqual({ method: 'GET', url: `${CX}/projects?limit=100`, headers: API_HEADERS, body: undefined });
    expect(envelope.data).toEqual([cxProject(1), cxProject(2)]);
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('returns [] when Checkmarx One answers projects: null', async () => {
    const { envelope } = await run(projectListCommand, {}, [token(), api({ projects: null, totalCount: 0, filteredTotalCount: 0 })]);
    expect(envelope.data).toEqual([]);
  });

  it('stops at one page and warns in meta.warnings with the stderr wording the contract specifies (suspected bug, #89 item 1)', async () => {
    const { envelope, calls } = await run(projectListCommand, {}, [token(), api({ projects: [cxProject(1)], totalCount: 250, filteredTotalCount: 250 })]);
    expect(calls).toHaveLength(2);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual([cxProject(1)]);
    expect(envelope.meta.warnings).toEqual([{ code: 'CHECKMARX_TRUNCATED', message: '250 projects found; only showing first 1' }]);
  });
});

describe('scan list', () => {
  const scans = (n: number, total = n) => ({ scans: Array.from({ length: n }, (_, i) => cxScan(i + 1)), totalCount: total, filteredTotalCount: total });

  it('sends limit=100 by default, then project-id when given, and returns the bare scans array', async () => {
    const all = await run(scanListCommand, {}, [token(), api(scans(1))]);
    expect(all.calls[1]).toEqual({ method: 'GET', url: `${CX}/scans?limit=100`, headers: API_HEADERS, body: undefined });
    expect(all.envelope.data).toEqual([cxScan(1)]);
    const one = await run(scanListCommand, { project: PROJECT_ID, last: '5' }, [token(), api(scans(1))]);
    expect(one.calls[1]!.url).toBe(`${CX}/scans?limit=5&project-id=${PROJECT_ID}`);
  });

  it('returns [] for scans: null, and warns when the server counts more than it sent', async () => {
    expect((await run(scanListCommand, {}, [token(), api({ scans: null, totalCount: 0, filteredTotalCount: 0 })])).envelope.data).toEqual([]);
    const cut = await run(scanListCommand, { last: 2 }, [token(), api(scans(2, 40))]);
    expect(cut.envelope.meta.warnings).toEqual([{ code: 'CHECKMARX_TRUNCATED', message: '40 scans found; only showing first 2' }]);
  });

  it('reads --last with parseInt: 5abc is 5, 0 and -3 reach the server (suspected bug, #89 item 4)', async () => {
    const urls: string[] = [];
    for (const last of ['5abc', '0', '-3', 0]) {
      urls.push((await run(scanListCommand, { last }, [token(), api(scans(0))])).calls[1]!.url);
    }
    expect(urls).toEqual([`${CX}/scans?limit=5`, `${CX}/scans?limit=0`, `${CX}/scans?limit=-3`, `${CX}/scans?limit=0`]);
  });

  it('refuses a --last with no leading integer before any request; an empty one means the default', async () => {
    const bad = await run(scanListCommand, { last: 'abc' }, []);
    expect(bad.calls).toEqual([]);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Invalid --last "abc". Expected an integer.' });
    const empty = await run(scanListCommand, { last: '' }, [token(), api(scans(0))]);
    expect(empty.calls[1]!.url).toBe(`${CX}/scans?limit=100`);
  });
});

describe('get and stats', () => {
  it('scan get GETs scans/<id>; scan stats GETs results/summary with scan-id (suspected bug, #89 item 2)', async () => {
    const scan = await run(scanGetCommand, { id: SCAN_ID }, [token(), api(cxScan(1))]);
    expect(scan.calls[1]).toEqual({ method: 'GET', url: `${CX}/scans/${SCAN_ID}`, headers: API_HEADERS, body: undefined });
    expect(scan.envelope.data).toEqual(cxScan(1));
    const stats = await run(scanStatsCommand, { id: SCAN_ID }, [token(), api(resultsSummary)]);
    expect(stats.calls[1]!.url).toBe(`${CX}/results/summary?scan-id=${SCAN_ID}`);
    expect(stats.envelope.data).toEqual(resultsSummary);
  });

  it('encodes an id with path or query syntax in it as one path segment (was suspected bug #89 item 7, the id as typed)', async () => {
    const project = await run(projectGetCommand, { id: 'p1#hot' }, [token(), api(cxProject(1))]);
    expect(project.calls[1]!.url).toBe(`${CX}/projects/p1%23hot`);
    const scan = await run(scanGetCommand, { id: 'a/b?c=d' }, [token(), api(cxScan(1))]);
    expect(scan.calls[1]!.url).toBe(`${CX}/scans/a%2Fb%3Fc%3Dd`);
  });

  it("an id with a dot segment in it is refused by core's requests.path bound before any GET, encoded or not", async () => {
    for (const id of ['..', 'x/../y']) {
      const { envelope, calls } = await run(projectGetCommand, { id }, [token(), api(cxScan(1))]);
      expect(calls.filter((c) => c.method === 'GET')).toEqual([]);
      expect(envelope.error?.code).toBe('INVALID_INPUT');
    }
  });

  it("a 404 is NOT_FOUND with Checkmarx One's message", async () => {
    const { envelope } = await run(projectGetCommand, { id: PROJECT_ID }, [token(), api({ code: 404, message: 'project not found' }, 404)]);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('project not found') });
  });

  it('the scan ID is required', async () => {
    const { envelope, calls } = await run(scanStatsCommand, {}, []);
    expect(calls).toEqual([]);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
  });
});
