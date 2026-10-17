import type { RecordedRequest } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Split.IO Admin API responses for every request the splitio examples
 * send, so the parity suite runs every command offline through both front
 * doors.
 *
 * Provenance: every shape here is invented from Split's Admin API reference
 * (docs.split.io/reference: Get Projects (Workspaces), Get Environments, List
 * feature flags, Get feature flag, Get feature flag definition in environment,
 * Submit / List / Get Change Request), trimmed to the fields that matter. None
 * was captured from a live account. `production` on an environment comes from
 * the response type the earlier implementation declared; the reference's
 * example shows only id and name.
 */

export const SPLIT = 'https://api.split.io';
export const API = '/internal/api/v2';
export const WS = 'ws-abc12345';
export const ENV = 'env-abc12345';

export const config = { splitio: { baseUrl: SPLIT, adminApiKey: 'test-admin-key', writes: true } };

export const workspace = (n: number) => ({ id: `ws-abc1234${n}`, name: `Project ${n}`, type: 'workspace' });
export const workspacesPage = (objects: unknown[], offset: number, totalCount: number) => ({ objects, offset, limit: 100, totalCount });

export const environments = [
  { id: ENV, name: 'Production', production: true },
  { id: 'env-abc12346', name: 'Staging', production: false },
];

export const flag = (name: string) => ({
  name,
  description: `The ${name} flag`,
  id: `split-${name}`,
  trafficType: { id: 'tt-abc12345', name: 'user' },
  creationTime: 1760000000000,
  tags: [{ name: 'checkout' }],
});

export const flagsPage = { objects: [flag('new_checkout'), flag('old_banner')], offset: 0, limit: 50, totalCount: 2 };

export const definition = {
  name: 'new_checkout',
  environment: { id: ENV, name: 'Production' },
  trafficType: { id: 'tt-abc12345', name: 'user' },
  killed: false,
  treatments: [
    { name: 'on', configurations: null },
    { name: 'off', configurations: null },
  ],
  defaultTreatment: 'off',
  baselineTreatment: 'off',
  trafficAllocation: 100,
  rules: [
    { buckets: [{ treatment: 'on', size: 100 }], condition: { combiner: 'AND', matchers: [{ type: 'IN_SEGMENT', string: 'beta_users' }] } },
    { buckets: [{ treatment: 'off', size: 100 }], condition: { combiner: 'AND', matchers: [{ type: 'ALL_KEYS' }] } },
  ],
  defaultRule: [{ treatment: 'off', size: 100 }],
  creationTime: 1760000000000,
  lastUpdateTime: 1760000500000,
};

/** A change request as Submit Change Request answers, echoing what was sent. */
export function changeRequest(request: RecordedRequest) {
  const sent = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
  return {
    id: 'cr-abc12345',
    status: 'REQUESTED',
    title: sent.title,
    comment: sent.comment,
    split: sent.split,
    segment: null,
    workspace: { id: WS, type: 'workspace' },
    approvers: sent.approvers,
    operationType: sent.operationType,
    comments: [{ comment: sent.comment, user: 'ADMIN_API_KEY', role: 'SUBMITTER', timestamp: 1760000600000 }],
  };
}

export const storedChangeRequest = {
  id: 'cr-abc12345',
  status: 'APPROVED',
  title: 'flag-change',
  comment: null,
  split: { name: 'new_checkout', environment: { id: ENV, name: 'Production' } },
  segment: null,
  workspace: { id: WS, type: 'workspace' },
  approvers: ['you@example.com'],
  operationType: 'KILL',
  comments: [],
};

export const changeRequestList = { data: [storedChangeRequest], nextMarker: 'marker-abc12346', previousMarker: null, limit: 25, count: 1 };

/** Local files the examples read. */
export const files: Record<string, string> = {
  'definition.json': JSON.stringify({ treatments: definition.treatments, defaultTreatment: 'off', rules: [], defaultRule: [{ treatment: 'off', size: 100 }] }),
  'toggles.json': JSON.stringify([
    { flag: 'new_checkout', enabled: false },
    { flag: 'old_banner', enabled: true },
  ]),
};

export const fixture = defineFixture({
  area: 'splitio',
  routes: [
    { method: 'GET', path: `${API}/workspaces`, query: { offset: '0', limit: '100' }, respond: { json: workspacesPage([workspace(1), workspace(2)], 0, 2) } },
    { method: 'GET', path: `${API}/environments/ws/${WS}`, respond: { json: environments } },
    { method: 'GET', path: `${API}/splits/ws/${WS}`, respond: { json: flagsPage } },
    { method: 'GET', path: `${API}/splits/ws/${WS}/new_checkout`, respond: { json: flag('new_checkout') } },
    { method: 'GET', path: `${API}/splits/ws/${WS}/new_checkout/environments/${ENV}`, respond: { json: definition } },
    { method: 'POST', path: `${API}/changeRequests/ws/${WS}/environments/${ENV}`, respond: (request) => ({ json: changeRequest(request) }) },
    { method: 'GET', path: `${API}/changeRequests`, respond: { json: changeRequestList } },
    { method: 'GET', path: `${API}/changeRequests/cr-abc12345`, respond: { json: storedChangeRequest } },
  ],
  config,
  files,
});
