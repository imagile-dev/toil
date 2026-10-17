import { createHash } from 'node:crypto';
import { ToilError } from './errors.js';
import { redactUrl } from './http.js';
import { restRequest, type RestContext } from './rest.js';

/**
 * Exchanging a long-lived credential for a short-lived token over plain HTTP
 * (the Authentication Bar's second shape: a refresh token or API key the
 * user generated once, POSTed to an endpoint that hands back an access token).
 * The exchange goes through `ctx.fetch`, so it shows in --verbose and is
 * cancelled with the command. Tokens are kept in memory, per connection, for
 * the life of the process, and never written anywhere: under `toil mcp` one
 * exchange serves every call until the token is near expiry.
 *
 * The token is renewed before it expires, not after the server says so. The
 * renewal form is submitted early, as the guidance has always recommended and
 * almost nobody does.
 */

export interface TokenExchange {
  /** The exchange endpoint. Named in the error when the exchange fails. */
  url: string;
  /** Method, headers and body carrying the long-lived credential. */
  init: RequestInit;
  /**
   * The long-lived credential itself. Only its hash is kept, as part of the
   * cache key, so a changed credential never reuses a token minted from the
   * old one.
   */
  credential: string;
  /** Reads the access token and its lifetime from the endpoint's JSON answer. */
  read(body: unknown): { token: string | undefined; expiresInSeconds?: number | undefined };
  /** Used when the answer gives no lifetime. Default five minutes. */
  defaultLifetimeSeconds?: number;
  /** The service's name in messages. Defaults to the area's name. */
  service?: string;
  /** What to do when the endpoint refuses the credential. */
  authFix?: string;
}

/** The parts of a command's context an exchange uses. */
export interface ExchangeContext extends RestContext {
  /** The area and connection the token belongs to: one cache entry each. */
  scope: string;
  service: string;
  /** What to do when the endpoint refuses the credential. */
  authFix: string;
}

interface Entry {
  token: Promise<string>;
  /** When to stop handing this token out and fetch a new one (ms since the epoch). */
  refreshAt: number;
}

const cache = new Map<string, Entry>();

/** Renew this long before expiry, or at nine tenths of a short lifetime. */
const EARLY_MS = 60_000;
const DEFAULT_LIFETIME_SECONDS = 300;

/** A cache key per connection, endpoint and credential. The credential is hashed, never kept. */
export function tokenKey(scope: string, exchange: Pick<TokenExchange, 'url' | 'credential'>): string {
  const digest = createHash('sha256').update(exchange.url).update('\0').update(exchange.credential).digest('hex');
  return `${scope}\0${digest}`;
}

/**
 * A current access token for this connection: the cached one while it's
 * fresh, otherwise a new exchange. Concurrent callers share one exchange.
 */
export async function exchangeToken(ctx: ExchangeContext, exchange: TokenExchange): Promise<string> {
  const key = tokenKey(ctx.scope, exchange);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.refreshAt) {
    try {
      return await cached.token;
    } catch (err) {
      // The exchange this call joined belonged to another call, which was
      // cancelled. That's its abort, not this call's: exchange again.
      if (err instanceof ToilError || ctx.signal.aborted) throw err;
      if (cache.get(key) === cached) cache.delete(key);
      return exchangeToken(ctx, exchange);
    }
  }

  const entry: Entry = { token: Promise.resolve(''), refreshAt: Number.POSITIVE_INFINITY };
  entry.token = (async () => {
    const answer = await post(ctx, exchange);
    const read = exchange.read(answer);
    if (typeof read.token !== 'string' || read.token === '') {
      throw new ToilError('AUTH', `${ctx.service} token exchange at ${redactUrl(exchange.url)} answered without an access token.`, {
        fix: ctx.authFix,
        details: { url: redactUrl(exchange.url) },
      });
    }
    const lifetimeMs = Math.max(0, (read.expiresInSeconds ?? exchange.defaultLifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS) * 1000);
    entry.refreshAt = Date.now() + lifetimeMs - Math.min(EARLY_MS, lifetimeMs / 10);
    return read.token;
  })();
  cache.set(key, entry);
  try {
    return await entry.token;
  } catch (err) {
    if (cache.get(key) === entry) cache.delete(key);
    throw err;
  }
}

/** Forget a token, so the next request exchanges again: after the API rejected it early. */
export function forgetToken(key: string): void {
  cache.delete(key);
}

/** Empties the cache. For tests. */
export function clearTokenCache(): void {
  cache.clear();
}

async function post(ctx: ExchangeContext, exchange: TokenExchange): Promise<unknown> {
  try {
    return await restRequest<unknown>(ctx, exchange.url, exchange.init, { service: ctx.service, authFix: ctx.authFix });
  } catch (err) {
    if (!(err instanceof ToilError)) throw err;
    const status = (err.details as { status?: unknown } | undefined)?.status;
    // Unreachable, redirected away or timed out: the error already names the URL.
    if (typeof status !== 'number') throw err;
    // 400 is how OAuth-style endpoints say "invalid_grant": the credential, not the request.
    const rejected = status === 400 || status === 401 || status === 403;
    const reason = /^HTTP \d/.test(err.message) ? '' : `: ${err.message}`;
    throw new ToilError(rejected ? 'AUTH' : 'HTTP', `${ctx.service} token exchange at ${redactUrl(exchange.url)} failed with HTTP ${status}${reason}`, {
      fix: rejected ? ctx.authFix : (err.fix ?? `Try again; if it keeps failing, check ${ctx.service} itself.`),
      details: { status, url: redactUrl(exchange.url) },
    });
  }
}
