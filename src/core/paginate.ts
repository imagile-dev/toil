import type { Page } from './envelope.js';

/**
 * One paging loop for every REST convention toil's areas meet, so no area
 * writes its own and none forgets the cap. A style says how a page is asked
 * for and how the next one is found:
 *
 * - `offset`: start/limit (`startAt`/`maxResults`), stopping on an empty page
 *   or when `total` is reached
 * - `page`: page/per_page, stopping on a short page
 * - `nextPageStart`: `isLastPage` and `nextPageStart` in the body
 * - `header`: a continuation token in a response header, sent back as a query
 *   parameter (`x-ms-continuationtoken`)
 * - `nextPageKey`: a token in the body; later requests send only the token
 *
 * With a cap, the loop stops once it has that many items and `meta.page`
 * reports where it stopped, as a cursor the caller can pass back. Each page
 * is requested only when the previous one says there is more, which is the
 * procedure; skipping ahead to the last page is a privilege of auditors.
 */

/** What one request yields: the parsed body and the response headers. */
export interface FetchedPage {
  body: unknown;
  headers?: Headers;
}

type Items<T> = (body: unknown) => T[];

export type PageStyle<T> =
  | { kind: 'offset'; startParam: string; limitParam: string; pageSize: number; items: Items<T>; total?: (body: unknown) => number | undefined; first?: number }
  | { kind: 'page'; pageParam: string; sizeParam: string; pageSize: number; items: Items<T>; first?: number }
  | { kind: 'nextPageStart'; startParam: string; limitParam: string; pageSize: number; items?: Items<T> }
  | { kind: 'header'; header: string; param: string; items: Items<T>; params?: Record<string, string | number> }
  | { kind: 'nextPageKey'; param?: string; items: Items<T>; key?: (body: unknown) => string | undefined; params?: Record<string, string | number> };

export interface PaginateOptions {
  /** Stop after this many items and report the cursor in meta.page. Unset fetches every page. */
  cap?: number;
  /** A cursor from a previous meta.page.nextCursor, to carry on from there. */
  cursor?: string;
  /** Sets meta.page; pass the command's `ctx.setPage`. Only called when there is a cap. */
  setPage?: (page: Page) => void;
}

export interface Paged<T> {
  items: T[];
  /** Where the next page starts, or null when the last page was read. */
  nextCursor: string | null;
}

const field = (body: unknown, name: string): unknown => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined);
const values = <T>(body: unknown): T[] => (Array.isArray(field(body, 'values')) ? (field(body, 'values') as T[]) : []);

/**
 * Fetches pages until the style says there are no more or `cap` items are in
 * hand. `fetchPage` gets the paging parameters for one request and puts them
 * where the API wants them (a query string, or a POST body).
 */
export async function paginate<T>(style: PageStyle<T>, fetchPage: (params: Record<string, string | number>) => Promise<FetchedPage>, options: PaginateOptions = {}): Promise<Paged<T>> {
  const { cap } = options;
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) throw new Error(`paginate: cap must be a positive whole number, not ${cap}.`);
  const items: T[] = [];
  let cursor: string | undefined = options.cursor ?? initial(style);
  let nextCursor: string | null = null;
  const seen = new Set<string>();

  for (;;) {
    const page = await fetchPage(params(style, cursor));
    const got = (style.items ?? values<T>)(page.body);
    const next = advance(style, cursor, got, page);

    if (cap !== undefined && items.length + got.length >= cap) {
      const take = cap - items.length;
      items.push(...got.slice(0, take));
      nextCursor = take === got.length ? next : resume(style, cursor, take);
      break;
    }
    items.push(...got);
    // A server that hands back the cursor it was given would page forever.
    if (next === null || (cursor !== undefined && next === cursor) || seen.has(next)) break;
    if (cursor !== undefined) seen.add(cursor);
    cursor = next;
  }

  if (cap !== undefined) options.setPage?.({ nextCursor, limit: cap });
  return { items, nextCursor };
}

function initial<T>(style: PageStyle<T>): string | undefined {
  switch (style.kind) {
    case 'offset':
      return String(style.first ?? 0);
    case 'page':
      return String(style.first ?? 1);
    case 'nextPageStart':
      return '0';
    default:
      return undefined;
  }
}

function params<T>(style: PageStyle<T>, cursor: string | undefined): Record<string, string | number> {
  switch (style.kind) {
    case 'offset':
      return { [style.startParam]: Number(cursor), [style.limitParam]: style.pageSize };
    case 'page':
      return { [style.pageParam]: Number(cursor), [style.sizeParam]: style.pageSize };
    case 'nextPageStart':
      return { [style.startParam]: Number(cursor), [style.limitParam]: style.pageSize };
    case 'header':
      return { ...style.params, ...(cursor ? { [style.param]: cursor } : {}) };
    case 'nextPageKey':
      // The token stands for the whole query: Dynatrace refuses other parameters beside it.
      return cursor ? { [style.param ?? 'nextPageKey']: cursor } : { ...style.params };
  }
}

function advance<T>(style: PageStyle<T>, cursor: string | undefined, got: T[], page: FetchedPage): string | null {
  switch (style.kind) {
    case 'offset': {
      if (got.length === 0) return null;
      const next = Number(cursor) + got.length;
      const total = style.total?.(page.body);
      return typeof total === 'number' && next >= total ? null : String(next);
    }
    case 'page':
      return got.length === 0 || got.length < style.pageSize ? null : String(Number(cursor) + 1);
    case 'nextPageStart': {
      const start = field(page.body, 'nextPageStart');
      return field(page.body, 'isLastPage') === true || typeof start !== 'number' ? null : String(start);
    }
    case 'header': {
      const token = page.headers?.get(style.header);
      return token ? token : null;
    }
    case 'nextPageKey': {
      const key = style.key ? style.key(page.body) : field(page.body, 'nextPageKey');
      return typeof key === 'string' && key !== '' ? key : null;
    }
  }
}

/**
 * The cursor for the rest of a page the cap cut short. Offsets resume exactly;
 * a page number or an opaque token can only name the page itself, so the next
 * call repeats the items of that page already returned. Repeating is better
 * than losing them. The first page of a token style has no token, so its
 * cursor is `""`, which starts again from the beginning.
 */
function resume<T>(style: PageStyle<T>, cursor: string | undefined, take: number): string {
  if (style.kind === 'offset' || style.kind === 'nextPageStart') return String(Number(cursor) + take);
  return cursor ?? '';
}
