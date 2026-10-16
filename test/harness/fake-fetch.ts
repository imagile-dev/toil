/**
 * A fetch that never touches the network. Each test declares the routes it
 * expects; a request with no matching route throws, so a test can't pass by
 * accident against a real server. Every request is recorded so tests can assert
 * exactly what toil sent: method, URL, headers and body.
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

export interface Route {
  method?: string;
  /** Exact URL, or a pattern matched against the full URL. */
  url: string | RegExp;
  respond: CannedResponse | ((request: RecordedRequest) => CannedResponse);
}

export interface FakeFetch {
  fetch: typeof globalThis.fetch;
  calls: RecordedRequest[];
}

export function fakeFetch(routes: Route[] = []): FakeFetch {
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

    const route = routes.find(
      (r) =>
        (r.method ?? 'GET').toUpperCase() === recorded.method &&
        (typeof r.url === 'string' ? r.url === recorded.url : r.url.test(recorded.url)),
    );
    if (!route) {
      throw new Error(`fakeFetch: no route for ${recorded.method} ${recorded.url}. Add one to the test; tests never reach the network.`);
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
