import { ToilError, type ErrorCode } from './errors.js';
import { redactUrl } from './http.js';

/**
 * The HTTP plumbing every REST integration needs and none should rewrite:
 * building a URL under a base that may carry a context path, turning a failed
 * response into a ToilError with the server's own message, retrying a 429 as
 * long as the server asks for a reasonable wait, and saying plainly when the
 * host could not be reached at all. Areas supply the headers and the fix for a
 * rejected credential; this supplies the rest.
 *
 * A request that fails three times is not escalated to a steering committee.
 * It is returned, with the reason, to the person who made it.
 */

export type QueryValue = string | number | boolean | undefined;

/**
 * `path` under `base`, keeping any path `base` already has: a Jira at
 * `https://jira.imagile.dev/jira` keeps its `/jira`. Commas in the query stay
 * literal, because several REST APIs read `expand=a,b` and nothing else.
 */
export function buildUrl(base: string, path: string, params?: Record<string, QueryValue>): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, root);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (url.search) url.search = url.search.replace(/%2C/gi, ',');
  return url.toString();
}

/** A server asking for a longer wait than this is answered with an error, not a hang. */
export const MAX_RETRY_AFTER_SECONDS = 30;
const ATTEMPTS = 3;

/** Retry-After as seconds: a number of seconds, or an HTTP date. Anything else is ignored. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // HTTP dates start with a weekday; Date.parse is too forgiving of "-1" or "1.5".
  if (!/^[A-Za-z]+[, ]/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined;
}

/** The server's own explanation from an error body, in the shapes REST APIs commonly use. */
export function errorMessageFrom(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const p = parsed as { errorMessages?: unknown; errors?: unknown; message?: unknown; detail?: unknown };
  const parts: string[] = [];
  if (Array.isArray(p.errorMessages)) parts.push(...p.errorMessages.filter((m): m is string => typeof m === 'string' && m !== ''));
  if (p.errors && typeof p.errors === 'object' && !Array.isArray(p.errors)) {
    for (const [field, message] of Object.entries(p.errors as Record<string, unknown>)) parts.push(`${field}: ${String(message)}`);
  }
  if (Array.isArray(p.errors)) {
    for (const e of p.errors as Array<{ message?: unknown; msg?: unknown }>) {
      if (typeof e?.message === 'string') parts.push(e.message);
      else if (typeof e?.msg === 'string') parts.push(e.msg);
    }
  }
  if (parts.length === 0 && typeof p.message === 'string') parts.push(p.message);
  if (parts.length === 0 && typeof p.detail === 'string') parts.push(p.detail);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export interface RestContext {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

export interface RestOptions {
  /** The service's name in messages: "Jira". */
  service: string;
  /** What to do when the server rejects the credential (401/403). */
  authFix: string;
  /** How to read a successful body. Defaults to JSON. */
  as?: 'json' | 'bytes';
}

/**
 * Sends one request (retrying a 429) and returns the parsed body: JSON, or
 * undefined for an empty or 204 response, or the raw bytes with `as: 'bytes'`.
 */
export async function restRequest<T>(ctx: RestContext, url: string, init: RequestInit, options: RestOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await ctx.fetch(url, init);
    } catch (err) {
      // An abort is execute()'s to report (TIMEOUT or CANCELLED); anything else is the network.
      if (ctx.signal.aborted) throw err;
      throw unreachable(url, err, options.service);
    }

    if (response.status === 429) {
      const wait = parseRetryAfter(response.headers.get('Retry-After'));
      if (attempt >= ATTEMPTS || (wait !== undefined && wait > MAX_RETRY_AFTER_SECONDS)) {
        // The predecessor's wording, so scripts matching on it keep working.
        const message = wait !== undefined && wait > MAX_RETRY_AFTER_SECONDS
          ? `Rate limited: server requested a ${wait}s retry delay, which exceeds the ${MAX_RETRY_AFTER_SECONDS}s cap`
          : 'Rate limited';
        throw new ToilError('HTTP', message, {
          fix: 'Wait a while and try again, or make fewer requests (a narrower query, a smaller page).',
          details: { status: 429, url: redactUrl(url), retryAfterSeconds: wait ?? null },
        });
      }
      await sleep(wait !== undefined ? wait * 1000 : attempt * 1000, ctx.signal);
      continue;
    }

    if (!response.ok) throw await failed(response, url, options);
    if (options.as === 'bytes') return new Uint8Array(await response.arrayBuffer()) as T;
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Usually a sign-in or proxy page served with a 200 in place of the API.
      throw new ToilError('HTTP', `${options.service} answered ${redactUrl(url)} with something that isn't JSON.`, {
        fix: 'Check baseUrl points at the service itself, not a login page or proxy in front of it.',
        details: { status: response.status, url: redactUrl(url), contentType: response.headers.get('content-type') },
      });
    }
  }
}

async function failed(response: Response, url: string, options: RestOptions): Promise<ToilError> {
  const body = await response.text().catch(() => '');
  const reason = errorMessageFrom(body) ?? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const details = { status: response.status, url: redactUrl(url) };
  const code: ErrorCode = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 404 ? 'NOT_FOUND' : 'HTTP';
  const fix =
    code === 'AUTH'
      ? options.authFix
      : code === 'NOT_FOUND'
        ? `Check the key or id you passed exists in ${options.service} and is visible to you.`
        : `See ${options.service}'s message above; fix the request and try again.`;
  return new ToilError(code, reason, { fix, details });
}

function unreachable(url: string, err: unknown, service: string): ToilError {
  const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  const top = err instanceof Error ? err.message : String(err);
  const reason = typeof cause?.message === 'string' ? `${top}: ${cause.message}` : top;
  const tls = code !== undefined && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code);
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    // keep the raw URL
  }
  return new ToilError('NETWORK', `Request failed: ${reason}`, {
    fix: tls
      ? `${service}'s certificate isn't trusted. Point NODE_EXTRA_CA_CERTS at your organization's CA bundle.`
      : `Check baseUrl, and that this machine can reach ${origin} (VPN, proxy, DNS).`,
    details: { url: redactUrl(url), cause: code ?? reason },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
