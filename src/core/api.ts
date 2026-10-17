import type { AnyArea, Connection } from './area.js';
import type { CommandContext } from './context.js';
import { ToilError } from './errors.js';
import { redactUrl } from './http.js';
import { multipart, type MultipartPart } from './multipart.js';
import { buildUrl, restResponse, type BodyFormat, type QueryParam, type RestResponse } from './rest.js';
import { exchangeToken, forgetToken, tokenKey, type TokenExchange } from './token.js';

/**
 * The one way an HTTP area talks to its service. The area declares, once, how
 * a resolved connection becomes a base URL and auth headers
 * (`defineArea({ request })`); every command sends through `apiRequest`,
 * which builds the request from that and nothing else. No command assembles
 * its own credentials, and none can point them at a host other than the
 * connection's: a URL outside its origin is refused before anything is sent.
 *
 * Credentials are issued to a host, not to whoever asks for them next. This
 * is the one access policy toil enforces in code instead of in a training
 * module.
 */

/** What an area's request hook returns for one connection. */
export interface AreaEndpoint {
  /** The service root; request paths resolve under it, keeping any context path. */
  baseUrl: string;
  /** Auth headers, sent on every request to `baseUrl` and to nothing else. */
  headers?: Record<string, string>;
  /** The service's name in messages ("Jira"). Defaults to the area's name. */
  service?: string;
  /** What to do when the service rejects the credential (401/403). */
  authFix?: string;
}

/** What core hands a request hook. */
export interface RequestTools {
  /**
   * A short-lived token for this connection, exchanged from a long-lived
   * credential over plain HTTP and cached in memory until shortly before it
   * expires. A failed exchange is an AUTH error naming the endpoint.
   */
  exchange(exchange: TokenExchange): Promise<string>;
}

export type RequestHook<C> = (connection: Connection<C>, tools: RequestTools) => AreaEndpoint | Promise<AreaEndpoint>;

export interface ApiRequest {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Query parameters; an array value repeats the key. */
  query?: Record<string, QueryParam>;
  /** Headers for this call, on top of the hook's. */
  headers?: Record<string, string>;
  /** A JSON body. Sets `Content-Type: application/json` unless `headers` names one. */
  json?: unknown;
  /** A raw body (an upload), sent as given with `contentType`. */
  body?: string | Uint8Array;
  contentType?: string;
  /** A multipart/form-data body. */
  multipart?: readonly MultipartPart[];
  /** How to read the answer. Defaults to JSON. */
  as?: BodyFormat;
  /** Non-OK statuses to return as an answer rather than fail on. */
  accept?: readonly number[];
  /** Per-request timeout; the command's own time limit still applies. */
  timeoutMs?: number;
}

/** The parts of a command's context a request needs. */
export type ApiContext = Pick<CommandContext<Connection>, 'fetch' | 'signal' | 'connection'>;

/** Sends one request through the area's hook and returns the body. */
export async function apiRequest<T>(area: AnyArea, ctx: ApiContext, path: string, req: ApiRequest = {}): Promise<T> {
  return (await send<T>(area, ctx, path, req)).response.data;
}

/** apiRequest, with the status and response headers (a continuation token, `X-AUSERNAME`, `Location`). */
export async function apiResponse<T>(area: AnyArea, ctx: ApiContext, path: string, req: ApiRequest = {}): Promise<RestResponse<T>> {
  return (await send<T>(area, ctx, path, req)).response;
}

