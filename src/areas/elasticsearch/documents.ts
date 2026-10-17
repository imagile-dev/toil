import { z } from 'zod';
import { elasticsearchArea } from './area.js';
import { buildQuery, es, indexPath, nonNegativeInt } from './client.js';

/**
 * Search and count. Both are reads sent as POST with a Query DSL body, the
 * form Elastic documents for a query too long for a URL. Paging is the
 * caller's: --from and --size go to the server as given, and the server's
 * max_result_window is the only cap, as befits a limit nobody remembers
 * agreeing to.
 */

/** search's own time limit, so --timeout-ms up to 10 minutes is honoured; TOIL_TIMEOUT_MS still overrides it. */
export const SEARCH_TIME_LIMIT_MS = 600_000;

/** A number given as text on the CLI or as a number over MCP. */
const intText = z.union([z.number(), z.string()]);

const index = z.string().describe('Index, data stream, alias or wildcard pattern; comma-separate several');

interface SearchResponse {
  took?: number;
  timed_out?: boolean;
  hits?: { total?: { value: number; relation: string } | number; hits?: unknown[] };
  aggregations?: unknown;
}

/**
 * --sort as Elastic's `<field>:<direction>` pairs, comma-separated, as the
 * search API's own `sort` parameter takes them. Each pair splits on its last
 * colon when what follows is `asc` or `desc`; otherwise the whole entry is the
 * field, sorted ascending. Body form: `[{ field: { order } }]`.
 * https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-search
 * https://www.elastic.co/docs/reference/elasticsearch/rest-apis/sort-search-results
 */
export function parseSort(raw: string): Array<Record<string, { order: string }>> {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const pair = /^(.+):(asc|desc)$/i.exec(entry);
      return pair ? { [pair[1]!]: { order: pair[2]!.toLowerCase() } } : { [entry]: { order: 'asc' } };
    });
}

export const searchCommand = elasticsearchArea.command({
  path: ['elasticsearch', 'search'],
  description: 'Search one or more indices with Query DSL JSON or a query string',
  toolDescription:
    'Search Elasticsearch indices with a Query DSL clause (query) or a Lucene query string (q), one or the other; neither matches everything. Returns the hits as Elasticsearch sent them, with total and totalRelation ("gte" means at least). Use count when only the number is needed.',
  input: z.object({
    index,
    query: z.string().optional().describe('Query DSL clause as JSON (e.g. \'{"match":{"message":"error"}}\')'),
    q: z.string().optional().describe('Lucene query string (e.g. "level:error AND service:api")'),
    sort: z.string().optional().describe('Sort as field:order pairs, comma-separated, e.g. "@timestamp:desc,_score:desc"'),
    source: z.string().optional().describe('Comma-separated fields to return (_source filtering)'),
    size: intText.optional().describe('Maximum number of hits to return (default: "100")'),
    from: intText.optional().describe('Offset of the first hit (default: "0")'),
    timeoutMs: intText.optional().describe('Client-side HTTP timeout in milliseconds (default: "30000")'),
  }),
  writes: false,
  // POST /<index>/_search: a read whose query rides in the body.
  queryByPost: true,
  // Room for a --timeout-ms above the 120 s default, which would otherwise cut it short.
  timeLimitMs: SEARCH_TIME_LIMIT_MS,
  options: [
    { flags: '--index <name>', field: 'index', description: 'Index, data stream, alias or wildcard pattern; comma-separate several' },
    { flags: '--query <json>', field: 'query', description: 'Query DSL clause as JSON (e.g. \'{"match":{"message":"error"}}\')' },
    { flags: '--q <query-string>', field: 'q', description: 'Lucene query string (e.g. "level:error AND service:api")' },
    { flags: '--sort <field:order>', field: 'sort', description: 'Sort as field:order pairs, comma-separated, e.g. "@timestamp:desc,_score:desc"' },
    { flags: '--source <fields>', field: 'source', description: 'Comma-separated fields to return (_source filtering)' },
    { flags: '--size <n>', field: 'size', description: 'Maximum number of hits to return (default: "100")' },
    { flags: '--from <n>', field: 'from', description: 'Offset of the first hit (default: "0")' },
    { flags: '--timeout-ms <ms>', field: 'timeoutMs', description: 'Client-side HTTP timeout in milliseconds (default: "30000")' },
  ],
  examples: [
    { index: 'logs-app' },
    { index: 'logs-app, logs-web', query: '{"match":{"message":"timeout"}}', sort: '@timestamp:desc,_score', source: 'message, @timestamp,', size: '20', from: '40', timeoutMs: '5000' },
    { index: 'logs-*', q: 'level:error AND service:api' },
  ],
  run: async (input, ctx) => {
    const body: Record<string, unknown> = {
      query: buildQuery(input),
      size: nonNegativeInt(input.size ?? '100', '--size'),
      from: nonNegativeInt(input.from ?? '0', '--from'),
    };
    if (input.sort) {
      const sort = parseSort(input.sort);
      if (sort.length > 0) body.sort = sort;
    }
    if (input.source) body._source = input.source.split(',').map((s) => s.trim()).filter(Boolean);
    // #84 item 2, kept: 0 passes, and core gives up on the request at once with TIMEOUT.
    const timeoutMs = nonNegativeInt(input.timeoutMs ?? '30000', '--timeout-ms');

    const data = await es<SearchResponse>(ctx, `/${indexPath(input.index)}/_search`, { method: 'POST', json: body, timeoutMs });
    // hits.total is { value, relation } from 7.0, or a bare number with rest_total_hits_as_int, and absent with track_total_hits: false.
    const total = data.hits?.total;
    const hits = data.hits?.hits ?? [];
    return {
      index: input.index,
      took: data.took,
      timedOut: data.timed_out ?? false,
      total: typeof total === 'object' ? total?.value : total,
      totalRelation: typeof total === 'object' ? total?.relation : undefined,
      hitCount: hits.length,
      hits,
      aggregations: data.aggregations,
    };
  },
});

export const countCommand = elasticsearchArea.command({
  path: ['elasticsearch', 'count'],
  description: 'Count documents matching a query',
  toolDescription: 'Count Elasticsearch documents matching a Query DSL clause (query) or a Lucene query string (q); neither counts everything. Returns only the number; use search for the documents.',
  input: z.object({
    index,
    query: z.string().optional().describe('Query DSL clause as JSON'),
    q: z.string().optional().describe('Lucene query string'),
  }),
  writes: false,
  // POST /<index>/_count, for the same reason as search.
  queryByPost: true,
  options: [
    { flags: '--index <name>', field: 'index', description: 'Index, data stream, alias or wildcard pattern; comma-separate several' },
    { flags: '--query <json>', field: 'query', description: 'Query DSL clause as JSON' },
    { flags: '--q <query-string>', field: 'q', description: 'Lucene query string' },
  ],
  examples: [{ index: 'logs-app' }, { index: 'logs-*', q: 'level:error' }, { index: 'logs-app', query: '{"term":{"level":"error"}}' }],
  // https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-count
  run: async (input, ctx) => {
    const data = await es<{ count: number }>(ctx, `/${indexPath(input.index)}/_count`, { method: 'POST', json: { query: buildQuery(input) } });
    return { index: input.index, count: data.count };
  },
});

export const documentCommands = [searchCommand, countCommand];
