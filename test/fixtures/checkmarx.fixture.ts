import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Checkmarx One responses for every request the checkmarx examples
 * send, the token exchange included, so the parity suite runs each command
 * offline through both front doors.
 *
 * Provenance: the command contract's recorded examples pin only the null-list
 * case (`projects: null`, `scans: null`). Every other shape is invented from
 * Checkmarx One's REST API documentation and Keycloak's token endpoint,
 * trimmed to the fields the command contract's types record.
 * Every scan here completed on time, which is how you can tell it's a fixture.
 */

export const CX = 'https://eu.ast.checkmarx.net/api';
export const IAM = 'https://eu.iam.checkmarx.net';
export const TOKEN_PATH = '/auth/realms/imagile/protocol/openid-connect/token';
export const PROJECT_ID = 'abc12345-0000-0000-0000-000000000000';
export const SCAN_ID = 'abc12345-0000-0000-0000-0000000000a1';

export const config = { checkmarx: { baseUrl: CX, tenantName: 'imagile', apiKey: 'test-api-key' } };

// Invented from Keycloak's token endpoint.
export const tokenResponse = { access_token: 'test-access-token', expires_in: 1800, token_type: 'Bearer' };

// Invented from the docs: one entry of GET /api/projects's `projects`.
export const cxProject = (n: number) => ({
  id: n === 1 ? PROJECT_ID : `abc12345-0000-0000-0000-${String(n).padStart(12, '0')}`,
  name: `imagile-api-${n}`,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-03T09:00:00Z',
  groups: [],
  tags: { team: 'platform' },
  repoUrl: 'https://bitbucket.imagile.dev/scm/imagile/api.git',
  mainBranch: 'main',
});

// Invented from the docs: one entry of GET /api/scans's `scans`.
export const cxScan = (n: number) => ({
  id: n === 1 ? SCAN_ID : `abc12345-0000-0000-0000-${String(n).padStart(12, '0')}`,
  status: 'Completed',
  projectId: PROJECT_ID,
  projectName: 'imagile-api-1',
  branch: 'main',
  createdAt: '2026-09-03T09:00:00Z',
  updatedAt: '2026-09-03T09:20:00Z',
  initiator: 'you@example.com',
  tags: {},
  engines: { sast: { status: 'Completed' } },
});

// Invented from the docs: GET /api/results/summary, in the flat shape the command contract specifies (#89 item 2).
export const resultsSummary = { highSeverity: 2, mediumSeverity: 5, lowSeverity: 11, infoSeverity: 3, severitiesTotalCount: 21 };

export const tokenRoute: Route = { method: 'POST', origin: IAM, path: TOKEN_PATH, respond: { json: tokenResponse } };

export const fixture = defineFixture({
  area: 'checkmarx',
  routes: [
    tokenRoute,
    { method: 'GET', path: '/api/projects', query: { limit: '100' }, respond: { json: { projects: [cxProject(1), cxProject(2)], totalCount: 2, filteredTotalCount: 2 } } },
    { method: 'GET', path: `/api/projects/${PROJECT_ID}`, respond: { json: cxProject(1) } },
    { method: 'GET', path: '/api/scans', query: { limit: '100' }, respond: { json: { scans: [cxScan(1)], totalCount: 1, filteredTotalCount: 1 } } },
    { method: 'GET', path: '/api/scans', query: { limit: '5', 'project-id': PROJECT_ID }, respond: { json: { scans: [cxScan(1)], totalCount: 1, filteredTotalCount: 1 } } },
    { method: 'GET', path: `/api/scans/${SCAN_ID}`, respond: { json: cxScan(1) } },
    { method: 'GET', path: '/api/results/summary', query: { 'scan-id': SCAN_ID }, respond: { json: resultsSummary } },
  ],
  config,
});
