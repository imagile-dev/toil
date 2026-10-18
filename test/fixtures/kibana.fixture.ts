import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Kibana responses for every request the kibana examples send, so the
 * parity suite runs each command offline through both front doors. Routes
 * match on method, path and the whole query.
 *
 * Provenance: the status, find, data-view, rule and export bodies follow the
 * shapes in the contract's recorded examples, checked against Elastic's Kibana API
 * reference (https://www.elastic.co/docs/api/doc/kibana); the spaces list is
 * invented from that reference. None was captured from a live Kibana; the
 * capture is scheduled for the quarter after the one it was scheduled for.
 */

export const KIBANA = 'https://kibana.imagile.dev';

export const config = { kibana: { baseUrl: KIBANA, apiKey: 'test-api-key' } };

// From the contract's recorded examples: GET /api/status, the 8.x shape.
export const status = {
  name: 'kb',
  uuid: 'abc12345-0000-0000-0000-000000000000',
  version: { number: '8.15.0', build_flavor: 'default' },
  status: { overall: { level: 'available', summary: 'All services and plugins are available' } },
};

// Invented from the docs: GET /api/spaces/space.
export const spaces = [
  { id: 'default', name: 'Default', description: 'This is your default space!', disabledFeatures: [], _reserved: true },
  { id: 'ops', name: 'Ops', description: 'Operations dashboards', disabledFeatures: ['dev_tools'] },
];

// From the contract's recorded examples: GET /api/saved_objects/_find?type=dashboard.
export const find = (page: number, perPage: number) => ({
  page,
  per_page: perPage,
  total: 2,
  saved_objects: [
    { id: 'abc12345', type: 'dashboard', updated_at: '2026-10-01T00:00:00Z', attributes: { title: 'Payments', description: 'Card and transfer volumes', panelsJSON: '[]' } },
    { id: 'abc12346', type: 'dashboard', updated_at: '2026-10-02T00:00:00Z', attributes: { title: 'Payments latency', description: 'p95 by endpoint', panelsJSON: '[]' } },
  ],
});

// From the contract's recorded examples: the NDJSON from POST /api/saved_objects/_export, export details last.
export const exportNdjson = [
  '{"id":"dv1","type":"index-pattern","attributes":{"title":"logs-*"}}',
  '{"id":"abc12345","type":"dashboard","attributes":{"title":"Payments"}}',
  '{"excludedObjects":[],"excludedObjectsCount":0,"exportedCount":2,"missingRefCount":0,"missingReferences":[]}',
  '',
].join('\n');

// From the contract's recorded examples: GET /api/data_views.
export const dataViews = { data_view: [{ id: 'dv1', name: 'Logs', title: 'logs-*', namespaces: ['default'] }, { id: 'dv2', title: 'metrics-*', namespaces: ['ops'] }] };

// From the contract's recorded examples: one rule, as GET /api/alerting/rule/{id} and each _find entry return it.
export const rule = {
  id: 'abc12345-0000-0000-0000-000000000000',
  name: 'High error rate',
  rule_type_id: '.es-query',
  consumer: 'alerts',
  enabled: true,
  tags: ['payments'],
  schedule: { interval: '1m' },
  mute_all: false,
  execution_status: { status: 'error', last_execution_date: '2026-10-09T00:00:00Z', error: { reason: 'execute', message: 'boom' } },
  last_run: { outcome: 'failed' },
  next_run: '2026-10-09T00:01:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  params: { size: 100 },
  actions: [],
};

const ndjson = { text: exportNdjson, headers: { 'content-type': 'application/ndjson' } };

export const fixture = defineFixture({
  area: 'kibana',
  routes: [
    { path: '/api/status', query: {}, respond: { json: status } },
    { path: '/api/spaces/space', query: {}, respond: { json: spaces } },
    { path: '/api/saved_objects/_find', query: { type: 'dashboard', page: '1', per_page: '100' }, respond: { json: find(1, 100) } },
    { path: '/s/ops/api/saved_objects/_find', query: { type: 'dashboard', search: 'pay*', search_fields: 'title', page: '2', per_page: '20' }, respond: { json: find(2, 20) } },
    { method: 'POST', path: '/api/saved_objects/_export', query: {}, respond: ndjson },
    { method: 'POST', path: '/s/ops/api/saved_objects/_export', query: {}, respond: ndjson },
    { path: '/api/data_views', query: {}, respond: { json: dataViews } },
    { path: '/s/ops/api/data_views', query: {}, respond: { json: dataViews } },
    { path: '/api/alerting/rules/_find', query: { page: '1', per_page: '100' }, respond: { json: { page: 1, per_page: 100, total: 1, data: [rule] } } },
    { path: '/s/ops/api/alerting/rules/_find', query: { search: 'High*', search_fields: 'name', page: '1', per_page: '20' }, respond: { json: { page: 1, per_page: 20, total: 1, data: [rule] } } },
    { path: `/api/alerting/rule/${rule.id}`, query: {}, respond: { json: rule } },
    { path: `/s/ops/api/alerting/rule/${rule.id}`, query: {}, respond: { json: rule } },
  ],
  config: { kibana: { ...config.kibana, writes: true } },
});
