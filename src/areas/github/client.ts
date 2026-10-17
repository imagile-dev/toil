import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiGraphql, apiRequest, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { parseGitHubRemote } from '../../core/git-remote.js';
import { paginate } from '../../core/paginate.js';
import type { QueryValue } from '../../core/rest.js';
import { githubArea } from './area.js';

/**
 * Every request toil sends to GitHub, kept as the canonical implementation
 * sent them: the same headers on every call (the pinned API version, JSON
 * content type, `Connection: close`), owner, repo and labels interpolated
 * into paths as given, page/per_page paging that stops on a short page, and
 * GraphQL at the endpoint derived from the REST root. One header set for
 * every request, in the way a uniform is issued: whether or not it fits.
 */

export type GitHubConnection = Connection<z.output<typeof githubArea.connection>>;
export type GitHubContext = CommandContext<GitHubConnection, Partial<Record<'owner' | 'repo', string>>>;

/** The predecessor's per-request timeout. */
const TIMEOUT_MS = 30_000;
/** GitHub's page-size maximum; a short page is the last one. */
const PER_PAGE = 100;

/** What every call sends besides the token, exactly as the predecessor sent it. */
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Connection: 'close' };

type Request = Pick<ApiRequest, 'method' | 'query' | 'json'>;

export function github<T>(ctx: GitHubContext, path: string, req: Request = {}): Promise<T> {
  return apiRequest<T>(githubArea, ctx, path, { ...req, headers: HEADERS, timeoutMs: TIMEOUT_MS });
}

/**
 * A text body (the unified diff), with Accept swapped for the diff media
 * type. Failures go through core like every other call, which reads the
 * body's `message` and, unlike the predecessor's text call, retries a 429
 * (#72 item 11; listed in docs/divergences/github.json).
 */
export function githubText(ctx: GitHubContext, path: string): Promise<string> {
  return apiRequest<string>(githubArea, ctx, path, { headers: { ...HEADERS, Accept: 'application/vnd.github.v3.diff' }, as: 'text', timeoutMs: TIMEOUT_MS });
}

/**
 * The GraphQL endpoint for a REST root: trailing slashes trimmed, a trailing
 * `/v3` dropped, `/graphql` appended. `https://api.github.com` gives
 * `https://api.github.com/graphql`; `https://ghe.imagile.dev/api/v3` gives
 * `https://ghe.imagile.dev/api/graphql`.
 */
export function graphqlUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const stripped = trimmed.endsWith('/v3') ? trimmed.slice(0, -3) : trimmed;
  return stripped.endsWith('/') ? `${stripped}graphql` : `${stripped}/graphql`;
}

export function githubGraphql<T>(ctx: GitHubContext, query: string, variables?: Record<string, unknown>): Promise<T> {
  // A full URL on the connection's own origin; core sends it as it is.
  return apiGraphql<T>(githubArea, ctx, graphqlUrl(ctx.connection.baseUrl), { query, ...(variables ? { variables } : {}) }, { headers: HEADERS, timeoutMs: TIMEOUT_MS });
}

/**
 * Every item of a page/per_page list, 100 at a time from page 1, stopping on
 * a short page, with no cap of the predecessor's own (core's 1,000-page bound
 * still applies). `items` picks the list out of a wrapper (`check_runs`).
 */
export async function githubAll<T>(ctx: GitHubContext, path: string, what: string, query: Record<string, QueryValue> = {}, items: (body: unknown) => T[] = (body) => (Array.isArray(body) ? (body as T[]) : [])): Promise<T[]> {
  const paged = await paginate<T>(
    { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: PER_PAGE, items },
    // per_page before page, in the predecessor's order.
    async (p) => ({ body: await github<unknown>(ctx, path, { query: { ...query, per_page: p.per_page, page: p.page } }) }),
    { what },
  );
  return paged.items;
}

/**
 * The owner and repo a command acts on: a flag, then the git remote, then
 * the connection's owner/repo (usually defaults.github), as before. The git
 * step's value is the remote itself (see gitRemoteValue in area.ts); it
 * counts only when its host matches this connection's base URL, by the same
 * parser, and otherwise gives way to the connection's setting. Both values
 * are written back to ctx.context and meta.context, so the report says what
 * the call used.
 */
export function target(ctx: GitHubContext): { owner: string; repo: string } {
  const owner = settle(ctx, 'owner');
  const repo = settle(ctx, 'repo');
  if (!owner || !repo) {
    throw new ToilError('INVALID_INPUT', 'Could not determine GitHub owner/repo. Pass --owner and --repo, or set owner and repo under defaults.github in your toil config.', {
      fix: `Pass --owner <owner> and --repo <repo>, run inside a clone whose origin is on this GitHub host, or set owner and repo under defaults.github (${githubArea.envName('owner')} and ${githubArea.envName('repo')} for the default connection).`,
    });
  }
  return { owner, repo };
}

function settle(ctx: GitHubContext, name: 'owner' | 'repo'): string | undefined {
  const found = ctx.resolved.inputs?.[name];
  if (found?.source !== 'git') return ctx.context[name];
  const fromRemote = parseGitHubRemote(found.value, ctx.connection.baseUrl)?.[name];
  const setting = ctx.connection[name];
  const inputs = ctx.resolved.inputs!;
  if (fromRemote) inputs[name] = { value: fromRemote, source: 'git' };
  else if (setting) inputs[name] = { value: setting, source: 'connection' };
  else delete inputs[name];
  const value = fromRemote ?? setting;
  if (value === undefined) delete ctx.context[name];
  else ctx.context[name] = value;
  return value;
}
