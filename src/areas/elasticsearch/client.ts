import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { elasticsearchArea } from './area.js';

/**
 * Every request toil sends to Elasticsearch, and the parsing shared by the
 * commands: the index path, the query clause, and Elasticsearch's own error
 * body. Elasticsearch explains a refusal in detail; it is filed under
 * `error.reason`, a drawer core's error parser has not been told about.
 */

export type ElasticsearchConnection = Connection<z.output<typeof elasticsearchArea.connection>>;
export type ElasticsearchContext = CommandContext<ElasticsearchConnection>;

/** The per-request timeout for every call but search, which takes --timeout-ms. */
export const TIMEOUT_MS = 30_000;

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export function es<T>(ctx: ElasticsearchContext, path: string, req: Omit<ApiRequest, 'headers'> = {}): Promise<T> {
  return apiRequest<T>(elasticsearchArea, { ...ctx, fetch: withReason(ctx.fetch) }, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...req });
}

/**
 * The reason from Elasticsearch's error body, documented as
 * `{"error":{"root_cause":[{type,reason}],"type","reason"},"status"}` (or a
 * bare string in `error`):
 * https://www.elastic.co/docs/reference/elasticsearch/rest-apis/common-options
 * The root cause is added when it says more than the top-level reason, as it
 * does for `search_phase_execution_exception: all shards failed`.
 */
export function errorReason(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const error = (parsed as { error?: unknown } | null)?.error;
  if (typeof error === 'string' && error !== '') return error;
  if (typeof error !== 'object' || error === null) return undefined;
  const describe = (e: unknown): string | undefined => {
    const { type, reason } = (e ?? {}) as { type?: unknown; reason?: unknown };
    if (typeof reason !== 'string') return typeof type === 'string' ? type : undefined;
    return typeof type === 'string' ? `${type}: ${reason}` : reason;
  };
  const top = describe(error);
  const rootCause = (error as { root_cause?: unknown }).root_cause;
  const root = Array.isArray(rootCause) ? describe(rootCause[0]) : undefined;
  if (top === undefined) return root;
  return root !== undefined && root !== top ? `${top} (root cause: ${root})` : top;
}

/**
 * Rewrites an Elasticsearch error body as `{"message": reason}` before core
 * reads it, so core's error (its code, fix, status and retries untouched)
 * carries Elasticsearch's reason instead of a bare `HTTP 400`. Successes,
 * redirects, 429s and error bodies of any other shape pass through as they
 * came.
 */
function withReason(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status < 400 || response.status === 429) return response;
    const text = await response.text().catch(() => '');
    const reason = errorReason(text);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(reason !== undefined ? JSON.stringify({ message: reason }) : text, { status: response.status, statusText: response.statusText, headers });
  };
}

/**
 * One or more targets for the path: split on commas, each trimmed and
 * URI-encoded, rejoined with literal commas. `*` survives encoding, and a
 * date-math name (`<logs-{now/d}>`) comes out encoded, as Elastic requires:
 * https://www.elastic.co/docs/reference/elasticsearch/rest-apis/api-conventions
 * An empty target is refused: an empty path segment would collapse into a
 * request against every index.
 */
export function indexPath(index: string, flag: string): string {
  const targets = index.split(',').map((s) => s.trim());
  if (targets.some((t) => t === '')) {
    throw invalid(`${flag} has an empty target: "${index}".`, `Pass one or more index, data stream or alias names, comma-separated with nothing empty between them, e.g. logs-app,logs-web.`);
  }
  return targets.map((t) => encodeURIComponent(t)).join(',');
}

/** The Query DSL clause: --query as a JSON object, or --q as a query_string query, or match_all. */
export function buildQuery(input: { query?: string | undefined; q?: string | undefined }): Record<string, unknown> {
  if (input.query && input.q) throw invalid('Use either --query or --q, not both.', 'Pass a Query DSL clause with --query, or a Lucene query string with --q.');
  if (input.query) return parseJsonObject(input.query, '--query');
  if (input.q) return { query_string: { query: input.q } };
  return { match_all: {} };
}

function parseJsonObject(raw: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid(`${flag} must be valid JSON. Example: ${flag} '{"match_all":{}}'`, `Quote the JSON for your shell, e.g. ${flag} '{"match":{"message":"error"}}'.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid(`${flag} must be a JSON object.`, `Pass one Query DSL clause as an object, e.g. ${flag} '{"term":{"level":"error"}}'.`);
  }
  return parsed as Record<string, unknown>;
}

/** A whole number of at least zero, from a number or its text, as `--limit`, `--offset` and `--timeout-ms` take it. */
export function nonNegativeInt(value: number | string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw invalid(`${flag} must be a non-negative integer.`, `Pass a whole number of 0 or more to ${flag}.`);
  return n;
}

export function invalid(message: string, fix: string): ToilError {
  return new ToilError('INVALID_INPUT', message, { fix });
}
