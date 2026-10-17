import { ToilError, type ErrorCode } from './errors.js';
import { redactUrl } from './http.js';

/**
 * The HTTP plumbing every REST integration needs and none should rewrite:
 * building a URL under a base that may carry a context path, turning a failed
 * response into a ToilError with the server's own message, retrying a 429 as
 * long as the server asks for a reasonable wait, following redirects only on
 * the host the credential belongs to, and saying plainly when the host could
 * not be reached at all. Areas supply the headers and the fix for a rejected
 * credential (usually through their request hook, `src/core/api.ts`); this
 * supplies the rest.
 *
 * A request that fails three times is not escalated to a steering committee.
 * It is returned, with the reason, to the person who made it.
 */

export type QueryValue = string | number | boolean | undefined;
/** A query value; an array repeats the key once per element (`?state=a&state=b`). */
export type QueryParam = QueryValue | readonly QueryValue[];

/**
 * `path` under `base`, keeping any path `base` already has: a Jira at
 * `https://jira.imagile.dev/jira` keeps its `/jira`. Commas in the query stay
 * literal, because several REST APIs read `expand=a,b` and nothing else.
 */
/**
 * Refuses a request path with a `.` or `..` segment, in any spelling the
 * URL parser collapses (`%2e`, `.%2E`). An id of `..` dropped into
 * `items/${id}/delete` would otherwise send the request, and its
 * credential, to `delete` on another endpoint of the same host, and a write
 * would land somewhere nobody asked for. A dot inside a segment (`v1.2`,
 * `.hidden`) is untouched. Checked before anything is sent.
 */
export function assertNoDotSegments(raw: string): void {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\\]*/i.exec(raw);
  const rest = authority ? raw.slice(authority[0].length) : raw;
  const path = rest.split(/[?#]/, 1)[0]!;
  for (const segment of path.split(/[/\\]/)) {
    const plain = segment.replace(/%2e/gi, '.');
    if (plain === '.' || plain === '..') {
      throw new ToilError('INVALID_INPUT', `A request path can't have "${segment}" as a segment: ${redactUrl(raw)} would reach a different endpoint than the one named.`, {
        fix: `Check the id, key or name passed to the command; "${segment}" isn't one.`,
        details: { segment },
      });
    }
  }
}

export function buildUrl(base: string, path: string, params?: Record<string, QueryParam>): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, root);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value as readonly QueryValue[]) if (item !== undefined) url.searchParams.append(key, String(item));
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  if (url.search) url.search = url.search.replace(/%2C/gi, ',');
  return url.toString();
}

/** A server asking for a longer wait than this is answered with an error, not a hang. */
export const MAX_RETRY_AFTER_SECONDS = 30;
const ATTEMPTS = 3;
/** Same-origin redirects followed before giving up (the next one is refused); a loop is not a workflow. */
export const MAX_REDIRECTS = 5;

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

/** How much of a plain-text error body a message carries. A stack trace pasted into a ticket is still a stack trace. */
export const MAX_TEXT_REASON = 500;

/**
 * A plain-text error body (LogScale's query syntax errors), trimmed, on one
 * line, capped at {@link MAX_TEXT_REASON} characters, with any URL in it
 * redacted as `--verbose` redacts one. Undefined for an empty body, or one
 * that's JSON or HTML: JSON goes through {@link errorMessageFrom}, and HTML is
 * a sign-in or proxy page with nothing to say about the request.
 */
export function textReasonFrom(body: string): string | undefined {
  const text = body.trim().replace(/\s+/g, ' ');
  if (text === '' || text.startsWith('<') || text.startsWith('{') || text.startsWith('[')) return undefined;
  const redacted = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
  return redacted.length > MAX_TEXT_REASON ? `${redacted.slice(0, MAX_TEXT_REASON)}…` : redacted;
}

export interface RestContext {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

/** How to read a body: parsed JSON (the default), text, one JSON value per line, or raw bytes. */
export type BodyFormat = 'json' | 'text' | 'ndjson' | 'bytes';

export interface RestOptions {
  /** The service's name in messages: "Jira". */
  service: string;
  /** What to do when the server rejects the credential (401/403). */
  authFix: string;
  /** How to read the body. Defaults to JSON. */
  as?: BodyFormat;
  /**
   * Non-OK statuses this call treats as an answer rather than a failure: their
   * body is read like a success's and returned with the status (a cluster
   * health endpoint that reports `red` with a 503).
   */
  accept?: readonly number[];
  /** Give up on this one request after this long, as TIMEOUT. The command's own limit still applies. */
  timeoutMs?: number;
  /** Cross-origin redirects: refused unless this is `'follow-without-auth'`. */
  redirect?: RedirectPolicy;
  /**
   * The connection's `baseUrl` setting, so a network error names it only when
   * the failing host is its host; `null` when the connection has none (a host
   * from another setting, such as Dynatrace's `platformUrl`). Left out, as by a
   * caller with no connection, the error names `baseUrl` as it always did.
   */
  baseUrl?: string | null;
  /**
   * `false` hands a 429 back at once, as any other error status (or as an
   * answer, with `accept`), instead of waiting and retrying. For an area
   * whose service already queues, or whose predecessor reported a 429
   * straight away.
   */
  retryRateLimit?: false;
}

/**
 * What to do with a redirect to another origin: refuse it (the default), or,
 * for a GET or HEAD, follow it with every header dropped.
 */
export type RedirectPolicy = 'same-origin' | 'follow-without-auth';

/** A response as the caller sees it: the status, every header, and the body read as asked. */
export interface RestResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  /** The URL that answered, after any same-origin redirects. */
  url: string;
}

