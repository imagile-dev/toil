import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { repointUrl } from '../../core/rest.js';
import { serverTooOld } from '../../core/supported.js';
import { adoArea, adoSupported } from './area.js';

/**
 * Every request toil sends to Azure DevOps Server, as the canonical
 * implementation sent them: JSON headers on every call (a GET included),
 * `api-version` in the query, collection, project and repo URI-encoded into
 * the path, and a 30 s timeout, 60 s for attachments. The API version is
 * pinned at 7.1, a number agreed once and never revisited, like most
 * standards.
 */

export type AdoConnection = Connection<z.output<typeof adoArea.connection>>;
export type AdoContext = CommandContext<AdoConnection, { collection?: string; organization?: string; project?: string; repo?: string }>;

export const API = '7.1';
/** connectionData's preview version. */
export const API_CONNECTION = '7.1-preview.1';
/** Work item comments' preview version. */
export const API_COMMENTS = '7.1-preview.4';

const TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 60_000;

/** What the predecessor's fetcher put on every request, under the caller's own headers. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };
/** The content type of every JSON Patch body. */
export const PATCH = { 'Content-Type': 'application/json-patch+json' };

export const enc = encodeURIComponent;

/** A number the predecessor read with parseInt, as it read it: `12abc` is 12, `abc` is NaN (#69 item 25). */
export const toInt = (value: number | string | undefined, fallback?: string): number => parseInt(String(value ?? fallback), 10);

/**
 * An older server's answer to `api-version=7.1` ("The requested REST API
 * version of 7.1 is out of range for this server") becomes core's
 * too-old error, naming the supported minimum. Code and details stay.
 */
function tooOld(err: unknown): unknown {
  if (err instanceof ToilError && /REST API version\b.*\bout of range/i.test(err.message)) {
    return serverTooOld(adoSupported, { detail: err.message, code: err.code, details: err.details });
  }
  return err;
}

async function send<T>(ctx: AdoContext, path: string, req: ApiRequest): Promise<T> {
  try {
    return await apiRequest<T>(adoArea, ctx, path, { timeoutMs: TIMEOUT_MS, ...req, headers: { ...JSON_HEADERS, ...req.headers } });
  } catch (err) {
    throw tooOld(err);
  }
}

export type Request = Pick<ApiRequest, 'method' | 'json' | 'headers'>;

/** One JSON request. `path` carries its own query string, as the predecessor wrote it. */
export function ado<T>(ctx: AdoContext, path: string, req: Request = {}): Promise<T> {
  return send<T>(ctx, path, req);
}

/**
 * One request of a list the predecessor read through its raw path, with the
 * response headers: no 429 retry there (#69 item 4), so none here.
 */
async function raw(ctx: AdoContext, path: string, query: Record<string, string | number>): Promise<{ body: unknown; headers: Headers }> {
  try {
    const response = await apiResponse<unknown>(adoArea, ctx, path, { timeoutMs: TIMEOUT_MS, headers: JSON_HEADERS, query, retryRateLimit: false });
    return { body: response.data, headers: response.headers };
  } catch (err) {
    throw tooOld(err);
  }
}

const valueOf = <T>(body: unknown): T[] => ((body as { value?: T[] } | undefined)?.value ?? []);

/**
 * Every item of a list paged by the `x-ms-continuationtoken` response header,
 * sent back as `continuationToken` until the header is absent.
 */
export async function adoAll<T>(ctx: AdoContext, path: string, query: Record<string, string | number>, what: string): Promise<T[]> {
  const { items } = await paginate<T>(
    { kind: 'header', header: 'x-ms-continuationtoken', param: 'continuationToken', items: valueOf<T>, params: query },
    (params) => raw(ctx, path, params),
    { what },
  );
  return items;
}

/** One page of a list, by `$top` and `$skip`, for an endpoint with no continuation token. */
export async function adoSkipPages<T>(ctx: AdoContext, path: string, query: Record<string, string | number>, pageSize: number, what: string): Promise<T[]> {
  // core's page style counts pages from 0 here; the API wants an item offset.
  const { items } = await paginate<T>(
    { kind: 'page', pageParam: 'page', sizeParam: 'size', pageSize, first: 0, items: valueOf<T> },
    (params) => raw(ctx, path, { ...query, $top: pageSize, $skip: Number(params.page) * pageSize }),
    { what },
  );
  return items;
}