export interface GraphqlOperation {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/**
 * A GraphQL call: POSTs the operation and returns `data`. GraphQL servers
 * report most failures with a 200, so `errors` in the answer, or a null
 * `data`, is a failure here, with the server's messages.
 */
export async function apiGraphql<T>(area: AnyArea, ctx: ApiContext, path: string, operation: GraphqlOperation, req: Pick<ApiRequest, 'headers' | 'query' | 'timeoutMs'> = {}): Promise<T> {
  const { response, service } = await send<unknown>(area, ctx, path, { ...req, method: 'POST', json: operation });
  return graphqlData<T>(response.data, service, response.url);
}

/** `data` from a GraphQL answer, or a ToilError when it carries `errors` or no data. */
export function graphqlData<T>(body: unknown, service: string, url: string): T {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as { data?: unknown; errors?: unknown };
  const errors = Array.isArray(answer.errors) ? answer.errors : [];
  if (errors.length > 0) {
    const messages = errors.map((e) => (typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : JSON.stringify(e)));
    throw new ToilError('HTTP', `${service} GraphQL error: ${messages.join('; ')}`, {
      fix: `See ${service}'s message above; fix the query or its variables and try again.`,
      details: { url: redactUrl(url), errors },
    });
  }
  if (answer.data === null || answer.data === undefined) {
    throw new ToilError('HTTP', `${service} answered the GraphQL query at ${redactUrl(url)} with no data.`, {
      fix: `Check the query, and that the credential can see what it asks for in ${service}.`,
      details: { url: redactUrl(url) },
    });
  }
  return answer.data as T;
}

async function send<T>(area: AnyArea, ctx: ApiContext, path: string, req: ApiRequest): Promise<{ response: RestResponse<T>; service: string }> {
  if (!area.request) throw new Error(`Area ${area.name} has no request hook; declare defineArea({ request }) to use apiRequest.`);
  const { body, contentType } = encode(req);
  for (let attempt = 1; ; attempt++) {
    const exchanged: string[] = [];
    const scope = `${area.name}/${ctx.connection.name}`;
    const fallbackFix = `Check the credential on connection "${ctx.connection.name}".`;
    const tools: RequestTools = {
      exchange: (exchange) => {
        exchanged.push(tokenKey(scope, exchange));
        const named = { service: exchange.service ?? area.name, authFix: exchange.authFix ?? fallbackFix };
        return exchangeToken({ fetch: ctx.fetch, signal: ctx.signal, scope, ...named }, exchange);
      },
    };
    const endpoint = await area.request(ctx.connection, tools);
    const service = endpoint.service ?? area.name;
    const authFix = endpoint.authFix ?? fallbackFix;

    // A full URL (one the server handed back, after repointUrl) is sent as it is:
    // buildUrl would rewrite an encoded comma in its query.
    const url = /^[a-z][a-z0-9+.-]*:/i.test(path) && req.query === undefined ? new URL(path).toString() : buildUrl(endpoint.baseUrl, path, req.query);
    const origin = new URL(endpoint.baseUrl).origin;
    if (new URL(url).origin !== origin) {
      throw new ToilError('HTTP', `toil won't send connection "${ctx.connection.name}"'s credentials to ${new URL(url).origin}; its host is ${origin}.`, {
        fix: `Use a path under ${origin}. A URL the server handed back can be re-pointed at it with repointUrl.`,
        details: { url: redactUrl(url) },
      });
    }
    const headers = new Headers(endpoint.headers);
    for (const [name, value] of Object.entries(req.headers ?? {})) headers.set(name, value);
    // A multipart body's type carries its boundary, so it always wins; any other can be overridden.
    if (contentType && (req.multipart !== undefined || !headers.has('content-type'))) headers.set('content-type', contentType);
    const init: RequestInit = { method: req.method ?? 'GET', headers };
    if (body !== undefined) init.body = body;

    try {
      const options = { service, authFix, ...(req.as ? { as: req.as } : {}), ...(req.accept ? { accept: req.accept } : {}), ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}) };
      return { response: await restResponse<T>(ctx, url, init, options), service };
    } catch (err) {
      // A token revoked before its stated expiry: exchange once more, then believe the server.
      const status = err instanceof ToilError ? (err.details as { status?: unknown } | undefined)?.status : undefined;
      if (attempt === 1 && status === 401 && exchanged.length > 0) {
        for (const key of exchanged) forgetToken(key);
        continue;
      }
      throw err;
    }
  }
}

function encode(req: ApiRequest): { body?: string | Uint8Array; contentType?: string } {
  const given = [req.json !== undefined, req.body !== undefined, req.multipart !== undefined].filter(Boolean).length;
  if (given > 1) throw new Error('apiRequest takes one of json, body or multipart.');
  if (req.json !== undefined) return { body: JSON.stringify(req.json), contentType: 'application/json' };
  if (req.multipart !== undefined) return multipart(req.multipart);
  if (req.body !== undefined) return { body: req.body, ...(req.contentType ? { contentType: req.contentType } : {}) };
  return {};
}
