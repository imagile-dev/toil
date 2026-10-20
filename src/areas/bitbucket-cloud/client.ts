import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate, type Paged } from '../../core/paginate.js';
import type { QueryParam, RestResponse } from '../../core/rest.js';
import { bitbucketCloudArea, type BitbucketCloudSettings } from './area.js';

/**
 * Every request toil sends to Bitbucket Cloud, each from Atlassian's REST API
 * 2.0 reference (https://developer.atlassian.com/cloud/bitbucket/rest/).
 * Commands say what they want; this module knows the paths and the
 * `next`-link paging. Every list in Bitbucket Cloud arrives with a
 * forwarding address for the rest of it, which is more than most memos manage.
 */

export type BitbucketCloudConnection = Connection<BitbucketCloudSettings>;
export type BitbucketCloudContext = CommandContext<BitbucketCloudConnection, { workspace?: string; repo?: string }>;

/** Items per page: the documented maximum, so a full list takes the fewest calls. */
export const PAGELEN = 100;

/** What a command that acts on one repository lists as its context. */
export const IN_REPO = { workspace: 'required', repo: 'required' } as const;
/** What a command that acts on a whole workspace lists. */
export const IN_WORKSPACE = { workspace: 'required' } as const;

/** One path segment, percent-encoded; core refuses a `.` or `..` segment before sending. */
export const seg = (value: string | number): string => encodeURIComponent(String(value));

/** A file or folder path inside a repository, each segment encoded and the slashes kept. */
export const filePath = (path: string): string =>
  path
    .split('/')
    .filter((s) => s !== '')
    .map(seg)
    .join('/');

/** The repository's own root: `/repositories/{workspace}/{repo}`. */
export function repoPath(ctx: BitbucketCloudContext): string {
  return `/repositories/${seg(ctx.context.workspace!)}/${seg(ctx.context.repo!)}`;
}

export const prPath = (ctx: BitbucketCloudContext, id: number) => `${repoPath(ctx)}/pullrequests/${id}`;

export type Request = Pick<ApiRequest, 'method' | 'query' | 'json' | 'as' | 'redirect'>;

export function bbc<T>(ctx: BitbucketCloudContext, path: string, req: Request = {}): Promise<T> {
  return apiRequest<T>(bitbucketCloudArea, ctx, path, req);
}

/** bbc, with the status and headers: a merge answers 202 with a Location to poll. */
export function bbcResponse<T>(ctx: BitbucketCloudContext, path: string, req: Request = {}): Promise<RestResponse<T>> {
  return apiResponse<T>(bitbucketCloudArea, ctx, path, req);
}

interface PageBody<T> {
  values?: T[];
  next?: string;
}

/**
 * A `next` link, checked before toil follows it: it must stay on the
 * connection's own origin and name the same list the first request did.
 * Atlassian calls the link opaque, so toil follows it rather than building
 * page numbers; it just doesn't follow it anywhere else. A cursor passed back
 * with --cursor is the same link, and gets the same check.
 */
