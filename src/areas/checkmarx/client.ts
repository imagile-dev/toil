import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import type { QueryValue } from '../../core/rest.js';
import { checkmarxArea } from './area.js';

/**
 * Every request toil sends to Checkmarx One, as the canonical implementation
 * sent them: paths relative to `baseUrl` (so it has to end in `/api`), the
 * same JSON headers on every call, a 30 s timeout, and the bare `projects` and
 * `scans` arrays handed back without their counts. The counts are filed
 * separately, in a warning, which is where counts usually end up.
 */

export type CheckmarxConnection = Connection<z.output<typeof checkmarxArea.connection>>;
export type CheckmarxContext = CommandContext<CheckmarxConnection>;

/** The predecessor's per-request timeout. */
const TIMEOUT_MS = 30_000;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

export function checkmarx<T>(ctx: CheckmarxContext, path: string, query?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(checkmarxArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(query ? { query } : {}) });
}

interface ListResponse {
  totalCount?: number;
  filteredTotalCount?: number;
  [list: string]: unknown;
}

/**
 * One page of a list endpoint, never more: the items, or [] for a null list.
 * When the server counts more than it sent, the predecessor wrote a line to
 * stderr; here the same words go in meta.warnings (#89 item 1).
 */
export async function checkmarxList<T>(ctx: CheckmarxContext, path: 'projects' | 'scans', query: Record<string, QueryValue>): Promise<T[]> {
  const res = await checkmarx<ListResponse>(ctx, path, query);
  const items = (res[path] as T[] | null | undefined) ?? [];
  // Compared as JavaScript compares, as the predecessor did: a missing count never warns.
  if ((res.filteredTotalCount as number) > items.length) {
    ctx.warn({ code: 'CHECKMARX_TRUNCATED', message: `${res.filteredTotalCount} ${path} found; only showing first ${items.length}` });
  }
  return items;
}