/**
 * Sends one request (retrying a 429, unless `retryRateLimit` is false) and returns the parsed body: JSON, or
 * undefined for an empty or 204 response, or text, NDJSON or bytes as asked.
 */
export async function restRequest<T>(ctx: RestContext, url: string, init: RequestInit, options: RestOptions): Promise<T> {
  return (await restResponse<T>(ctx, url, init, options)).data;
}

/** restRequest, but with the status and response headers too (a continuation token, a `Location`). */
export async function restResponse<T>(ctx: RestContext, url: string, init: RequestInit, options: RestOptions): Promise<RestResponse<T>> {
  assertNoDotSegments(url);
  for (let attempt = 1; ; attempt++) {
    const timeout = options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined;
    const signals = [init.signal, timeout].filter((s): s is AbortSignal => s !== undefined && s !== null);
    const attemptInit: RequestInit = signals.length > 0 ? { ...init, signal: AbortSignal.any(signals) } : init;
    try {
      const { response, finalUrl } = await follow(ctx, url, attemptInit, options);
      if (response.status === 429 && options.retryRateLimit !== false) {
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
      if (!response.ok && !options.accept?.includes(response.status)) throw await failed(response, finalUrl, options);
      const data = await readBody<T>(response, finalUrl, options);
      return { status: response.status, headers: response.headers, data, url: finalUrl };
    } catch (err) {
      if (err instanceof ToilError) throw err;
      // An abort is execute()'s to report (TIMEOUT or CANCELLED); anything else is the network.
      if (ctx.signal.aborted) throw err;
      if (timeout?.aborted) {
        // As with execute()'s own limit: giving up can't recall a write the server already has.
        const write = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
        throw new ToilError('TIMEOUT', `${options.service} didn't answer ${redactUrl(url)} within ${(options.timeoutMs as number) / 1000}s; toil stopped waiting.${write ? ' The change may already have been applied.' : ''}`, {
          fix: `${write ? 'Check whether the change was made before retrying. ' : ''}Try again later, or narrow the request. Check ${options.service} itself if it keeps happening.`,
          details: { url: redactUrl(url), timeoutMs: options.timeoutMs },
        });
      }
      throw unreachable(url, err, options.service, options.baseUrl);
    }
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Sends the request with redirects handled here rather than by fetch. Node's
 * fetch drops `Authorization` on a cross-origin redirect but forwards every
 * other header, so an `API-Key` or `X-Figma-Token` would follow a redirect to
 * any host that asked. toil follows a redirect only within the origin it was
 * sent to, and refuses the rest with the host named, whatever the header is,
 * unless the call opts into following it with no headers at all.
 */
async function follow(ctx: RestContext, url: string, init: RequestInit, options: RestOptions): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };
  for (let hop = 0; ; hop++) {
    const response = await ctx.fetch(current, currentInit);
    const location = response.headers.get('location');
    if (!REDIRECTS.has(response.status) || !location) return { response, finalUrl: current };
    await response.body?.cancel().catch(() => {});
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new ToilError('HTTP', `${options.service} redirected ${redactUrl(current)} to a location toil can't read.`, {
        fix: 'Check baseUrl points at the service itself.',
        details: { status: response.status, url: redactUrl(current) },
      });
    }
    const from = new URL(current).origin;
    const method = (currentInit.method ?? 'GET').toUpperCase();
    if (next.origin !== from && options.redirect === 'follow-without-auth' && (method === 'GET' || method === 'HEAD')) {
      // A signed download URL carries its own authority. Ours stays behind:
      // every header goes, Accept excepted, so a custom auth header can't
      // ride along whatever it's called.
      const accept = new Headers(currentInit.headers).get('accept');
      currentInit = { ...currentInit, headers: accept ? { accept } : {} };
    } else if (next.origin !== from) {
      throw new ToilError('HTTP', `${options.service} redirected ${redactUrl(current)} to ${next.origin}, a different host. toil doesn't follow it, so the credential stays with ${from}.`, {
        fix: `If ${next.origin} is where ${options.service} really is, set the connection's baseUrl to it.`,
        details: { status: response.status, url: redactUrl(current), location: redactUrl(next.toString()) },
      });
    }
    if (hop >= MAX_REDIRECTS) {
      throw new ToilError('HTTP', `${options.service} redirected ${redactUrl(url)} more than ${MAX_REDIRECTS} times.`, {
        fix: 'Check baseUrl points at the service itself, not a sign-in page in front of it.',
        details: { status: response.status, url: redactUrl(url) },
      });
    }
    // The fetch standard's rule: 303, or 301/302 after a POST, becomes a GET without a body.
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      const headers = new Headers(currentInit.headers);
      headers.delete('content-type');
      headers.delete('content-length');
      currentInit = { ...currentInit, method: method === 'HEAD' ? 'HEAD' : 'GET', headers };
      delete currentInit.body;
    }
    current = next.toString();
  }
}

