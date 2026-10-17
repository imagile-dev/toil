import { z } from 'zod';
import { paginate } from '../../core/paginate.js';
import { splitioArea } from './area.js';
import { split, type SplitioContext } from './client.js';

/**
 * `workspaces list`: every workspace (Split now calls them projects), read
 * 100 at a time until the server's totalCount is reached. Knowing which
 * workspaces exist is, as ever, the first step of any request.
 */

/** GET /workspaces?offset&limit, answered with { objects, offset, limit, totalCount }. https://docs.split.io/reference/get-workspaces */
const PAGE_SIZE = 100;

const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});

export const workspacesListCommand = splitioArea.command({
  path: ['splitio', 'workspaces', 'list'],
  description: 'List all Split.IO workspaces',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const { items } = await paginate<unknown>(
      {
        kind: 'offset',
        startParam: 'offset',
        limitParam: 'limit',
        pageSize: PAGE_SIZE,
        items: (body) => (Array.isArray(obj(body).objects) ? (obj(body).objects as unknown[]) : []),
        total: (body) => (typeof obj(body).totalCount === 'number' ? (obj(body).totalCount as number) : undefined),
      },
      async (params) => ({ body: await split<unknown>(ctx as SplitioContext, '/workspaces', { query: params }) }),
      { what: 'Split workspaces' },
    );
    return { count: items.length, workspaces: items };
  },
});

export const workspacesCommands = [workspacesListCommand];
