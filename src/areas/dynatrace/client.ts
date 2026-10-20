import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import { apiRequest, type ApiRequest } from '../../core/api.js';
import type { CommandContext } from '../../core/context.js';
import { ToilError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import type { QueryValue } from '../../core/rest.js';
import { dynatraceArea, dynatracePlatform } from './area.js';

/**
 * Every request toil sends to Dynatrace, as the command contract specifies
 * them: the same paths, JSON headers, a 30 s timeout, unset parameters left
 * out, and `nextPageKey` paging that sends the key and nothing else after the
 * first page, because Dynatrace rejects a second copy of the filters. The
 * key stands for the original request; restating it is considered tampering.
 */

export type DynatraceConnection = Connection<z.output<typeof dynatraceArea.connection>>;
export type DynatraceContext = CommandContext<DynatraceConnection>;

/** The per-request timeout the contract specifies. */
const TIMEOUT_MS = 30_000;
/** Page size for every nextPageKey list, as the contract specifies. */
const PAGE_SIZE = 500;

/** What every call sends besides the hook's token, sent exactly as the contract specifies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

type Call = Pick<ApiRequest, 'method' | 'json' | 'timeoutMs'> & { query?: Record<string, QueryValue> };

/** A classic environment API call (Api-Token on baseUrl). */
export function dynatrace<T>(ctx: DynatraceContext, path: string, call: Call = {}): Promise<T> {
  return apiRequest<T>(dynatraceArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...call });
}

/** A platform call (Bearer on platformUrl), for trace get. */
export function dynatracePlatformCall<T>(ctx: DynatraceContext, path: string, call: Call = {}): Promise<T> {
  return apiRequest<T>(dynatracePlatform, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...call });
}

/**
 * Every item of a nextPageKey list. The first request sends `first` plus
 * pageSize=500; each later one sends only nextPageKey, until a page has none.
 * `totalCount` is the number of items collected, not the server's own
 * totalCount, as the contract specifies.
 */
export async function allPages<T>(ctx: DynatraceContext, path: string, key: string, first: Record<string, QueryValue>, what: string): Promise<{ totalCount: number; items: T[] }> {
  const { items } = await paginate<T>(
    {
      kind: 'nextPageKey',
      items: (body) => {
        const list = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
        // The contract spreads the list unchecked, so a page without one fails the call; here it fails more legibly.
        if (!Array.isArray(list)) {
          throw new ToilError('HTTP', `Dynatrace answered ${path} with no ${key} list.`, {
            fix: `Check that baseUrl points at a Dynatrace environment API (it serves ${path}), then try again.`,
          });
        }
        return list as T[];
      },
    },
    async (params) => ({ body: await dynatrace<unknown>(ctx, path, { query: params.nextPageKey !== undefined ? params : { ...first, pageSize: PAGE_SIZE } }) }),
    { what },
  );
  return { totalCount: items.length, items };
}
