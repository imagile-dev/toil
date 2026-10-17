import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import { testContext } from '../../../test/harness/context.js';
import { neverAnswers, type Route } from '../../../test/harness/fake-fetch.js';
import { config as fixtureConfig, ES, health, hit, indexRow, searchBody } from '../../../test/fixtures/elasticsearch.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { elasticsearchArea } from './area.js';
import { errorReason, indexPath } from './client.js';
import { clusterHealthCommand } from './cluster.js';
import { countCommand, parseSort, SEARCH_TIME_LIMIT_MS, searchCommand } from './documents.js';
import { indicesListCommand } from './indices.js';

/**
 * Request building and response reshaping, command by command, against
 * Elastic's documented REST API: the exact request toil sends and what it
 * makes of the answer. The #84 items are settled here from the docs, each
 * test naming which way it went, so the minutes of the meeting are also the
 * test plan.
 */

const HEADERS = { authorization: 'ApiKey test-api-key', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const COLUMNS = 'index,health,status,docs.count,store.size,pri,rep';

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], config: Record<string, Record<string, unknown>> = fixtureConfig) {
  const t = testContext({ config, routes });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const any = (body: unknown, method = 'GET'): Route => ({ method, url: /.*/, respond: { json: body } });
const failing = (status: number, json: unknown, method = 'POST'): Route => ({ method, url: /.*/, respond: { status, json } });
const sent = (calls: Array<{ body: string | undefined }>) => JSON.parse(calls[0]!.body!) as Record<string, unknown>;

describe('cluster health', () => {
  it('GETs /_cluster/health with the ApiKey header and returns the body as it came', async () => {
    const { envelope, calls } = await run(clusterHealthCommand, {}, [any(health)]);
    expect(calls).toEqual([{ method: 'GET', url: `${ES}/_cluster/health`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual(health);
  });

  it('keeps a base URL context path', async () => {
    const { calls } = await run(clusterHealthCommand, {}, [any(health)], { elasticsearch: { ...fixtureConfig.elasticsearch, baseUrl: `${ES}/es` } });
    expect(calls[0]!.url).toBe(`${ES}/es/_cluster/health`);
  });

  it('a 401 is AUTH with Elasticsearch\'s reason and where to make a key', async () => {
    const body = { error: { root_cause: [{ type: 'security_exception', reason: 'unable to authenticate with provided credentials and anonymous access is not allowed for this request' }], type: 'security_exception', reason: 'unable to authenticate with provided credentials and anonymous access is not allowed for this request' }, status: 401 };
    const { envelope } = await run(clusterHealthCommand, {}, [failing(401, body, 'GET')]);
    expect(envelope.error).toMatchObject({
      code: 'AUTH',
      message: 'security_exception: unable to authenticate with provided credentials and anonymous access is not allowed for this request',
      fix: expect.stringContaining('Stack Management → API keys'),
    });
    expect(envelope.error?.fix).toContain('TOIL_ELASTICSEARCH_API_KEY');
  });
});

describe('indices list', () => {
  it('GETs _cat/indices as JSON with the named columns, commas literal, and counts the rows', async () => {
    const rows = [indexRow('logs-app'), indexRow('logs-web')];
    const { envelope, calls } = await run(indicesListCommand, {}, [any(rows)]);
    expect(calls).toEqual([{ method: 'GET', url: `${ES}/_cat/indices?format=json&h=${COLUMNS}`, headers: HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ count: 2, indices: rows });
  });

  it('puts --pattern in the path, each comma-separated target trimmed and encoded, wildcards kept', async () => {
    const { calls } = await run(indicesListCommand, { pattern: 'logs-*, <metrics-{now/d}>' }, [any([])]);
    expect(calls[0]!.url).toBe(`${ES}/_cat/indices/logs-*,%3Cmetrics-%7Bnow%2Fd%7D%3E?format=json&h=${COLUMNS}`);
  });

  it('an answer that is not a list is an HTTP error, not an empty result', async () => {
    const { envelope } = await run(indicesListCommand, {}, [any({ ok: true })]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', fix: expect.stringContaining('baseUrl') });
  });
});

describe('search', () => {
  it('POSTs match_all with size 100 and from 0 by default, and reshapes the 7.0+ hits.total', async () => {
    const answer = searchBody({ value: 2, relation: 'eq' }, [hit(1), hit(2)]);
    const { envelope, calls } = await run(searchCommand, { index: 'logs-app' }, [any(answer, 'POST')]);
    expect(calls).toEqual([{ method: 'POST', url: `${ES}/logs-app/_search`, headers: HEADERS, body: JSON.stringify({ query: { match_all: {} }, size: 100, from: 0 }) }]);
    expect(envelope.data).toEqual({ index: 'logs-app', took: 7, timedOut: false, total: 2, totalRelation: 'eq', hitCount: 2, hits: [hit(1), hit(2)] });
  });

  it('sends --query, --size, --from and --source as given, and --sort as one entry per pair', async () => {
    const { calls } = await run(
      searchCommand,
      { index: 'logs-app, logs-web', query: '{"match":{"message":"timeout"}}', sort: '@timestamp:desc,_score', source: 'message, @timestamp,', size: '20', from: 40 },
      [any(searchBody({ value: 10000, relation: 'gte' }, []), 'POST')],
    );
    expect(calls[0]!.url).toBe(`${ES}/logs-app,logs-web/_search`);
    expect(sent(calls)).toEqual({
      query: { match: { message: 'timeout' } },
      size: 20,
      from: 40,
      sort: [{ '@timestamp': { order: 'desc' } }, { _score: { order: 'asc' } }],
      _source: ['message', '@timestamp'],
    });
  });

  it('--q becomes a query_string query, and a bare-number hits.total has no totalRelation', async () => {
    const { envelope, calls } = await run(searchCommand, { index: 'logs-*', q: 'level:error AND service:api' }, [any(searchBody(5, [hit(4)]), 'POST')]);
    expect(sent(calls).query).toEqual({ query_string: { query: 'level:error AND service:api' } });
    expect(envelope.data).toMatchObject({ total: 5, hitCount: 1 });
    expect(JSON.parse(JSON.stringify(envelope.data))).not.toHaveProperty('totalRelation');
  });

  it('with no hits object (track_total_hits false and no hits), total is absent and hitCount is 0', async () => {
    const { envelope } = await run(searchCommand, { index: 'logs-app' }, [any({ took: 1 }, 'POST')]);
    expect(envelope.data).toEqual({ index: 'logs-app', took: 1, timedOut: false, hitCount: 0, hits: [] });
  });

  it('refuses --query with --q, a non-object --query, invalid JSON and a negative size, before any request', async () => {
    for (const [input, message] of [
      [{ query: '{}', q: 'x' }, 'Use either --query or --q, not both.'],
      [{ query: '[1]' }, '--query must be a JSON object.'],
      [{ query: 'null' }, '--query must be a JSON object.'],
      [{ query: '{nope' }, `--query must be valid JSON. Example: --query '{"match_all":{}}'`],
      [{ size: '-1' }, '--size must be a non-negative integer.'],
      [{ from: '1.5' }, '--from must be a non-negative integer.'],
      [{ timeoutMs: 'soon' }, '--timeout-ms must be a non-negative integer.'],
    ] as const) {
      const { envelope, calls } = await run(searchCommand, { index: 'logs-app', ...input }, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message });
    }
  });

  it('--index is required, and an empty one is refused rather than searching every index', async () => {
    for (const input of [{}, { index: '' }]) {
      const { envelope, calls } = await run(searchCommand, input, []);
      expect(calls).toEqual([]);
      expect(envelope.error?.code).toBe('INVALID_INPUT');
    }
  });

  it('an empty target in --index or --pattern is refused before any request', async () => {
    for (const [def, input, flag] of [
      [searchCommand, { index: 'a,,b' }, '--index'],
      [searchCommand, { index: ' ' }, '--index'],
      [countCommand, { index: ',' }, '--index'],
      [indicesListCommand, { pattern: ' ' }, '--pattern'],
    ] as const) {
      const { envelope, calls } = await run(def, input, []);
      expect(calls).toEqual([]);
      expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(`${flag} has an empty target`) });
    }
  });

  it('#84 item 1, fixed from the docs: the error carries Elasticsearch\'s type and reason, with the root cause when it says more', async () => {
    const missing = { error: { root_cause: [{ type: 'index_not_found_exception', reason: 'no such index [nope]' }], type: 'index_not_found_exception', reason: 'no such index [nope]', index: 'nope' }, status: 404 };
    const notFound = await run(searchCommand, { index: 'nope' }, [failing(404, missing)]);
    expect(notFound.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'index_not_found_exception: no such index [nope]' });

    const parse = { error: { root_cause: [{ type: 'query_shard_exception', reason: 'Failed to parse query [level:(]' }], type: 'search_phase_execution_exception', reason: 'all shards failed', phase: 'query' }, status: 400 };
    const bad = await run(searchCommand, { index: 'logs-app', q: 'level:(' }, [failing(400, parse)]);
    expect(bad.envelope.error).toMatchObject({
      code: 'HTTP',
      message: 'search_phase_execution_exception: all shards failed (root cause: query_shard_exception: Failed to parse query [level:(])',
      details: { status: 400 },
    });
  });

  it('an error body of another shape keeps core\'s reading of it', async () => {
    const proxy = await run(searchCommand, { index: 'logs-app' }, [failing(502, { message: 'upstream unavailable' })]);
    expect(proxy.envelope.error).toMatchObject({ code: 'HTTP', message: 'upstream unavailable' });
    const blank = await run(searchCommand, { index: 'logs-app' }, [{ method: 'POST', url: /.*/, respond: { status: 503, text: '' } }]);
    expect(blank.envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringMatching(/^HTTP 503/) });
  });

  it('has a 10-minute time limit, so a --timeout-ms above the 120 s default is honoured; count keeps the default', () => {
    expect(SEARCH_TIME_LIMIT_MS).toBe(600_000);
    expect(searchCommand.timeLimitMs).toBe(SEARCH_TIME_LIMIT_MS);
    expect(countCommand.timeLimitMs).toBeUndefined();
  });

  it('#84 item 2, kept (the docs say nothing about a client timeout): --timeout-ms 0 is accepted, and the request is given up at once', async () => {
    const t = testContext({ config: fixtureConfig });
    t.context.fetch = neverAnswers;
    const envelope = await execute(searchCommand, { index: 'logs-app', timeoutMs: '0' }, t.context);
    expect(envelope.error).toMatchObject({ code: 'TIMEOUT', details: { timeoutMs: 0 } });
  });
});

describe('#84 item 3, fixed from the docs: --sort takes comma-separated field:order pairs', () => {
  it('splits pairs on commas and each on its last colon, lowercasing the order', () => {
    expect(parseSort('@timestamp:desc,_score:desc')).toEqual([{ '@timestamp': { order: 'desc' } }, { _score: { order: 'desc' } }]);
    expect(parseSort('labels:env:DESC')).toEqual([{ 'labels:env': { order: 'desc' } }]);
  });

  it('an entry with no asc or desc after its last colon is all field, ascending', () => {
    expect(parseSort('labels:env')).toEqual([{ 'labels:env': { order: 'asc' } }]);
    expect(parseSort('level')).toEqual([{ level: { order: 'asc' } }]);
    expect(parseSort(' , ')).toEqual([]);
  });

  it('an empty --sort sends no sort at all', async () => {
    const { calls } = await run(searchCommand, { index: 'logs-app', sort: ' , ' }, [any(searchBody(0, []), 'POST')]);
    expect(sent(calls)).not.toHaveProperty('sort');
  });
});

describe('count', () => {
  it('POSTs the query to /<index>/_count and returns { index, count }', async () => {
    const { envelope, calls } = await run(countCommand, { index: 'logs-*', q: 'level:error' }, [any({ count: 37, _shards: {} }, 'POST')]);
    expect(calls).toEqual([{ method: 'POST', url: `${ES}/logs-*/_count`, headers: HEADERS, body: JSON.stringify({ query: { query_string: { query: 'level:error' } } }) }]);
    expect(envelope.data).toEqual({ index: 'logs-*', count: 37 });
  });

  it('counts everything with match_all when given no query', async () => {
    const { calls } = await run(countCommand, { index: 'logs-app' }, [any({ count: 1 }, 'POST')]);
    expect(sent(calls)).toEqual({ query: { match_all: {} } });
  });
});

describe('helpers', () => {
  it('indexPath keeps commas literal and wildcards as they are', () => {
    expect(indexPath('a, b ,c*', '--index')).toBe('a,b,c*');
  });

  it('errorReason reads the documented shapes and nothing else', () => {
    expect(errorReason(JSON.stringify({ error: 'Incorrect HTTP method for uri [/x], allowed: [GET]', status: 405 }))).toBe('Incorrect HTTP method for uri [/x], allowed: [GET]');
    expect(errorReason(JSON.stringify({ error: { type: 'illegal_argument_exception' } }))).toBe('illegal_argument_exception');
    expect(errorReason(JSON.stringify({ message: 'other' }))).toBeUndefined();
    expect(errorReason('<html>')).toBeUndefined();
    expect(errorReason('null')).toBeUndefined();
  });
});

describe('sharing apiKey with Kibana', () => {
  it('apiKey is a secret connection key, so an area that pairs with Elasticsearch can borrow it through apiKeyFrom', () => {
    expect(elasticsearchArea.secrets).toEqual(['apiKey']);
    const borrower = defineArea({
      name: 'borrower',
      description: 'test-only area that pairs with Elasticsearch, as Kibana does',
      connection: z.object({ baseUrl: z.url(), apiKey: z.string().min(1).optional() }),
      secrets: ['apiKey'],
      shares: { area: elasticsearchArea, keys: ['apiKey'] },
    });
    expect(Object.keys(borrower.connection.shape)).toContain('apiKeyFrom');
  });
});
