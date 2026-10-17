import type { Page } from './envelope.js';
import { ToilError } from './errors.js';

/**
 * One paging loop for every REST convention toil's areas meet, so no area
 * writes its own and none forgets the cap. A style says how a page is asked
 * for and how the next one is found:
 *
 * - `offset`: start/limit (`startAt`/`maxResults`), stopping on an empty page
 *   or when `total` is reached
 * - `page`: page/per_page, stopping on a short page, so `pageSize` must not
 *   exceed the server's own maximum (GitHub's is 100) or page 1 looks like the last.
 *   With `total` (SonarQube's `p`/`ps`/`total`), it stops instead once the items
 *   read reach the total, or on an empty page, and never on a short one
 * - `nextPageStart`: `isLastPage` and `nextPageStart` in the body
 * - `header`: a continuation token in a response header, sent back as a query
 *   parameter (`x-ms-continuationtoken`)
 * - `nextPageKey`: a token in the body; later requests send only the token
 *
 * With a cap, the loop stops once it has that many items and `meta.page`
 * reports where it stopped, as a cursor the caller can pass back. It's never
 * empty: null means the last page was read, anything else resumes exactly.
 * Each page is requested only when the previous one says there is more, which
 * is the procedure; skipping ahead to the last page is a privilege of auditors.
 * A style with `total` also reports the last total the server gave, an empty
 * page's included, so a command asked only to count still has the count.
 */

/** What one request yields: the parsed body and the response headers. */
export interface FetchedPage {
  body: unknown;
  headers?: Headers;
}

type Items<T> = (body: unknown) => T[];

export type PageStyle<T> =
  | { kind: 'offset'; startParam: string; limitParam: string; pageSize: number; items: Items<T>; total?: (body: unknown) => number | undefined; first?: number }
  | { kind: 'page'; pageParam: string; sizeParam: string; pageSize: number; items: Items<T>; total?: (body: unknown) => number | undefined; first?: number }
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
  /** What is being listed, for messages: "Jira sprints for board 7". */
  what?: string;
}

/**
 * Pages read before giving up. A server that ignores the start parameter
 * would otherwise hand back page one forever, and offsets never repeat.
 */
export const MAX_PAGES = 1000;

export interface Paged<T> {
  items: T[];
  /** Where the next page starts, or null when the last page was read. */
  nextCursor: string | null;
  /** The total the last page read reported, for a style with `total`; absent when no page gave one. */
  total?: number;
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
  // Offsets resume exactly as a plain number. Page numbers and tokens can only
  // name a whole page, so their cursor also says how many of its items were
  // already returned.
  const exact = style.kind === 'offset' || style.kind === 'nextPageStart';
  let cursor: string | undefined = initial(style);
  let skip = 0;
  // Items the server has handed over before the current page, counting from
  // its first item: what a `page` style with `total` compares. Its cursor
  // carries the count, because with a total a page needn't be full to have a
  // next one, so the page number alone can't say how many came before.
  let counted = 0;
  if (options.cursor !== undefined) {
    if (exact) {
      if (!/^\d+$/.test(options.cursor)) throw badCursor(options.cursor);
      cursor = options.cursor;
    } else {
      const decoded = decodeCursor(options.cursor);
      if (style.kind === 'page' && decoded.c !== null && !/^\d+$/.test(decoded.c)) throw badCursor(options.cursor);
      cursor = decoded.c ?? cursor;
      skip = decoded.s;
      counted = decoded.n ?? 0;
    }
  }
  let nextCursor: string | null = null;
  const seen = new Set<string>();
  let total: number | undefined;
  const counts = style.kind === 'page';

  for (let pages = 1; ; pages++) {
    if (pages > MAX_PAGES) {
      throw new ToilError('HTTP', `Paging ${options.what ?? 'the results'} didn't end after ${MAX_PAGES} pages; toil stopped.`, {
        fix: 'Narrow the request, or set a smaller limit. The server may be ignoring the paging parameters.',
        details: { pages: MAX_PAGES, items: items.length },
      });
    }
    const page = await fetchPage(params(style, cursor));
    const all = (style.items ?? values<T>)(page.body);
    const before = counted;
    counted += all.length;
    const reported = (style.kind === 'offset' || style.kind === 'page') && style.total ? style.total(page.body) : undefined;
    if (typeof reported === 'number') total = reported;
    const next = advance(style, cursor, all, page, counted, reported);
    const skipped = skip;
    skip = 0;
    const got = all.slice(skipped);

    if (cap !== undefined && items.length + got.length >= cap) {
      const take = cap - items.length;
      items.push(...got.slice(0, take));
      if (take < got.length) nextCursor = exact ? String(Number(cursor) + take) : encodeCursor(cursor ?? null, skipped + take, counts ? before : undefined);
      else nextCursor = next === null ? null : exact ? next : encodeCursor(next, 0, counts ? counted : undefined);
      break;
    }
    items.push(...got);
    // A server that hands back the cursor it was given would page forever.
    if (next === null || (cursor !== undefined && next === cursor) || seen.has(next)) break;
    if (cursor !== undefined) seen.add(cursor);
    cursor = next;
  }

  if (cap !== undefined) options.setPage?.({ nextCursor, limit: cap });
  return { items, nextCursor, ...(total === undefined ? {} : { total }) };
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

/** `total` is what this page reported, read before the empty-page check so an empty page's total still counts. */
function advance<T>(style: PageStyle<T>, cursor: string | undefined, got: T[], page: FetchedPage, counted: number, total: number | undefined): string | null {
  switch (style.kind) {
    case 'offset': {
      if (got.length === 0) return null;
      const next = Number(cursor) + got.length;
      return style.total && typeof total === 'number' && next >= total ? null : String(next);
    }
    case 'page':
      if (got.length === 0) return null;
      if (style.total) return typeof total === 'number' && counted >= total ? null : String(Number(cursor) + 1);
      return got.length < style.pageSize ? null : String(Number(cursor) + 1);
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
 * A page cursor: the page number or token (null for the first page), items of
 * it already returned, and for a page number, the items the server handed over
 * before that page (`n`).
 */
function encodeCursor(c: string | null, s: number, n?: number): string {
  return Buffer.from(JSON.stringify(n === undefined ? { c, s } : { c, s, n })).toString('base64url');
}

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function decodeCursor(raw: string): { c: string | null; s: number; n?: number } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { c?: unknown; s?: unknown; n?: unknown };
    if ((parsed.c === null || typeof parsed.c === 'string') && count(parsed.s) && (parsed.n === undefined || count(parsed.n))) {
      return { c: parsed.c, s: parsed.s, ...(parsed.n === undefined ? {} : { n: parsed.n }) };
    }
  } catch {
    // fall through to the error
  }
  throw badCursor(raw);
}

function badCursor(raw: string): ToilError {
  return new ToilError('INVALID_INPUT', `"${raw}" isn't a cursor this command hands out.`, {
    fix: 'Pass meta.page.nextCursor from the previous page unchanged, or leave the cursor out to start at the beginning.',
  });
}
