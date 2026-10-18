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
 * Which query parameters carry a credential. It fails closed: being wrong
 * toward redaction hides one identifier, while the other way prints a token.
 * Names are compared lowercased, and with `-`, `_` and `.` removed:
 *
 * - any name containing token, secret, passw, pwd, signature or credential
 *   (`sonar.token`, `os_password`, `personalAccessToken`, `X-Amz-Credential`)
 * - exactly sig, jwt, key or code
 * - any name ending in key (`api-key`, `subscription-key`, `x-api-key`),
 *   except a clear identifier: key right after project, component, metric,
 *   issue, rule, branch, repo, space, board, sprint, file or entity
 *   (`projectKey`, `issueKey`). Names ending in keys (`componentKeys`,
 *   `metricKeys`) and `projectKeyOrId` don't end in key, so they show.
 *
 * Every other parameter is somebody's business, but not a secret.
 */
const SECRET_PART = /token|secret|passw|pwd|signature|credential/;
const SECRET_EXACT = new Set(['sig', 'jwt', 'key', 'code']);
const IDENTIFIER_KEY = /(project|component|metric|issue|rule|branch|repo|space|board|sprint|file|entity)key$/;

export function isSecretParam(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // A malformed escape is compared as written.
  }
  const n = decoded.toLowerCase().replace(/[-_.\s]/g, '');
  if (SECRET_PART.test(n) || SECRET_EXACT.has(n)) return true;
  return n.endsWith('key') && !IDENTIFIER_KEY.test(n);
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