/** The `value` of one raw-path request, unpaged. */
export async function adoValue<T>(ctx: AdoContext, path: string, query: Record<string, string | number>): Promise<T[]> {
  return valueOf<T>((await raw(ctx, path, query)).body);
}

/** Plain text (a build log), `Accept: text/plain`, with no 429 retry (#69 item 4). */
export function adoText(ctx: AdoContext, path: string): Promise<string> {
  return send<string>(ctx, path, { headers: { Accept: 'text/plain' }, as: 'text', retryRateLimit: false });
}

/** A raw upload: the file's bytes as `application/octet-stream`, the only type the attachment store takes. */
export function adoUpload<T>(ctx: AdoContext, path: string, data: Uint8Array): Promise<T> {
  return send<T>(ctx, path, { method: 'POST', body: data, headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream' }, timeoutMs: FILE_TIMEOUT_MS });
}

/**
 * Bytes from a URL the server handed back (an attachment's relation URL). The
 * PAT only goes to the configured origin: another host is re-pointed at it,
 * with a warning (#69 item 1).
 */
export function adoDownload(ctx: AdoContext, url: string): Promise<Uint8Array> {
  const target = repointUrl(url, ctx.connection.baseUrl, ctx.warn, {
    service: 'Azure DevOps',
    subject: 'attachment',
    code: 'ADO_ATTACHMENT_HOST',
    fix: 'Download it from the Azure DevOps web interface instead.',
  });
  return send<Uint8Array>(ctx, target, { headers: { Accept: 'application/octet-stream' }, as: 'bytes', timeoutMs: FILE_TIMEOUT_MS });
}

export interface Where {
  collection: string;
  project: string;
  repo: string;
}

function missing(ctx: AdoContext, key: 'collection' | 'project', flag: string): ToilError {
  return new ToilError('INVALID_INPUT', `Could not determine Azure DevOps ${key}. Pass ${flag}, or set ${key} on the connection.`, {
    fix: `Pass ${flag} <name>, or set ${key} on connection ${ctx.connection.name} (usually under defaults.ado; ${adoArea.envName(key)} for the default connection).`,
  });
}

/**
 * The collection, project and repo a command acts on, checked in the
 * predecessor's order. `--collection` beats `--organization`, which beats
 * the git remote and the connection. Every command needs a collection and a
 * project, even those whose request uses neither (#69 item 2); repo commands
 * pass `needRepo`.
 */
export function where(ctx: AdoContext, needRepo = false): Where {
  const passed = ctx.resolved.inputs?.collection?.source === 'input';
  const collection = (passed ? ctx.context.collection : (ctx.context.organization ?? ctx.context.collection)) ?? '';
  const project = ctx.context.project ?? '';
  const repo = ctx.context.repo ?? '';
  if (!collection) throw missing(ctx, 'collection', '--collection');
  if (!project) throw missing(ctx, 'project', '--project');
  if (needRepo && !repo) {
    throw new ToilError('INVALID_INPUT', 'Could not determine Azure DevOps repo. Pass --repo, or run from inside a checked-out ADO repo.', {
      fix: `Pass --repo <name>, run from a clone whose origin is on ${ctx.connection.baseUrl}, or set repo on connection ${ctx.connection.name} (${adoArea.envName('repo')} for the default connection).`,
    });
  }
  return { collection, project, repo };
}

/** `/<collection>/<project>`, each encoded. */
export const projectPath = (w: Where) => `/${enc(w.collection)}/${enc(w.project)}`;
/** `/<collection>/<project>/_apis/git/repositories/<repo>`. */
export const repoPath = (w: Where) => `${projectPath(w)}/_apis/git/repositories/${enc(w.repo)}`;

/** The connection's base URL without a trailing slash, for links the server stores (work item relations). */
export const baseUrlOf = (ctx: AdoContext) => ctx.connection.baseUrl.replace(/\/$/, '');
