import { ToilError, type ErrorCode } from './errors.js';

/**
 * The oldest server or API version an area supports. Each area exports one
 * from its index.ts as `supported`; the site's per-integration data and the
 * area's skill file state the same thing, and a test keeps the three equal.
 *
 * `minimum: null` is a real answer: nobody has established it yet, and saying
 * so beats a guess. Every version is supported until proven otherwise, which
 * is also how the change board treats every risk.
 */
export interface SupportedVersion {
  /** The product as its vendor names it: `Azure DevOps Server`. */
  product: string;
  /** The oldest release that works, `2022.1`, or null when it isn't known. */
  minimum: string | null;
  /** The API version that release speaks, if it has one: `REST API 7.1`. */
  api?: string;
  /** Why that's the floor, or what is known when it isn't. */
  note?: string;
}

/** `Azure DevOps Server 2022.1 or later (REST API 7.1)`. */
export function supportedText(s: SupportedVersion): string {
  if (s.minimum === null) return `The oldest ${s.product} version toil supports hasn't been established`;
  return `${s.product} ${s.minimum} or later${s.api ? ` (${s.api})` : ''}`;
}

/**
 * The fix for an error that means the server is older than toil supports,
 * naming the minimum, and the server's own version when the area knows it.
 */
export function tooOldFix(s: SupportedVersion, found?: string): string {
  const seen = found ? ` This server reports ${found}.` : '';
  if (s.minimum === null) return `This ${s.product} may be older than toil supports.${seen} Check the server's version, and report it with the command you ran.`;
  return `toil needs ${supportedText(s)}.${seen} Upgrade the server, or use a connection to one that is ${s.minimum} or later.`;
}

/**
 * A ToilError for "this server is too old for this request". The code stays
 * whatever the failure was (`HTTP` by default, `NOT_FOUND` for an endpoint
 * the old server lacks), so callers branching on codes see nothing new; only
 * the fix changes, to name the minimum.
 */
export function serverTooOld(s: SupportedVersion, message: string, options: { code?: ErrorCode; found?: string; details?: unknown } = {}): ToilError {
  return new ToilError(options.code ?? 'HTTP', message, { fix: tooOldFix(s, options.found), details: options.details });
}
