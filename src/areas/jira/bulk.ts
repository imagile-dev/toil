import { oneOrMany } from '../../core/schema.js';
import { ToilError } from '../../core/errors.js';
import type { Warning } from '../../core/envelope.js';

/**
 * `issue get A B`, shared by both Jira deployments: what the
 * keys may be, how many, and how a key that couldn't be read is reported. A
 * bulk read answers for every key it was given. One that failed is listed
 * under `errors` with why, never left out, and a warning says how many; the
 * missing-persons report is filed with the results, not instead of them.
 */

/** Keys per call. Jira Cloud's bulk fetch takes at most 100 when every field is asked for, and Data Center gets the same ceiling. */
export const MAX_BULK_KEYS = 100;

/** Requests in flight at once on Data Center, which has no bulk endpoint. */
export const BULK_CONCURRENCY = 5;

export const keyOrKeys = oneOrMany(`Issue key, e.g. PROJ-123, or a list of up to ${MAX_BULK_KEYS} keys to get { issues, errors } instead of one issue`);

export interface BulkError {
  key: string;
  code: string;
  message: string;
}

export interface BulkResult<T> {
  issues: T[];
  errors: BulkError[];
}

/** The keys to read, in the order given, each once; INVALID_INPUT for an empty list, an empty key or too many. */
export function bulkKeys(keys: string[]): string[] {
  const unique = [...new Set(keys)];
  if (unique.length === 0 || unique.some((k) => k.trim() === '')) {
    throw new ToilError('INVALID_INPUT', 'Every <key> needs an issue key.', { fix: 'Give each <key> as an issue key, e.g. PROJ-123.' });
  }
  if (unique.length > MAX_BULK_KEYS) {
    throw new ToilError('INVALID_INPUT', `${unique.length} issue keys is more than the ${MAX_BULK_KEYS} one call reads.`, {
      fix: `Split the keys into calls of up to ${MAX_BULK_KEYS}, or search for them with JQL (key in (...)).`,
    });
  }
  return unique;
}

/**
 * A failure that belongs to one key (the issue isn't there, or Jira refused
 * that one) becomes its entry in `errors`. Anything else, such as a rejected
 * token, a network failure or a time limit, is about the whole call and fails it.
 */
export function perKeyError(key: string, err: unknown): BulkError {
  if (err instanceof ToilError && (err.code === 'NOT_FOUND' || err.code === 'HTTP')) return { key, code: err.code, message: err.message };
  throw err;
}

/** The warning a bulk read with failures carries, so a caller reading only `issues` still hears about them. */
export function bulkWarning(code: string, errors: BulkError[], asked: number): Warning | undefined {
  if (errors.length === 0) return undefined;
  return { code, message: `${errors.length} of ${asked} issues couldn't be read: ${errors.map((e) => e.key).join(', ')}. Each is in data.errors with the reason.` };
}
