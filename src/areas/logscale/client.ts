import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiGraphql, apiRequest } from '../../core/api.js';
import { logscaleArea } from './area.js';

/**
 * Every request toil sends to LogScale, each one as LogScale's own API docs
 * describe it: the synchronous search under `/api/v1` and the repositories
 * query on `/graphql`. Two APIs for one product is not redundancy; it is
 * separation of duties.
 */

export type LogscaleConnection = Connection<z.output<typeof logscaleArea.connection>>;
export type LogscaleContext = CommandContext<LogscaleConnection>;

/** Sent on every call besides the hook's token. */
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };
/** The per-request timeout when a command doesn't set its own. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** The documented QueryInput fields toil sends (https://library.humio.com/logscale-api/api-search-request.html). */
export interface QueryInput {
  queryString: string;
  start: string | number;
  end: string | number;
  isLive: false;
}

/**
 * POST /api/v1/repositories/<repo>/query with `Accept: application/json`,
 * which answers with one JSON array of events
 * (https://library.humio.com/logscale-api/api-search-responseformat.html).
 */
export function searchRepository(ctx: LogscaleContext, repository: string, body: QueryInput, timeoutMs: number): Promise<unknown> {
  return apiRequest<unknown>(logscaleArea, ctx, `/api/v1/repositories/${encodeURIComponent(repository)}/query`, {
    method: 'POST',
    headers: HEADERS,
    json: body,
    timeoutMs,
  });
}

/** The Repository fields toil asks for, all marked Long-Term stable in the GraphQL reference. */
export const REPOSITORIES_QUERY = 'query { repositories { id name description timeOfLatestIngest } }';

/**
 * The GraphQL `repositories` query on `/graphql`
 * (https://library.humio.com/logscale-graphql-reference-queries/graphql-query-field-repositories.html).
 */
export async function listRepositories(ctx: LogscaleContext): Promise<unknown[]> {
  const data = await apiGraphql<{ repositories?: unknown }>(logscaleArea, ctx, '/graphql', { query: REPOSITORIES_QUERY }, { headers: HEADERS, timeoutMs: DEFAULT_TIMEOUT_MS });
  return Array.isArray(data.repositories) ? data.repositories : [];
}