async function readBody<T>(response: Response, url: string, options: RestOptions): Promise<T> {
  const as = options.as ?? 'json';
  if (as === 'bytes') return new Uint8Array(await response.arrayBuffer()) as T;
  if (as === 'text') return (await response.text()) as T;
  if (response.status === 204) return (as === 'ndjson' ? [] : undefined) as T;
  const text = await response.text();
  if (as === 'ndjson') {
    const values: unknown[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        throw notJson(response, url, options);
      }
    }
    return values as T;
  }
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw notJson(response, url, options);
  }
}

/** Usually a sign-in or proxy page served with a 200 in place of the API. */
function notJson(response: Response, url: string, options: RestOptions): ToilError {
  return new ToilError('HTTP', `${options.service} answered ${redactUrl(url)} with something that isn't JSON.`, {
    fix: 'Check baseUrl points at the service itself, not a login page or proxy in front of it.',
    details: { status: response.status, url: redactUrl(url), contentType: response.headers.get('content-type') },
  });
}

async function failed(response: Response, url: string, options: RestOptions): Promise<ToilError> {
  const body = await response.text().catch(() => '');
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const text = textReasonFrom(body);
  const reason = errorMessageFrom(body) ?? (text === undefined ? status : `${status}: ${text}`);
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

/** Whether `origin` is the `baseUrl` setting's host; true when that setting isn't known, as before. */
function isBaseUrlHost(origin: string, baseUrl: string | null | undefined): boolean {
  if (baseUrl === undefined) return true;
  if (baseUrl === null) return false;
  try {
    return new URL(baseUrl).origin === origin;
  } catch {
    return false;
  }
}

function unreachable(url: string, err: unknown, service: string, baseUrl?: string | null): ToilError {
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
      : `Check ${isBaseUrlHost(origin, baseUrl) ? 'baseUrl' : "the connection's URL settings"}, and that this machine can reach ${origin} (VPN, proxy, DNS). toil uses HTTPS_PROXY, HTTP_PROXY and NO_PROXY when they're set.`,
    details: { url: redactUrl(url), cause: code ?? reason },
  });
}

export interface RepointOptions {
  /** The service's name in messages: "Jira". */
  service: string;
  /** What the URL is for, as a noun: "attachment". */
  subject: string;
  /** The warning code when the URL is re-pointed: `JIRA_ATTACHMENT_HOST`. */
  code: string;
  /** What to do when the URL can't be read at all. */
  fix: string;
}

/**
 * A URL the server handed back (a download link, a `resultsUrl`), aimed at the
 * configured origin. Servers build these from their own idea of where they
 * live, which may be an internal name or a proxy the user never configured;
 * following it would send the credential there. A different origin keeps its
 * path and query and is re-pointed at `base`, with a warning that says so.
 */
export function repointUrl(raw: string, base: string, warn: (warning: { code: string; message: string }) => void, options: RepointOptions): string {
  const configured = new URL(base);
  let target: URL;
  try {
    target = new URL(raw, configured);
  } catch {
    const article = /^[aeiou]/i.test(options.subject) ? 'an' : 'a';
    throw new ToilError('HTTP', `${options.service} returned ${article} ${options.subject} URL toil can't read: ${raw}.`, { fix: options.fix });
  }
  if (target.origin === configured.origin) return target.toString();
  warn({
    code: options.code,
    message: `${options.service} named ${target.origin} for this ${options.subject}; toil fetched it from the configured ${configured.origin} instead.`,
  });
  return new URL(`${target.pathname}${target.search}`, configured.origin).toString();
}

/** Waits `ms`, or rejects with the signal's reason the moment it aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
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
