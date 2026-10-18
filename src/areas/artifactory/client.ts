import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { redactUrl } from '../../core/http.js';
import { statusLine } from '../../core/rest.js';
import { artifactoryArea, tokenFix } from './area.js';

/**
 * Every classic REST request toil sends to Artifactory, as the canonical
 * implementation sent it: paths relative to the base URL so a context root
 * (`/artifactory`) survives, the JSON headers on every call, a 30 s timeout
 * unless the command says otherwise, and commas left literal in the query.
 * The headers declare JSON even when the body is text; the declaration is
 * filed, not checked, like most declarations.
 */

export type ArtifactoryConnection = Connection<z.output<typeof artifactoryArea.connection>>;
export type ArtifactoryContext = CommandContext<ArtifactoryConnection>;

/** The contract's per-request timeout for the classic calls. */
export const TIMEOUT_MS = 30_000;

/** What every classic call sent besides the hook's token. */
export const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export function artifactory<T>(ctx: ArtifactoryContext, path: string, req: ApiRequest = {}): Promise<T> {
  return apiRequest<T>(artifactoryArea, ctx, path, { timeoutMs: TIMEOUT_MS, ...req, headers: { ...JSON_HEADERS, ...req.headers } });
}

/** Every status from 400 to 599 but 429, which core always retries first. */
const NOT_OK = Array.from({ length: 200 }, (_, i) => 400 + i).filter((status) => status !== 429);

/**
 * `api/system/ping` as text. Its failures read the way the contract's text
 * helper read them: the JSON body's top-level `message`, else `HTTP <status>`.
 * Artifactory's usual `{ errors: [{ message }] }` is therefore not quoted
 * here, unlike every other command, exactly as before.
 */
export async function ping(ctx: ArtifactoryContext): Promise<string> {
  const response = await apiResponse<string>(artifactoryArea, ctx, 'api/system/ping', {
    headers: { ...JSON_HEADERS, Accept: 'text/plain' },
    timeoutMs: TIMEOUT_MS,
    as: 'text',
    accept: NOT_OK,
  });
  if (response.status < 400) return response.data;
  let message = statusLine(response.status, response.statusText);
  try {
    const parsed = JSON.parse(response.data) as { message?: unknown };
    if (parsed.message) message = String(parsed.message);
  } catch {
    // not JSON: keep the status line
  }
  const status = response.status;
  const code = status === 401 || status === 403 ? 'AUTH' : status === 404 ? 'NOT_FOUND' : 'HTTP';
  const fix =
    code === 'AUTH' ? tokenFix(ctx.connection.name, artifactoryArea.envName('token')) : code === 'NOT_FOUND' ? 'Check baseUrl points at Artifactory itself, including any context path such as /artifactory.' : "See Artifactory's message above, and check the server's health.";
  throw new ToilError(code, message, { fix, details: { status, url: redactUrl(response.url) } });
}
