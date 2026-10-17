import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import type { RestResponse } from '../../core/rest.js';
import { bitbucketArea } from './area.js';

/**
 * Every request toil sends to Bitbucket Data Center, as the canonical
 * implementation sent them: REST API 1.0 under `/rest/api/1.0`, plus the
 * build-status and default-reviewers plugin roots, JSON headers on every call,
 * and project and repo dropped into paths unencoded (only the default-reviewer
 * lookup encodes them). Three REST roots for one product is not sprawl; it is
 * a reorganisation that was never completed.
 */

export type BitbucketConnection = Connection<z.output<typeof bitbucketArea.connection>>;
export type BitbucketContext = CommandContext<BitbucketConnection, { project?: string; repo?: string }>;

export const API = '/rest/api/1.0';
/** The predecessor's per-request timeout. */
const TIMEOUT_MS = 30_000;
/** The predecessor's page size for every paged list. */
const PAGE_SIZE = 100;

/** What every call sends besides the hook's token, exactly as the predecessor sent it. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export type Request = Pick<ApiRequest, 'method' | 'query' | 'json'>;

export function bb<T>(ctx: BitbucketContext, path: string, req: Request = {}): Promise<T> {
  return apiRequest<T>(bitbucketArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...req });
}

/** bb, with the response headers: `X-AUSERNAME` says who the token belongs to. */
export function bbResponse<T>(ctx: BitbucketContext, path: string, req: Request = {}): Promise<RestResponse<T>> {
  return apiResponse<T>(bitbucketArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...req });
}

/**
 * Every item of a paged list, 100 at a time, following `isLastPage` and
 * `nextPageStart` until the server says it's done.
 */
export async function bbAll<T>(ctx: BitbucketContext, path: string, query: Record<string, string>, what: string): Promise<T[]> {
  const { items } = await paginate<T>(
    { kind: 'nextPageStart', startParam: 'start', limitParam: 'limit', pageSize: PAGE_SIZE },
    async (page) => ({ body: await bb<unknown>(ctx, path, { query: { ...query, ...page } }) }),
    { what },
  );
  return items;
}

/** The repository's own API root: `/rest/api/1.0/projects/{project}/repos/{repo}`, unencoded. Suspected bug (#76 item 18): `../` in either reaches another endpoint on the same host. */
export const repoPath = (project: string, repo: string) => `${API}/projects/${project}/repos/${repo}`;
export const prPath = (project: string, repo: string, id: number) => `${repoPath(project, repo)}/pull-requests/${id}`;

/** A number the predecessor read with parseInt, as it read it: `12abc` is 12, `abc` is NaN. */
export const toInt = (value: number | string | undefined, fallback?: string): number => parseInt(String(value ?? fallback), 10);

/** What a command that acts on one repository lists as its context. */
export const IN_REPO = { project: 'required', repo: 'required' } as const;

/**
 * The project and repo a command acts on. Commands that need both list them
 * as required, so core has already refused the call, in the predecessor's
 * words, when either is missing.
 */
export function where(ctx: BitbucketContext): { project: string; repo: string } {
  return { project: ctx.context.project!, repo: ctx.context.repo! };
}

/**
 * The project alone, for create-repo and create-prs, with the predecessor's
 * own wording for those two; the area-wide wording names the repo as well.
 */
export function projectOf(ctx: BitbucketContext): string {
  const { project } = ctx.context;
  if (!project) {
    throw new ToilError('INVALID_INPUT', 'Could not determine Bitbucket project. Pass --project, or set project on the connection.', {
      fix: `Pass --project <key>, or set project on connection ${ctx.connection.name} (usually under defaults.bitbucket; ${bitbucketArea.envName('project')} for the default connection).`,
    });
  }
  return project;
}

/** A comma list split as the predecessor split it: trimmed, empty entries kept. */
export const commaList = (value: string) => value.split(',').map((s) => s.trim());

export interface BitbucketUser {
  name: string;
  slug: string;
  displayName?: string;
  emailAddress?: string;
}

export interface BitbucketPR {
  id: number;
  title?: string;
  description?: string;
  version: number;
  createdDate: number;
  fromRef?: { displayId?: string };
  reviewers?: Array<{ user: BitbucketUser }>;
  [key: string]: unknown;
}

export function getPR(ctx: BitbucketContext, project: string, repo: string, id: number): Promise<BitbucketPR> {
  return bb<BitbucketPR>(ctx, prPath(project, repo, id));
}

export interface CreatePR {
  project: string;
  repo: string;
  title: string;
  source: string;
  target: string;
  description?: string | undefined;
  reviewers?: string[] | undefined;
}

export function createPR(ctx: BitbucketContext, opts: CreatePR): Promise<BitbucketPR> {
  const ref = (branch: string) => ({ id: `refs/heads/${branch}`, repository: { slug: opts.repo, project: { key: opts.project } } });
  const body: Record<string, unknown> = { title: opts.title, description: opts.description, fromRef: ref(opts.source), toRef: ref(opts.target) };
  // Leaving reviewers out, rather than sending [], lets Bitbucket apply its
  // default-reviewer conditions; an empty list overrules them.
  if (opts.reviewers && opts.reviewers.length > 0) body.reviewers = opts.reviewers.map((name) => ({ user: { name } }));
  return bb<BitbucketPR>(ctx, `${repoPath(opts.project, opts.repo)}/pull-requests`, { method: 'POST', json: body });
}

/**
 * The caller, from the `X-AUSERNAME` header Bitbucket stamps on every
 * authenticated response, then `/users/{username}`. The predecessor chose the
 * header over the applinks whoami servlet, which answers PAT requests with an
 * empty body on some servers. Suspected bug (#76 item 13): the username is
 * used where the endpoint expects a slug.
 */
export async function currentUser(ctx: BitbucketContext): Promise<BitbucketUser> {
  const { headers } = await bbResponse<unknown>(ctx, `${API}/application-properties`);
  const username = headers.get('x-ausername');
  if (!username) {
    throw new ToilError('HTTP', 'Could not determine current Bitbucket user: X-AUSERNAME header was absent from the server response', {
      fix: `Check that ${API}/application-properties on connection ${ctx.connection.name} answers with the X-AUSERNAME header; a proxy in front of Bitbucket may be stripping it.`,
      details: { path: `${API}/application-properties` },
    });
  }
  return bb<BitbucketUser>(ctx, `${API}/users/${encodeURIComponent(username)}`);
}

export interface BuildStatus {
  state: string;
  key: string;
  name: string;
  url: string;
  description?: string;
  dateAdded: number;
}

/** One page of a commit's build statuses, at the server's default size. Suspected bug (#76 item 12): later pages are never read. */
export async function buildStatus(ctx: BitbucketContext, commit: string): Promise<BuildStatus[]> {
  const result = await bb<{ values?: BuildStatus[] } | undefined>(ctx, `/rest/build-status/1.0/commits/${commit}`);
  return result?.values ?? [];
}
