import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Elasticsearch responses for every request the elasticsearch examples
 * send, so the parity suite runs each command offline through both front
 * doors. Routes match on method, path and the whole query.
 *
 * Provenance: every shape here is invented from Elastic's REST API reference
 * (https://www.elastic.co/docs/api/doc/elasticsearch), trimmed to the fields
 * that matter. None was captured from a live cluster; the request for one is
 * with procurement, in the queue behind the request for a queue.
 */

export const ES = 'https://elasticsearch.imagile.dev';

export const config = { elasticsearch: { baseUrl: ES, apiKey: 'test-api-key' } };

// Invented from the docs: GET /_cluster/health.
export const health = {
  cluster_name: 'imagile-logs',
  status: 'yellow',
  timed_out: false,
  number_of_nodes: 3,
  number_of_data_nodes: 3,
  active_primary_shards: 42,
  active_shards: 80,
  relocating_shards: 0,
  initializing_shards: 0,
  unassigned_shards: 4,
  unassigned_primary_shards: 0,
  delayed_unassigned_shards: 0,
  number_of_pending_tasks: 0,
  number_of_in_flight_fetch: 0,
  task_max_waiting_in_queue_millis: 0,
  active_shards_percent_as_number: 95.2,
};

// Invented from the docs: GET /_cat/indices?format=json&h=..., every value a string.
export const indexRow = (name: string) => ({ index: name, health: 'green', status: 'open', 'docs.count': '1200', 'store.size': '3.4mb', pri: '1', rep: '1' });

// Invented from the docs: one hit of POST /<index>/_search.
export const hit = (n: number) => ({
  _index: 'logs-app',
  _id: `abc1234${n}`,
  _score: 1.5,
  _source: { '@timestamp': '2026-10-01T12:00:0' + n + 'Z', level: 'error', message: `upstream timeout ${n}` },
});

export const searchBody = (total: unknown, hits: unknown[]) => ({
  took: 7,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: { total, max_score: 1.5, hits },
});

const COLUMNS = 'index,health,status,docs.count,store.size,pri,rep';

export const fixture = defineFixture({
  area: 'elasticsearch',
  routes: [
    { path: '/_cluster/health', query: {}, respond: { json: health } },
    { path: '/_cat/indices', query: { format: 'json', h: COLUMNS }, respond: { json: [indexRow('logs-app'), indexRow('logs-web')] } },
    { path: '/_cat/indices/logs-*,metrics-*', query: { format: 'json', h: COLUMNS }, respond: { json: [indexRow('logs-app')] } },
    { method: 'POST', path: '/logs-app/_search', query: {}, respond: { json: searchBody({ value: 2, relation: 'eq' }, [hit(1), hit(2)]) } },
    { method: 'POST', path: '/logs-app,logs-web/_search', query: {}, respond: { json: searchBody({ value: 10000, relation: 'gte' }, [hit(3)]) } },
    { method: 'POST', path: '/logs-*/_search', query: {}, respond: { json: searchBody(5, [hit(4)]) } },
    { method: 'POST', path: '/logs-app/_count', query: {}, respond: { json: { count: 1200, _shards: { total: 1, successful: 1, skipped: 0, failed: 0 } } } },
    { method: 'POST', path: '/logs-*/_count', query: {}, respond: { json: { count: 37, _shards: { total: 2, successful: 2, skipped: 0, failed: 0 } } } },
  ],
  config: { elasticsearch: { ...config.elasticsearch, writes: true } },
});
