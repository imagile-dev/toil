import { describe, expect, it } from 'vitest';
import { commands, areas } from '../src/registry.js';
import { clearTokenCache } from '../src/core/token.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { loadFixtures } from './harness/fixtures.js';

/**
 * Every area's live check (`defineArea({ probe })`), sent by `toil connections
 * test` against the area's own fixture connection. Each one must be a read
 * the service refuses without a valid credential (the current user, as a
 * rule), never a ping that answers anyone, so the table below names the exact
 * request, and a new probe has to be added to it on purpose. Whether a path is
 * right on a live server is what each area's first live run checks.
 */
const fixtures = await loadFixtures();

type Expected = {
  /** The path after the connection's base URL; `{key}` is the fixture connection's setting. */
  path: string;
  query?: Record<string, string>;
  /** A 200 body the service sends when the credential was accepted, and one it sends to an anonymous caller. */
  accepted?: unknown;
  anonymous?: unknown;
};

const EXPECTED: Record<string, Expected> = {
  ado: { path: '/_apis/projectCollections', query: { 'api-version': '7.1' } },
  alation: { path: '/integration/v1/datasource/', query: { limit: '1' } },
  artifactory: { path: '/api/repositories' },
  bitbucket: { path: '/rest/api/1.0/profile/recent/repos', query: { limit: '1' } },
  checkmarx: { path: '/projects', query: { limit: '1' } },
  confluence: { path: '/rest/api/user/current', accepted: { type: 'known', username: 'you' }, anonymous: { type: 'anonymous' } },
  'confluence-cloud': { path: '/wiki/rest/api/user/current', accepted: { type: 'known', accountId: 'abc12345' }, anonymous: { type: 'anonymous' } },
  contrast: { path: '/Contrast/api/ng/{orgUuid}/applications', query: { limit: '1' } },
  dynatrace: { path: '/api/v2/entities', query: { entitySelector: 'type("SERVICE")', pageSize: '1' } },
  elasticsearch: {
    path: '/_security/_authenticate',
    accepted: { username: 'toil', authentication_realm: { name: '_es_api_key' } },
    anonymous: { username: '_anonymous', authentication_realm: { name: '__anonymous' } },
  },
  figma: { path: '/v1/me' },
  github: { path: '/user' },
  jenkins: { path: '/me/api/json', query: { tree: 'id' }, accepted: { id: 'you' }, anonymous: { id: 'anonymous' } },
  jira: { path: '/rest/api/2/myself' },
  'jira-cloud': { path: '/rest/api/3/myself' },
  kibana: { path: '/api/spaces/space' },
  logscale: { path: '/api/v1/repositories' },
  openshift: { path: '/api/v1' },
  saucelabs: { path: '/rest/v1.2/users/{username}/concurrency' },
  sde: { path: '/api/v2/users/me/' },
  sonar: { path: '/api/authentication/validate', accepted: { valid: true }, anonymous: { valid: false } },
  sonatypeiq: { path: '/api/v2/applications' },
  splitio: { path: '/internal/api/v2/workspaces' },
};

const probed = areas.filter((a) => a.probe && a.request);

async function probe(area: string, body: unknown) {
  const fixture = fixtures.find((f) => f.area === area);
  expect(fixture, `test/fixtures/${area}.fixture.ts`).toBeDefined();
  clearTokenCache();
  // The fixture's routes answer any token exchange (a POST); the probe itself is answered here.
  const routes = [...fixture!.routes.filter((r) => r.method === 'POST'), { method: 'GET', url: /.*/, respond: typeof body === 'string' ? { text: body } : { json: body } }];
  const { context, http } = testContext({ config: fixture!.config, routes });
  const run = await runCli(['connections', 'test', area], { commands, context });
  return { run, gets: http.calls.filter((c) => c.method === 'GET'), settings: fixture!.config[area] ?? {} };
}

describe('connections test, per area', () => {
  it('has an expected request for every area with a probe, and no other', () => {
    expect(probed.map((a) => a.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const area of probed) {
    const expected = EXPECTED[area.name]!;
    it(`${area.name}: one GET to ${expected.path} on the connection's own host, credential required`, async () => {
      const { run, gets, settings } = await probe(area.name, expected.accepted ?? []);
      expect(run.envelope?.ok, run.stdout).toBe(true);
      expect(run.envelope?.data).toMatchObject({ area: area.name, live: true, authenticated: true });
      expect(gets, 'exactly one GET').toHaveLength(1);
      const url = new URL(gets[0]!.url);
      // SD Elements carries its host in a `token@host` connection string.
      const base = new URL(settings.baseUrl ? String(settings.baseUrl) : `https://${String(settings.connectionString).split('@').pop()}`);
      expect(url.origin).toBe(base.origin);
      const path = expected.path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(settings[key])));
      expect(url.pathname).toBe(`${base.pathname.replace(/\/$/, '')}${path}`);
      expect(Object.fromEntries(url.searchParams)).toEqual(expected.query ?? {});
    });

    it(`${area.name}: a sign-in page served with a 200 fails as HTTP, not healthy`, async () => {
      const { run } = await probe(area.name, '<!DOCTYPE html><html><head><title>Sign in</title></head><body><form action="/login"></form></body></html>');
      expect(run.envelope?.ok).toBe(false);
      expect(run.envelope?.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining("isn't JSON") });
    });

    if (expected.anonymous !== undefined) {
      it(`${area.name}: an anonymous answer fails as AUTH`, async () => {
        const { run } = await probe(area.name, expected.anonymous);
        expect(run.envelope?.error?.code).toBe('AUTH');
        expect(run.envelope?.error?.message).toContain('anonymous');
      });
    }
  }
});
