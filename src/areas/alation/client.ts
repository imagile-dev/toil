import { z } from 'zod';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { QueryValue } from '../../core/rest.js';
import { alationArea, type AlationConnection } from './area.js';

/**
 * Every request toil sends to Alation, as the command contract sent
 * it: JSON Accept and Content-Type on every call (GETs included), a 30 s
 * timeout, unset parameters left out, and the access token in a `TOKEN`
 * header added by the area's request hook. Input checks keep the documented wording,
 * since a rejection slip is only useful if it says which box was wrong.
 */

export type AlationContext = CommandContext<AlationConnection>;
export type Params = Record<string, QueryValue>;

/** Alation's paginated list endpoints share limit/skip and cap at 1000 per page. */
export const MAX_PAGE = 1000;
/** The contract's per-request timeout. */
const TIMEOUT_MS = 30_000;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

export function alation<T>(ctx: AlationContext, path: string, opts: { params?: Params; method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  return apiRequest<T>(alationArea, ctx, path, {
    method: opts.method ?? 'GET',
    headers: JSON_HEADERS,
    timeoutMs: TIMEOUT_MS,
    ...(opts.params ? { query: opts.params } : {}),
    ...(opts.body !== undefined ? { json: opts.body } : {}),
  });
}

/** A number typed as text on the CLI, or as a number over MCP; read as text either way. */
export const intText = z.union([z.number(), z.string()]);
type IntText = z.output<typeof intText>;

/** Set and not empty: the contract tested its string options for truthiness. */
export const given = (value: IntText | undefined): value is IntText => value !== undefined && value !== '';

const invalid = (message: string) => new ToilError('INVALID_INPUT', message, { fix: 'Pass a whole number, e.g. 42.' });

export function parseIntOption(value: IntText | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) throw invalid(`Invalid ${flag} "${value}". Expected a non-negative integer.`);
  return Number(trimmed);
}

export function parsePositiveId(value: IntText, what: string): number {
  const trimmed = String(value).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) throw invalid(`Invalid ${what} "${value}". Expected a positive integer ID.`);
  return Number(trimmed);
}

/** --limit (default 100, 1 to 1000) and --skip (default 0). One page per call; nothing loops. */
export function pageParams(input: { limit?: IntText | undefined; skip?: IntText | undefined }): { limit: number; skip: number } {
  const limit = parseIntOption(input.limit ?? '100', '--limit') ?? 100;
  const skip = parseIntOption(input.skip ?? '0', '--skip') ?? 0;
  if (limit < 1 || limit > MAX_PAGE) {
    throw new ToilError('INVALID_INPUT', `--limit must be between 1 and ${MAX_PAGE} (Alation's per-request cap).`, { fix: 'Pass --limit 1 to 1000, and page on with --skip.' });
  }
  return { limit, skip };
}

/**
 * A `get` reads the list endpoint filtered by `id`, one row. Suspected bug
 * (#77 item 4): when no row has that id it returns the first row anyway, so a
 * server that ignores the filter answers with a different object. The data
 * stays as it was; a warning says so.
 */
export async function getOne<T extends { id: unknown }>(ctx: AlationContext, path: string, id: number, what: string): Promise<T> {
  const rows = await alation<T[]>(ctx, path, { params: { id, limit: 1 } });
  const match = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
  const row = match ?? (Array.isArray(rows) ? rows[0] : undefined);
  if (!row) throw new ToilError('NOT_FOUND', `${what} ${id} not found`, { fix: `Check the ${what.toLowerCase()} ID exists in Alation and is visible to you.` });
  if (!match) ctx.warn({ code: 'ALATION_ID_MISMATCH', message: `Alation returned no ${what.toLowerCase()} with ID ${id}; data is the first row it returned instead (ID ${JSON.stringify(row.id)}).` });
  return row;
}
