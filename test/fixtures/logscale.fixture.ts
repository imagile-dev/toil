import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Falcon LogScale responses for every request the logscale examples
 * send. Routes match on method and path.
 *
 * Provenance: every shape here is invented from LogScale's API docs, since no
 * live response has been captured. The search answer follows the Search
 * Response Format page (application/json is one array of events, field values
 * as strings except a numeric @timestamp); the repositories answer follows the
 * GraphQL reference's example for `repositories()`. Documentation is the
 * evidence of record until a server is willing to testify.
 */

export const LOGSCALE = 'https://logscale.imagile.dev';

export const config = { logscale: { baseUrl: LOGSCALE, token: 'test-token', writes: true } };

// Invented from the docs: two events from POST /api/v1/repositories/<repo>/query.
export const events = [
  { '@timestamp': 1790000000000, '@rawstring': 'level=error msg="payment declined"', level: 'error', msg: 'payment declined', '#repo': 'imagile-app' },
  { '@timestamp': 1790000001000, '@rawstring': 'level=error msg="timeout"', level: 'error', msg: 'timeout', '#repo': 'imagile-app' },
];

// Invented from the docs: the GraphQL repositories() example, trimmed to the fields toil asks for.
export const repositories = [
  { id: 'abc12345', name: 'imagile-app', description: 'Application logs', timeOfLatestIngest: '2026-10-16T12:09:49.909Z' },
  { id: 'def67890', name: 'imagile-audit', description: null, timeOfLatestIngest: null },
];

export const fixture = defineFixture({
  area: 'logscale',
  routes: [
    { method: 'POST', path: '/api/v1/repositories/imagile-app/query', respond: { json: events } },
    { method: 'POST', path: '/api/v1/repositories/imagile%20app%2Fprod/query', respond: { json: events } },
    { method: 'POST', path: '/graphql', respond: { json: { data: { repositories } } } },
  ],
  config,
});
