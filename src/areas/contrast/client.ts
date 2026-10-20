import { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import type { QueryValue } from '../../core/rest.js';
import { contrastArea } from './area.js';
import { apiPath, rawPath } from '../../core/api-path.js';

/**
 * Every request toil sends to Contrast, as the command contract specifies
 * it: under `/Contrast/api/ng/<orgUuid>/`, with each id from the call encoded
 * as one path segment and commas left literal in the query.
 * The org UUID appears in every path, in case anyone forgets whose findings
 * these are.
 */

export type ContrastConnection = Connection<z.output<typeof contrastArea.connection>>;
export type ContrastContext = CommandContext<ContrastConnection>;

/** The per-request timeout the contract specifies. */
const TIMEOUT_MS = 30_000;

/** What every call sends besides the hook's two auth headers, sent exactly as the contract specifies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

/** GETs `/Contrast/api/ng/<orgUuid><path>`; `path` starts with a slash and is built with `apiPath`, so its ids are already encoded. */
export function contrast<T>(ctx: ContrastContext, path: string, params?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(contrastArea, ctx, apiPath`/Contrast/api/ng/${ctx.connection.orgUuid}${rawPath(path)}`, {
    headers: JSON_HEADERS,
    timeoutMs: TIMEOUT_MS,
    ...(params ? { query: params } : {}),
  });
}

/** A number read with parseInt, per the command contract: text stays text until then. */
export const intText = z.union([z.number(), z.string()]);
type IntText = z.output<typeof intText> | undefined;

/**
 * `limit` and `offset` computed exactly as the contract specifies: commander's
 * default, then `parseInt` with no validation, so `abc` is sent as `NaN` and
 * `10x` as 10 (#87 item 4). An empty value falls back to the default.
 */
export function limitOffset(limit: IntText, offset: IntText): { limit: number; offset: number } {
  const read = (value: IntText, fallback: number) => {
    const text = value === undefined ? String(fallback) : String(value);
    return text ? parseInt(text, 10) : fallback;
  };
  return { limit: read(limit, 25), offset: read(offset, 0) };
}