function nextUrl(ctx: BitbucketCloudContext, path: string, next: string): string {
  const expected = new URL(ctx.connection.baseUrl.replace(/\/*$/, '/') + path.replace(/^\/+/, ''));
  let target: URL;
  try {
    target = new URL(next);
  } catch {
    target = new URL('http://invalid');
  }
  if (target.origin !== expected.origin || target.pathname !== expected.pathname) {
    throw new ToilError('INVALID_INPUT', `The next-page link ${target.origin === 'http://invalid' ? `"${next}"` : `${target.origin}${target.pathname}`} isn't the list toil asked for (${expected.origin}${expected.pathname}).`, {
      fix: 'Pass back meta.page.nextCursor exactly as a previous call to the same command returned it, or leave out --cursor to start from the first page.',
    });
  }
  return target.toString();
}

/**
 * A paged list: the first request carries the query and `pagelen`, and each
 * one after follows the previous page's `next` link, until a page has none.
 * With `cap`, it stops at that many and meta.page says where to carry on.
 */
export function list<T>(
  ctx: BitbucketCloudContext,
  what: string,
  path: string,
  query: Record<string, QueryParam> = {},
  opts: { cap?: number | undefined; cursor?: string | undefined } = {},
): Promise<Paged<T>> {
  return paginate<T>(
    { kind: 'nextPageKey', param: 'next', key: (body) => (body as PageBody<T>).next, items: (body) => (body as PageBody<T>).values ?? [] },
    async (paging) => {
      const next = paging.next;
      const body = typeof next === 'string' ? await bbc<unknown>(ctx, nextUrl(ctx, path, next)) : await bbc<unknown>(ctx, path, { query: { ...query, pagelen: PAGELEN } });
      return { body };
    },
    { what, ...(opts.cap !== undefined ? { cap: opts.cap, setPage: ctx.setPage } : {}), ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}) },
  );
}

/** Every item of a paged list. */
export async function all<T>(ctx: BitbucketCloudContext, what: string, path: string, query: Record<string, QueryParam> = {}): Promise<T[]> {
  return (await list<T>(ctx, what, path, query)).items;
}

/** A cursor only makes sense with the limit that produced it. */
export function needLimitForCursor(input: { limit?: number | undefined; cursor?: string | undefined }): void {
  if (input.cursor !== undefined && input.limit === undefined) {
    throw new ToilError('INVALID_INPUT', '--cursor needs --limit', {
      fix: 'Pass --limit with --cursor (the limit of the call that gave you the cursor), or leave out --cursor to read everything.',
    });
  }
}

export interface Account {
  uuid?: string;
  account_id?: string;
  display_name?: string;
  nickname?: string;
  [key: string]: unknown;
}

export interface Participant {
  user?: Account;
  role?: string;
  approved?: boolean;
  state?: string | null;
  [key: string]: unknown;
}

export interface PullRequest {
  id: number;
  title?: string;
  description?: string;
  state?: string;
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  destination?: { branch?: { name?: string }; commit?: { hash?: string } };
  reviewers?: Account[];
  participants?: Participant[];
  [key: string]: unknown;
}

export function getPR(ctx: BitbucketCloudContext, id: number): Promise<PullRequest> {
  return bbc<PullRequest>(ctx, prPath(ctx, id));
}

/**
 * A pull request's changes as a two-commit spec, `source..destination`, for
 * the diff and diffstat endpoints read with `topic=true`: the three-dot diff
 * Bitbucket shows on the pull request. Built from the pull request rather than
 * following its /diff or /diffstat redirect, so the path and context
 * parameters reach the diff itself and every `next` link stays on the path
 * toil asked for.
 */
export function prSpec(found: PullRequest): string {
  const source = found.source?.commit?.hash;
  const destination = found.destination?.commit?.hash;
  if (!source || !destination) {
    throw new ToilError('NOT_FOUND', `Pull request ${found.id} has no source or destination commit to diff.`, { fix: 'Check the pull request still has both branches: toil bitbucket-cloud pr get <id>.' });
  }
  return `${source}..${destination}`;
}

/**
 * Reviewers as Bitbucket Cloud identifies them: a `{uuid}` in braces is a
 * uuid, anything else an Atlassian account id. Usernames left the API in
 * 2019, along with most of the forms that asked for them.
 */
export type ReviewerRef = { uuid: string } | { account_id: string };

export function reviewerRefs(list: string): ReviewerRef[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => (/^\{.*\}$/.test(id) ? { uuid: id } : { account_id: id }));
}

/** A commit hash, full or abbreviated (7 to 40 hex digits), which needs no lookup. */
export const isHash = (ref: string): boolean => /^[0-9a-f]{7,40}$/i.test(ref);

/**
 * A branch, tag or commit as the commit hash it names. A hash is used as it
 * is; anything else is the newest commit `include=<ref>` lists, because a
 * branch name with a `/` can't go in a `src/{commit}` path segment. With no
 * ref, it's the repository's main branch.
 */
export async function resolveRef(ctx: BitbucketCloudContext, ref: string | undefined): Promise<string> {
  if (ref !== undefined && isHash(ref)) return ref;
  const name = ref ?? (await bbc<{ mainbranch?: { name?: string } }>(ctx, repoPath(ctx))).mainbranch?.name;
  if (!name) {
    throw new ToilError('NOT_FOUND', `Repository ${ctx.context.workspace}/${ctx.context.repo} has no main branch to read from.`, { fix: 'Pass --ref with a branch, tag or commit hash.' });
  }
  const page = await bbc<PageBody<{ hash?: string }>>(ctx, `${repoPath(ctx)}/commits`, { query: { include: name, pagelen: 1 } });
  const hash = page.values?.[0]?.hash;
  if (!hash) {
    throw new ToilError('NOT_FOUND', `No commit found for "${name}" in ${ctx.context.workspace}/${ctx.context.repo}.`, { fix: 'Check the branch, tag or commit exists: toil bitbucket-cloud branch list or tag list.' });
  }
  return hash;
}

/**
 * A cursor as meta.page.nextCursor carries it, for a command's examples: a
 * `next` link on the placeholder host the fixture answers on, which never
 * resolves. A real cursor comes from a real answer.
 */
export const exampleCursor = (path: string): string => Buffer.from(JSON.stringify({ c: `https://bitbucket-cloud.imagile.dev/2.0${path}`, s: 0 })).toString('base64url');
