import { describe, expect, it } from 'vitest';
import { commands, areas } from '../src/registry.js';
import { clearTokenCache } from '../src/core/token.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { loadFixtures } from './harness/fixtures.js';

/**
 * Every area's live check (`defineArea({ probe })`), sent by `toil connections
 * test` against the area's own fixture connection: one GET, to the
 * connection's own host, after any token exchange core makes. The probe's
 * answer here is canned; whether the path is right on a live server is what
 * the first live run of each area checks.
 */
const fixtures = await loadFixtures();
const probed = areas.filter((a) => a.probe && a.request);

describe('connections test, per area', () => {
  it('covers the areas toil can check live', () => {
    expect(probed.map((a) => a.name)).toEqual(expect.arrayContaining(['jira', 'github', 'confluence', 'jenkins', 'sonar']));
  });

  for (const area of probed) {
    it(`${area.name}: one GET to the connection's own host, and a live result`, async () => {
      const fixture = fixtures.find((f) => f.area === area.name);
      expect(fixture, `test/fixtures/${area.name}.fixture.ts`).toBeDefined();
      clearTokenCache();
      // The fixture's routes answer any token exchange; anything else gets a plain 200.
      const { context, http } = testContext({ config: fixture!.config, routes: [...fixture!.routes.filter((r) => r.method === 'POST'), { method: 'GET', url: /.*/, respond: { text: 'OK' } }] });
      const run = await runCli(['connections', 'test', area.name], { commands, context });
      expect(run.envelope?.ok, run.stdout).toBe(true);
      expect(run.envelope?.data).toMatchObject({ area: area.name, live: true });
      const gets = http.calls.filter((c) => c.method === 'GET');
      expect(gets, 'exactly one GET').toHaveLength(1);
      const baseUrl = String(fixture!.config[area.name]?.baseUrl ?? '');
      if (baseUrl) expect(new URL(gets[0]!.url).host).toBe(new URL(baseUrl).host);
    });
  }
});
