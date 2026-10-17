import type { CommandContext } from '../../core/context.js';
import { ToilError } from '../../core/errors.js';
import { restResponse } from '../../core/rest.js';
import { REQUEST_TIMEOUT_MS } from './inventory.js';

/**
 * JSON over POST to a public vulnerability API that the command names in its
 * own name (principle 9): a fixed host, no connection and no credential, so
 * nothing here goes through an area's request hook. Sent with ctx.fetch, so
 * --verbose and cancellation work as they do everywhere else. The host is
 * written down once, here in the code, which is the only approval it needs.
 */

export type PublicContext = Pick<CommandContext<unknown>, 'fetch' | 'signal'>;

export interface PublicPost {
  service: string;
  url: string;
  /** A JSON body, sent as POST; absent, the request is a GET. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Non-OK statuses to hand back rather than fail on. */
  accept?: readonly number[];
  /** Read the body as text, not JSON. */
  text?: boolean;
}

/** The status and parsed body; a failure is core's ToilError, with `details.status`. */
export async function requestJson<T>(ctx: PublicContext, req: PublicPost): Promise<{ status: number; data: T }> {
  const init: RequestInit =
    req.body === undefined
      ? { method: 'GET', ...(req.headers ? { headers: req.headers } : {}), signal: ctx.signal }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', ...req.headers }, body: JSON.stringify(req.body), signal: ctx.signal };
  const response = await restResponse<T>(
    ctx,
    req.url,
    init,
    {
      service: req.service,
      authFix: `${req.service} refused the request. toil sends it no credential; check whether ${new URL(req.url).host} still answers anonymous requests.`,
      timeoutMs: REQUEST_TIMEOUT_MS,
      // The predecessor answered a 429 at once; so does this.
      retryRateLimit: false,
      ...(req.accept ? { accept: req.accept } : {}),
      ...(req.text ? { as: 'text' as const } : {}),
    },
  );
  return { status: response.status, data: response.data };
}

/** The HTTP status a failed request reported, if it got that far. */
export function statusOf(err: unknown): number | undefined {
  const status = err instanceof ToilError ? (err.details as { status?: unknown } | undefined)?.status : undefined;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The reachability check the old command made before every run: the endpoint
 * with an empty batch, where a 2xx or a 400 means it's up. Anything else
 * (a 401 included) is "not reachable", as before. The reason is returned for
 * the error's details.
 */
export async function probe(ctx: PublicContext, req: PublicPost): Promise<{ reachable: true } | { reachable: false; reason: string }> {
  try {
    // Read as text: only the status matters, and a 400's body needn't be JSON.
    await requestJson(ctx, { ...req, accept: [400], text: true });
    return { reachable: true };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    const status = statusOf(err);
    return { reachable: false, reason: status !== undefined ? `HTTP ${status}` : err instanceof Error ? err.message : String(err) };
  }
}
