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

/**
 * Query parameter names that carry a credential, compared lowercased with
 * `-`, `_` and `.` removed, so `api_key`, `apiKey` and `X-Amz-Signature` all
 * match. Exact names only: `projectKey`, `componentKeys` and `metricKeys` are
 * identifiers, and hiding them would hide what the request was about.
 */
const SECRET_PARAMS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'apitoken', 'privatetoken', 'sessiontoken', 'xauthtoken',
  'apikey', 'key', 'accesskey', 'privatekey', 'password', 'passwd', 'pwd', 'secret', 'clientsecret',
  'signature', 'sig', 'jwt', 'xamzsignature', 'xamzsecuritytoken', 'xamzcredential', 'xgoogsignature', 'xgoogcredential',
]);

function isSecretParam(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // A malformed escape is compared as written.
  }
  return SECRET_PARAMS.has(decoded.toLowerCase().replace(/[-_.]/g, ''));
}

/**
 * A URL safe to print: credential query parameters and userinfo are replaced,
 * and everything else is shown exactly as it was sent, literal commas and all.
 * Re-serialising through URLSearchParams would print `%2C` for a comma the
 * server never saw encoded, which is accurate the way a photocopy of a fax is.
 */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const hashAt = raw.indexOf('#');
  const hash = hashAt === -1 ? '' : raw.slice(hashAt);
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  let base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  if (url.username || url.password) base = base.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1[redacted]@');
  if (queryAt === -1) return base + hash;
  const query = beforeHash
    .slice(queryAt + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const name = eq === -1 ? part : part.slice(0, eq);
      return isSecretParam(name) ? `${name}=[redacted]` : part;
    })
    .join('&');
  return `${base}?${query}${hash}`;
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
