/**
 * The address bar's query, which is where a view keeps what a person chose: the
 * filters, the split, the unit, the item whose drawer is open. Toil UI routes by
 * hash, so the query sits after the path inside the hash (`#/project/x/charts/mix?release=2.4`).
 * These helpers read and rebuild it without losing what they weren't asked about:
 * opening a drawer used to keep only the path, which threw away every filter the
 * moment someone looked at an item. `item` is always written last, so a link
 * that ends `item=<id>` still means "this drawer over that view", and an empty
 * query leaves no stray `?`. The address bar is the only filing cabinet
 * that every colleague can already open.
 */

/** A hash split into its path and its query. */
export function splitHash(hash: string): { path: string; query: URLSearchParams } {
  const at = hash.indexOf('?');
  return { path: (at < 0 ? hash : hash.slice(0, at)) || '#/', query: new URLSearchParams(at < 0 ? '' : hash.slice(at + 1)) };
}

/** A path and a query as one hash; `item` goes last and an empty query has no `?`. */
export function joinHash(path: string, query: URLSearchParams): string {
  const rest = new URLSearchParams();
  for (const [k, v] of query) if (k !== 'item') rest.append(k, v);
  const item = query.get('item');
  if (item !== null) rest.set('item', item);
  const text = rest.toString();
  return text ? `${path}?${text}` : path;
}

/** The hash with its query changed by `edit`; everything `edit` leaves alone stays as it was. */
export function withQuery(hash: string, edit: (query: URLSearchParams) => void): string {
  const { path, query } = splitHash(hash);
  edit(query);
  return joinHash(path, query);
}

/** The current address's query, or an empty one where there is no window (a test rendering a view on its own). */
export const currentQuery = (): URLSearchParams => splitHash((globalThis as { location?: { hash: string } }).location?.hash ?? '#/').query;
