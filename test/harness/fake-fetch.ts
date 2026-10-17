/**
 * A fetch that never touches the network. Each test declares the routes it
 * expects; a request with no matching route throws, so a test can't pass by
 * accident against a real server. Every request is recorded so tests can assert
 * exactly what toil sent: method, URL, headers and body.
 *
 * Real network access from a test needs a firewall exception, a business
 * justification and a director's signature. Nobody here has filed one.
 */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface CannedResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/** Query parameters a route requires. A repeated key is an array, in the order sent. */
export type RouteQuery = Record<string, string | string[]>;

/**
 * One canned response. Match on `url` (the full URL, exact or a pattern), or
 * on `path` plus `query`, which is easier to read and doesn't care what order
 * the query string was built in.
 */
export type Route = {
  method?: string;
  respond: CannedResponse | ((request: RecordedRequest) => CannedResponse);
} & (
  | {
      /** Exact URL, or a pattern matched against the full URL. */
      url: string | RegExp;
      path?: never;
      query?: never;
      origin?: never;
    }
  | {
      url?: never;
      /** The URL's pathname, exact or a pattern, e.g. `/rest/api/2/search`. */
      path: string | RegExp;
      /**
       * The query the request must carry, compared without regard to order.
       * Omitted, any query matches; `{}` means the request has none.
       */
      query?: RouteQuery;
      /** Only requests to this origin (`https://jira.imagile.dev`). Omitted, any origin. */
      origin?: string;
    }
);

export interface FakeFetch {
  fetch: typeof globalThis.fetch;
  calls: RecordedRequest[];
}

/** A URL's query as a RouteQuery, so two queries compare whatever order they were written in. */
export function queryOf(url: string): RouteQuery {
  const out: RouteQuery = {};
  for (const [key, value] of new URL(url).searchParams) {
    const seen = out[key];
    out[key] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
  }
  return out;
}

const sameQuery = (want: RouteQuery, got: RouteQuery) => {
  const norm = (q: RouteQuery) => JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]));
  return norm(want) === norm(got);
};

function matches(route: Route, method: string, url: string): boolean {
  if ((route.method ?? 'GET').toUpperCase() !== method) return false;
  if (route.url !== undefined) return typeof route.url === 'string' ? route.url === url : route.url.test(url);
  const parsed = new URL(url);
  if (route.origin !== undefined && route.origin !== parsed.origin) return false;
  if (typeof route.path === 'string' ? route.path !== parsed.pathname : !route.path.test(parsed.pathname)) return false;
  return route.query === undefined || sameQuery(route.query, queryOf(url));
}

/** For the no-route error: routes that agree on method and path, so a wrong query is obvious. */
function nearMisses(routes: Route[], method: string, url: string): string {
  const parsed = new URL(url);
  const near = routes.filter(
    (r) =>
      r.path !== undefined &&
      (r.method ?? 'GET').toUpperCase() === method &&
      (typeof r.path === 'string' ? r.path === parsed.pathname : r.path.test(parsed.pathname)),
  );
  if (near.length === 0) return '';
  return ` Routes for that path expect the query ${near.map((r) => JSON.stringify(r.query ?? 'any')).join(' or ')}; the request had ${JSON.stringify(queryOf(url))}.`;
}

export function fakeFetch(routes: Route[] = []): FakeFetch {
  for (const route of routes) {
    if ((route.url === undefined) === (route.path === undefined)) throw new Error('fakeFetch: a route matches on url, or on path (and query), not both or neither.');
  }
  const calls: RecordedRequest[] = [];

  const fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const recorded: RecordedRequest = {
      method: request.method.toUpperCase(),
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.body ? await request.text() : undefined,
    };
    calls.push(recorded);

    const route = routes.find((r) => matches(r, recorded.method, recorded.url));
    if (!route) {
      throw new Error(
        `fakeFetch: no route for ${recorded.method} ${recorded.url}.${nearMisses(routes, recorded.method, recorded.url)} Add one to the test; tests never reach the network.`,
      );
    }

    const canned = typeof route.respond === 'function' ? route.respond(recorded) : route.respond;
    const headers = new Headers(canned.headers);
    let body: string | null = null;
    if (canned.json !== undefined) {
      body = JSON.stringify(canned.json);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else if (canned.text !== undefined) {
      body = canned.text;
    }
    return new Response(body, { status: canned.status ?? 200, headers });
  }) as typeof globalThis.fetch;

  return { fetch, calls };
}

/**
 * The requests a command sent itself: every call, less one per token
 * exchange core made (`watchTokenExchanges` in src/core/token.ts), which the
 * command never asked for. The parity suite holds a read to GET, HEAD and
 * OPTIONS on what's left, so a second POST to the token URL is still the
 * command's, and still fails.
 */
export function withoutExchanges(calls: readonly RecordedRequest[], exchanges: ReadonlyArray<{ method: string; url: string }>): RecordedRequest[] {
  const left = [...calls];
  for (const sent of exchanges) {
    const url = new URL(sent.url).toString();
    const at = left.findIndex((c) => c.method === sent.method && c.url === url);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}
