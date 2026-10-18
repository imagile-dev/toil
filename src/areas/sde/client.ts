import { apiRequest } from '../../core/api.js';
import type { CommandContext } from '../../core/context.js';
import { paginate } from '../../core/paginate.js';
import type { QueryValue } from '../../core/rest.js';
import { sdeArea, type SdeConnection } from './area.js';

/**
 * Every request toil sends to SD Elements, as the command contract
 * specifies them: GETs under `/api/v2/`, every path ending in a slash, unset
 * parameters left out, commas left literal. The trailing slash is not
 * optional; Django has views on the matter.
 */

export type SdeContext = CommandContext<SdeConnection>;

export const API = '/api/v2';
/** Page size for --all, as the contract specifies. */
const ALL_PAGE_SIZE = 100;
/** The per-request timeout the contract specifies. */
const TIMEOUT_MS = 30_000;

/** What every call sends besides the hook's token, sent exactly as the contract specifies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export function sde<T>(ctx: SdeContext, path: string, params?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(sdeArea, ctx, `${API}${path}`, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(params ? { query: params } : {}) });
}

const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});
/** `>=` against `count` as JavaScript coerces it, as the contract specifies: a missing count never stops the loop, a numeric string does. */
const num = (value: unknown): number | undefined => (value === undefined ? undefined : Number(value));

/**
 * Every item of a Django page-number list: `page=1, 2, …` with `page_size=100`,
 * stopping once the items collected reach `count` or a page comes back empty,
 * as the contract specifies, and never on a short page. `next` is never followed.
 * The result is a bare array of every page's `results`.
 */
export async function sdeAll<T>(ctx: SdeContext, path: string, params: Record<string, QueryValue>, what: string): Promise<T[]> {
  const { items } = await paginate<T>(
    {
      kind: 'page',
      pageParam: 'page',
      sizeParam: 'page_size',
      pageSize: ALL_PAGE_SIZE,
      items: (body) => {
        const results = obj(body).results;
        return Array.isArray(results) ? (results as T[]) : [];
      },
      total: (body) => num(obj(body).count),
    },
    async (paging) => ({ body: await sde<unknown>(ctx, path, { ...params, ...paging }) }),
    { what },
  );
  return items;
}
