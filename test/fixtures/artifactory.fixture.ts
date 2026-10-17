import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned artifactory responses for every request the examples send. Say which
 * shapes came from the predecessor's tests and which were invented from the
 * vendor's docs. Routes match on method, path and query.
 */
export const fixture = defineFixture({
  area: 'artifactory',
  routes: [
    // { path: '/api/thing', query: { id: '1' }, respond: { json: { id: '1' } } },
  ],
  config: { artifactory: { baseUrl: 'https://artifactory.imagile.dev', token: 'test-token', writes: true } },
});
