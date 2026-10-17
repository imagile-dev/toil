/**
 * The fetch a command actually gets. It wraps the context's fetch so that
 * every front door records requests the same way and honours --dry-run the
 * same way, without any command having to know either exists.
 */

/** What --verbose reports for each request: never a header, never a body. */
export interface RequestLog {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
}

/** What --dry-run reports for the write it didn't send. Credentials are redacted. */
export interface PlannedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Thrown inside a command to stop it at the first write under --dry-run. */
export class DryRunHalt extends Error {
  constructor(readonly planned: PlannedRequest) {
    super('dry run: write not sent');
    this.name = 'DryRunHalt';
  }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|api[-_]?key|secret|password/i;
const SECRET_PARAM = /token|key|secret|password|signature|sig$/i;

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

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers.entries()) out[name] = SECRET_HEADER.test(name) ? '[redacted]' : value;
  return out;
}

/**
 * Wraps `fetch`. Every request is appended to `log`. Under `dryRun`, reads are
 * sent (a command often needs them to build its write) and the first write is
 * captured and thrown as DryRunHalt instead of being sent.
 *
 * Getting a write approved normally takes a ticket and a meeting. Getting one
 * previewed should take a flag.
 */
export function instrumentFetch(base: typeof globalThis.fetch, log: RequestLog[], dryRun: boolean): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const method = request.method.toUpperCase();

    if (dryRun && !READ_METHODS.has(method)) {
      throw new DryRunHalt({
        method,
        url: redactUrl(request.url),
        headers: redactHeaders(request.headers),
        body: request.body ? await request.text() : undefined,
      });
    }

    const started = performance.now();
    const entry: RequestLog = { method, url: redactUrl(request.url), status: null, durationMs: 0 };
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
