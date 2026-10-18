import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { redactUrl } from '../../core/http.js';
import { statusLine } from '../../core/rest.js';
import { kibanaArea } from './area.js';

/**
 * Every request toil sends to Kibana, and what the commands share: the space
 * prefix, page validation, the NDJSON export and the 503 that is still an
 * answer. When the key on loan from Elasticsearch is refused, the error says
 * whose key it was, so the right department gets the complaint.
 */

export type KibanaConnection = Connection<z.output<typeof kibanaArea.connection>>;
export type KibanaContext = CommandContext<KibanaConnection>;

/** The per-request timeout for every call but export. */
export const TIMEOUT_MS = 30_000;
/** Export can take a while on a dashboard with deep references. */
export const EXPORT_TIMEOUT_MS = 60_000;

const JSON_ACCEPT = 'application/json';
const NDJSON_ACCEPT = 'application/x-ndjson, application/json';

function headers(accept: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: accept, Connection: 'close' };
}

/** A JSON call, with core's 429 retry. */
export function kibana<T>(ctx: KibanaContext, path: string, req: Omit<ApiRequest, 'headers'> = {}): Promise<T> {
  return withKeyHint(ctx, () => apiRequest<T>(kibanaArea, ctx, path, { headers: headers(JSON_ACCEPT), timeoutMs: TIMEOUT_MS, ...req }));
}

/**
 * `POST /api/saved_objects/_export`, read as NDJSON: one saved object per
 * line, then an export-details line. Blank lines are dropped; a line that
 * isn't JSON (a proxy's sign-in page) is an error that quotes the start of it.
 * No 429 retry on this raw-text path.
 * https://www.elastic.co/docs/api/doc/kibana/operation/operation-post-saved-objects-export
 */
export async function kibanaNdjson(ctx: KibanaContext, path: string, json: unknown): Promise<unknown[]> {
  const res = await withKeyHint(ctx, () =>
    apiResponse<string>(kibanaArea, ctx, path, { method: 'POST', json, headers: headers(NDJSON_ACCEPT), as: 'text', timeoutMs: EXPORT_TIMEOUT_MS, retryRateLimit: false }),
  );
  return res.data
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseKibanaJson(line, res.url, res.status));
}

/**
 * `GET /api/status`, read on a 503 too: an unhealthy Kibana reports its
 * status with that code. Only a 503 carrying Kibana's own `status.overall`
 * object counts; a proxy's or load balancer's 503 stays an error, with
 * Kibana's `message` when the body has one. No 429 retry.
 * https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-status
 */
export async function kibanaStatus<T>(ctx: KibanaContext): Promise<T> {
  const res = await withKeyHint(ctx, () =>
    apiResponse<string>(kibanaArea, ctx, '/api/status', { headers: headers(JSON_ACCEPT), as: 'text', accept: [503], timeoutMs: TIMEOUT_MS, retryRateLimit: false }),
  );
  if (res.status === 503) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.data);
    } catch {
      parsed = undefined;
    }
    const overall = (parsed as { status?: { overall?: unknown } } | undefined)?.status?.overall;
    if (typeof overall !== 'object' || overall === null) {
      const message = (parsed as { message?: unknown } | undefined)?.message;
      throw new ToilError('HTTP', message !== undefined && message !== null && message !== '' ? String(message) : statusLine(503, res.statusText), {
        fix: 'Kibana, or a proxy in front of it, is unavailable. Check baseUrl points at Kibana itself, and try again once it is up.',
        details: { status: 503, url: redactUrl(res.url) },
      });
    }
    return parsed as T;
  }
  return parseKibanaJson(res.data, res.url, res.status) as T;
}

function parseKibanaJson(text: string, url: string, status: number): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ToilError('HTTP', `Kibana returned a non-JSON response (is baseUrl pointing at Kibana?): ${text.slice(0, 120)}`, {
      fix: 'Check baseUrl points at Kibana itself, not a sign-in page or proxy in front of it.',
      details: { status, url: redactUrl(url) },
    });
  }
}

/**
 * A 401 or 403 while sending the Elasticsearch connection's key usually means
 * that key has no Kibana privileges: the message says which key was sent.
 */
async function withKeyHint<T>(ctx: KibanaContext, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const shared = ctx.resolved.shared?.apiKey;
    if (!(err instanceof ToilError) || err.code !== 'AUTH' || !shared) throw err;
    throw new ToilError(
      'AUTH',
      `${err.message} (sent the shared Elasticsearch API key from connection ${shared.connection}; if it lacks Kibana privileges, give connection ${ctx.connection.name} its own key: toil connections login ${ctx.connection.name}, or ${kibanaArea.envName('apiKey')} for the default connection)`,
      { fix: err.fix, details: err.details },
    );
  }
}

/**
 * An `/api/...` path in the Kibana space: the default space has no prefix,
 * any other is `/s/<space-id>/api/...`.
 * https://www.elastic.co/docs/api/doc/kibana/group/endpoint-spaces
 */
export function spacePath(space: string | undefined, path: string): string {
  if (!space || space === 'default') return path;
  return `/s/${encodeURIComponent(space)}${path}`;
}

/** A whole number of at least 1, from a number or its text, as `--page` and `--per-page` take it. */
export function positiveInt(value: number | string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ToilError('INVALID_INPUT', `${flag} must be a positive integer.`, { fix: `Pass a whole number of 1 or more to ${flag}.` });
  return n;
}
