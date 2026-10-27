import { z } from 'zod';
import type { Page } from '../../core/envelope.js';
import { ToilError } from '../../core/errors.js';

/**
 * `--limit` and `--cursor` on the lists of `jira`, Data Center and Cloud, so every
 * list pages the same way: without a limit, every item; with one, that many,
 * and meta.page.nextCursor says where the next page starts. Pass it back as
 * the cursor, unchanged. The cursor is the startAt Jira itself counts in.
 * One numbering scheme for every list, which is one more than the filing
 * cabinet managed.
 */

/** `--limit` and `--cursor` on a list: unset, every item from the start. */
export interface PageOpts {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export const pagingFields =(what: string) => ({
  limit: z.number().int().positive().optional().describe(`Most ${what} to return; every one when omitted. With a limit, meta.page.nextCursor says where the next page starts`),
  cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to carry on from there'),
});

export const pagingOptions = (what: string) => [
  { flags: '--limit <n>', field: 'limit', description: `Most ${what} to return (default: all)` },
  { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page' },
];

/**
 * One page of a list Jira sent whole (Data Center's changelog), cut the way
 * core's paging cuts a server's pages: a cursor is the index to start at, and
 * with a limit meta.page says where the next page starts, null at the end.
 */
export function pageOf<T>(items: T[], page: PageOpts, setPage: (page: Page) => void): T[] {
  if (page.cursor !== undefined && !/^\d+$/.test(page.cursor)) {
    throw new ToilError('INVALID_INPUT', `"${page.cursor}" isn't a cursor this command hands out.`, {
      fix: 'Pass meta.page.nextCursor from the previous page unchanged, or leave the cursor out to start at the beginning.',
    });
  }
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  if (page.limit === undefined) return items.slice(start);
  const end = start + page.limit;
  setPage({ nextCursor: end < items.length ? String(end) : null, limit: page.limit });
  return items.slice(start, end);
}
