import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiGraphql, apiRequest, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import type { QueryValue } from '../../core/rest.js';
import { githubArea } from './area.js';

/**
 * Every request toil sends to GitHub, kept as the command contract
 * sent them: the same headers on every call (the pinned API version, JSON
 * content type, `Connection: close`), owner, repo and labels interpolated
 * into paths as given, page/per_page paging that stops on a short page, and
 * GraphQL at the endpoint derived from the REST root. One header set for
 * every request, in the way a uniform is issued: whether or not it fits.
 */

export type GitHubConnection = Connection<z.output<typeof githubArea.connection>>;
export type GitHubContext = CommandContext<GitHubConnection, Partial<Record<'owner' | 'repo', string>>>;

/** The contract's per-request timeout. */
const TIMEOUT_MS = 30_000;
/** GitHub's page-size maximum; a short page is the last one. */
const PER_PAGE = 100;

/** What every call sends besides the token, exactly as the contract sent it. */
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Connection: 'close' };

type Request = Pick<ApiRequest, 'method' | 'query' | 'json'>;

/**
 * Owner, repo, labels and refs go into paths as typed, and URL parsing
 * collapses a `.` or `..` segment, so `--label ../../../repos/o/r` would aim a
 * DELETE at a different resource. Core refuses such a segment too (bound
 * `requests.path`); this check also reads the path as the URL parser does
 * first, dropping tab, LF and CR anywhere and trimming trailing C0 controls
 * and spaces, so `.\t.` or a trailing `.. ` can't slip past as something
 * else and become `..` afterwards. A path that walks upstairs has not filed
 * the paperwork to be there.
 */
export function assertNoDotSegments(path: string): void {
  // eslint-disable-next-line no-control-regex
  const parsed = path.replace(/[\t\n\r]/g, '').replace(/[\u0000- ]+$/, '');
  const segments = parsed.split(/[?#]/)[0]!.split(/[/\\]/);
  const dot = segments.find((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
  if (dot !== undefined) {
    throw new ToilError('INVALID_INPUT', `toil won't send a GitHub request whose path has a "${dot}" segment: ${JSON.stringify(path)}`, {
      fix: 'Check --owner, --repo, --label and --ref: none of them can be "." or "..", or contain "/../" or "/./", once tabs, line breaks and trailing spaces are ignored.',
    });
  }
}

export function github<T>(ctx: GitHubContext, path: string, req: Request = {}): Promise<T> {
  assertNoDotSegments(path);
  return apiRequest<T>(githubArea, ctx, path, { ...req, headers: HEADERS, timeoutMs: TIMEOUT_MS });
}

/**
 * A text body (the unified diff), with Accept swapped for the diff media
 * type. A 429 fails at once with the server's `message`, as the
 * contract's text call did; it never retried (suspected bug, #72 item 11).
 */
export function githubText(ctx: GitHubContext, path: string): Promise<string> {
  assertNoDotSegments(path);
  return apiRequest<string>(githubArea, ctx, path, { headers: { ...HEADERS, Accept: 'application/vnd.github.v3.diff' }, as: 'text', retryRateLimit: false, timeoutMs: TIMEOUT_MS });
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
 * a short page, with no cap of the contract's own (core's 1,000-page bound
 * still applies). `items` picks the list out of a wrapper (`check_runs`).
 */
export async function githubAll<T>(ctx: GitHubContext, path: string, what: string, query: Record<string, QueryValue> = {}, items: (body: unknown) => T[] = (body) => (Array.isArray(body) ? (body as T[]) : [])): Promise<T[]> {
  const paged = await paginate<T>(
    { kind: 'page', pageParam: 'page', sizeParam: 'per_page', pageSize: PER_PAGE, items },
    // per_page before page, in the contract's order.
    async (p) => ({ body: await github<unknown>(ctx, path, { query: { ...query, per_page: p.per_page, page: p.page } }) }),
    { what },
  );
  return paged.items;
}

/**
 * The owner and repo a command acts on: a flag, then the first remote (origin first) when
 * it's on this connection's host, then the connection's owner/repo (usually
 * defaults.github), as before. Core resolves all three; this only keeps the
 * contract's error when none of them has a value.
 */
export function target(ctx: GitHubContext): { owner: string; repo: string } {
  const { owner, repo } = ctx.context;
  if (!owner || !repo) {
    throw new ToilError('INVALID_INPUT', 'Could not determine GitHub owner/repo. Pass --owner and --repo, or set owner and repo under defaults.github in your toil config.', {
      fix: `Pass --owner <owner> and --repo <repo>, run inside a clone with a remote on this GitHub host, or set owner and repo under defaults.github (${githubArea.envName('owner')} and ${githubArea.envName('repo')} for the default connection).`,
    });
  }
  return { owner, repo };
}
