/**
 * The fetch a command actually gets. It wraps the context's fetch so that
 * every front door records requests the same way, for --verbose, without any
 * command having to know it exists.
 */

/** What --verbose reports for each request: never a header, never a body. */
export interface RequestLog {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
}

const SECRET_PARAM = /token|key|secret|password|signature|sig$|^jwt$/i;

/** A URL safe to print: query parameters that look like credentials are replaced. */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.set(name, '[redacted]');
  }
  if (url.username || url.password) {
    url.username = '[redacted]';
    url.password = '';
  }
  return url.toString();
}

/**
 * Wraps `fetch` so every request lands in `log`: method, redacted URL,
 * status and timing. The audit trail, kept by the one party that never skips
 * the paperwork.
 */
export function instrumentFetch(base: typeof globalThis.fetch, log: RequestLog[], signal?: AbortSignal): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const original = input instanceof Request ? input : new Request(input, init);
    // Every request is cancelled with the command, whether or not it asked to be.
    const request = signal ? new Request(original, { signal: AbortSignal.any([original.signal, signal]) }) : original;
    const started = performance.now();
    const entry: RequestLog = { method: request.method.toUpperCase(), url: redactUrl(request.url), status: null, durationMs: 0 };
    log.push(entry);
    try {
      const response = await base(request);
      entry.status = response.status;
      return response;
    } finally {
      entry.durationMs = Math.round(performance.now() - started);
    }
  }) as typeof globalThis.fetch;
}
