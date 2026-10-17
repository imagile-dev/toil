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

/** What to do about it: upgrade, or point at a server that is new enough. */
export function tooOldFix(s: SupportedVersion): string {
  if (s.minimum === null) return `Check the ${s.product} version and report it with the command you ran.`;
  return `Upgrade the server to ${s.product} ${s.minimum} or later, or use a connection to one that is.`;
}

/**
 * The error for "this server is too old for toil". The message says so in
 * those words and names the minimum, then adds what the server said
 * (`detail`) and its version when known (`found`). The code stays whatever
 * the failure was (`HTTP` by default, `NOT_FOUND` for an endpoint the old
 * server lacks), so callers branching on codes see nothing new.
 */
export function serverTooOld(
  s: SupportedVersion,
  options: { detail?: string; found?: string; code?: ErrorCode; details?: unknown } = {},
): ToilError {
  const head =
    s.minimum === null
      ? `This server may be too old for toil; the oldest ${s.product} version toil supports hasn't been established.`
      : `This server is too old for toil, which needs ${supportedText(s)}.`;
  const found = options.found ? ` It reports ${options.found}.` : '';
  const detail = options.detail ? ` The server said: ${options.detail}` : '';
  return new ToilError(options.code ?? 'HTTP', `${head}${found}${detail}`, { fix: tooOldFix(s), details: options.details });
}
