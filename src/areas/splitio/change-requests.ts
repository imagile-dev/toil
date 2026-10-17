import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { splitioArea } from './area.js';
import { intText, parseIntText, seg, split, workspaceOf } from './client.js';

/**
 * Tracking change requests: list a workspace's, or read one by ID. Split
 * pages this list with markers rather than offsets, so the next page is
 * reached by handing back the marker it gave, much as a ticket is reached by
 * quoting the ticket before it.
 */

interface CrList {
  data?: unknown[];
  nextMarker?: string | null;
  previousMarker?: string | null;
}

export const changeRequestsListCommand = splitioArea.command({
  path: ['splitio', 'change-requests', 'list'],
  description: 'List Change Requests for a workspace',
  input: z.object({
    environment: z.string().optional().describe('Filter by environment ID'),
    status: z.string().optional().describe('Filter by status (REQUESTED, SCHEDULE_REQUESTED, APPROVED, REJECTED, WITHDRAWN, PUBLISHED); Split returns REQUESTED when unset'),
    limit: intText.optional().describe('Maximum number of results, 1 to 100 (default: "25")'),
    offset: intText.optional().describe('Only 0: Split pages this list by marker, so use --after (default: "0")'),
    after: z.string().optional().describe('The nextMarker from a previous page, to read the page after it'),
  }),
  writes: false,
  context: { workspace: 'required' },
  options: [
    { flags: '--environment <id>', field: 'environment', description: 'Filter by environment ID' },
    { flags: '--status <status>', field: 'status', description: 'Filter by status (REQUESTED, SCHEDULE_REQUESTED, APPROVED, REJECTED, WITHDRAWN, PUBLISHED); Split returns REQUESTED when unset' },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of results, 1 to 100 (default: "25")' },
    { flags: '--offset <n>', field: 'offset', description: 'Only 0: Split pages this list by marker, so use --after (default: "0")' },
    { flags: '--after <marker>', field: 'after', description: 'The nextMarker from a previous page, to read the page after it' },
  ],
  examples: [
    { workspace: 'ws-abc12345' },
    { workspace: 'ws-abc12345', environment: 'env-abc12345', status: 'APPROVED', limit: '10', offset: '0', after: 'marker-abc12345' },
  ],
  run: async (input, ctx) => {
    const offset = parseIntText(input.offset, '0');
    if (offset !== 0) {
      throw new ToilError('INVALID_INPUT', `Split pages change requests by marker, not offset, so --offset ${String(input.offset)} can't be honoured.`, {
        fix: 'Leave out --offset, and pass the nextMarker from the previous page as --after.',
      });
    }
    const limit = parseIntText(input.limit, '25');
    // GET /changeRequests?workspaceId&environmentId&status&limit&after, answered with { data, nextMarker, previousMarker }.
    // https://docs.split.io/reference/list-change-requests
    const body = await split<CrList>(ctx, '/changeRequests', {
      query: {
        workspaceId: workspaceOf(ctx),
        ...(input.environment ? { environmentId: input.environment } : {}),
        ...(input.status ? { status: input.status } : {}),
        limit,
        ...(input.after ? { after: input.after } : {}),
      },
    });
    const changeRequests = body.data ?? [];
    const nextMarker = body.nextMarker ?? null;
    ctx.setPage({ nextCursor: nextMarker, limit });
    // Split reports no total for this list, so totalCount is null rather than a guess.
    return { count: changeRequests.length, totalCount: null, changeRequests, nextMarker, previousMarker: body.previousMarker ?? null };
  },
});

export const changeRequestsGetCommand = splitioArea.command({
  path: ['splitio', 'change-requests', 'get'],
  description: 'Get a Change Request by ID',
  input: z.object({
    id: z.string().describe('Change Request ID'),
  }),
  writes: false,
  options: [{ flags: '--id <id>', field: 'id', description: 'Change Request ID' }],
  examples: [{ id: 'cr-abc12345' }],
  // GET /changeRequests/{id}; no workspace in the path. https://docs.split.io/reference/get-change-request
  run: async (input, ctx) => split<unknown>(ctx, `/changeRequests/${seg(input.id)}`),
});

export const changeRequestsCommands = [changeRequestsListCommand, changeRequestsGetCommand];
