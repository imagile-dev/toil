import { z } from 'zod';
import type { Page } from '../../core/envelope.js';
import { paginate, type FetchedPage } from '../../core/paginate.js';

/**
 * The reporting work item revisions feed, which Azure DevOps Services and Server
 * both serve at `{org-or-collection}/{project}/_apis/wit/reporting/workitemrevisions`
 * (https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/reporting-work-item-revisions).
 * It is one batch-paged list of every revision of every work item in the
 * project, which a sync reads from a watermark instead of asking for each
 * item's history on its own. Both deployments page it the same way, so the
 * shape and the paging are said once here; each deployment's client only sends
 * the request. The feed is built for a data warehouse, which presumes
 * a warehouse team and the change ticket that fed it; a sync with neither reads it directly.
 */

export interface FeedRevision {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
}

export const REVISIONS_DESCRIPTION =
  'The project\'s change feed: every work item\'s revisions since a date, as one list (work-item history is the revisions of one item). Lists the revisions of every work item in the project: { id, rev, fields } for each, with every reportable field (or only those in fields) as it stood after that change. updatedSince starts the feed at an ISO 8601 date or zoned date-time, so a sync reads only what changed; without it the feed starts at the beginning of the project. People are text ("Name <email>"). The revisions of one work item are in order, but not next to each other. Long text fields (the description) are not in it. With limit, returns at most that many; pass meta.page.nextCursor as cursor for the next page.';

export const FEED_SINCE = 'Only revisions from this ISO 8601 date (2026-10-01) or zoned date-time (2026-10-01T09:00:00Z)';
export const FEED_FIELDS = 'Comma-separated field reference names to return (default: every reportable field)';

export const revisionsInput = {
  updatedSince: z.string().min(1).optional().describe(FEED_SINCE),
  fields: z.string().min(1).optional().describe(FEED_FIELDS),
};

/** The field names as the `fields` query parameter takes them: trimmed, with no empty entries. */
export const fieldList = (fields: string | undefined): string | undefined => {
  const list = fields?.split(',').map((f) => f.trim()).filter(Boolean);
  return list?.length ? list.join(',') : undefined;
};

const batch = (body: unknown) => (body ?? {}) as { values?: FeedRevision[]; continuationToken?: string | null; isLastBatch?: boolean };

/**
 * Every revision of the feed, one batch after another. A batch names the next
 * with `continuationToken` and says `isLastBatch` when there is none; the token
 * is still sent on the last batch, as a watermark to poll from, so it is not
 * followed then. `startDateTime` is refused beside a token, so it rides on the
 * first request only, and `base` (api-version, fields) on every one.
 */
export async function feedPages(
  send: (query: Record<string, string>) => Promise<FetchedPage>,
  base: Record<string, string>,
  startDateTime: string | undefined,
  what: string,
  page: { cap?: number | undefined; cursor?: string | undefined },
  setPage: (page: Page) => void,
): Promise<FeedRevision[]> {
  const { items } = await paginate<FeedRevision>(
    {
      kind: 'nextPageKey',
      param: 'continuationToken',
      items: (body) => batch(body).values ?? [],
      key: (body) => {
        const b = batch(body);
        return b.isLastBatch === true || !b.continuationToken ? undefined : b.continuationToken;
      },
      params: startDateTime === undefined ? {} : { startDateTime },
    },
    (params) => send({ ...base, ...(params as Record<string, string>) }),
    { what, ...(page.cap !== undefined ? { cap: page.cap, setPage } : {}), ...(page.cursor !== undefined ? { cursor: page.cursor } : {}) },
  );
  return items;
}
