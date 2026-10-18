import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import { paginate } from '../../core/paginate.js';
import type { QueryValue } from '../../core/rest.js';
import { sonarArea } from './area.js';

/**
 * Every request toil sends to SonarQube Server, kept exactly as the canonical
 * implementation sent them: the same endpoints, the same parameter names (the
 * project key is `componentKeys`, `component` or `projectKey` depending on
 * which endpoint you ask), unset parameters left out, and commas left literal.
 * Three names for one key is not an inconsistency; it is three departments.
 */

export type SonarConnection = Connection<z.output<typeof sonarArea.connection>>;
export type SonarContext = CommandContext<SonarConnection>;

const API = '/api';
/** Page size for --all, as the contract specifies. */
const ALL_PAGE_SIZE = 500;
/** The per-request timeout the contract specifies. */
const TIMEOUT_MS = 30_000;

/** What every call sends besides the hook's token, sent exactly as the contract specifies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export function sonar<T>(ctx: SonarContext, path: string, params?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(sonarArea, ctx, `${API}${path}`, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(params ? { query: params } : {}) });
}

/**
 * Every item from a `p`/`ps` endpoint, 500 at a time, stopping once the items
 * collected reach `total` or a page comes back empty, as the contract specifies.
 * It never stops on a short page, which is core's `page` style with `total`.
 * Suspected bug (#92 item 1): a refused page fails the whole call, and the
 * pages already fetched are discarded.
 */
export async function sonarAll<T>(path: string, ctx: SonarContext, params: Record<string, QueryValue>, read: (body: unknown) => { total: number | undefined; items: T[] }, what: string): Promise<T[]> {
  const { items } = await paginate<T>(
    { kind: 'page', pageParam: 'p', sizeParam: 'ps', pageSize: ALL_PAGE_SIZE, items: (body) => read(body).items, total: (body) => read(body).total },
    async (paging) => ({ body: await sonar<unknown>(ctx, path, { ...params, ...paging }) }),
    { what },
  );
  return items;
}

const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
/** `>=` against the total as JavaScript coerces it, as the contract specifies: null stops after a page, a numeric string counts. */
const num = (value: unknown): number | undefined => (value === undefined ? undefined : Number(value));

/** `issues/search` reports `total` at the top level. */
export const issuesPage = <T>(body: unknown) => ({ total: num(obj(body).total), items: list<T>(obj(body).issues) });
/** `projects/search` reports it under `paging`. */
export const projectsPage = <T>(body: unknown) => ({ total: num(obj(obj(body).paging).total), items: list<T>(obj(body).components) });
/** So does `hotspots/search`. */
export const hotspotsPage = <T>(body: unknown) => ({ total: num(obj(obj(body).paging).total), items: list<T>(obj(body).hotspots) });
