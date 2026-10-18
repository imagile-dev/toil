import { defineFixture } from '../harness/fixtures.js';

/**
 * The `connections` commands run against one Jira connection, so `connections
 * test` has something to check: its probe, Jira's current user, answers as a
 * signed-in user would. `connections list` reads the same config.
 *
 * Provenance: the answer is shaped like Jira Data Center's /rest/api/2/myself,
 * trimmed to the fields anyone reads, which is also how most status reports
 * get written.
 */
export const fixture = defineFixture({
  area: 'connections',
  routes: [{ method: 'GET', url: 'https://jira.imagile.dev/rest/api/2/myself', respond: { json: { name: 'you', displayName: 'You' } } }],
  config: { jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'fake-token-abc12345' } },
});
