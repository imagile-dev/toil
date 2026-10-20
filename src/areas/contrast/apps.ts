import { z } from 'zod';
import { contrastArea } from './area.js';
import { contrast, intText, limitOffset } from './client.js';

/**
 * `app list`: one page of the organization's applications, the server's body
 * as it came. The caller pages by hand with --limit and --offset, as is
 * customary for anything involving an inventory.
 */

export const appsListCommand = contrastArea.command({
  path: ['contrast', 'app', 'list'],
  description: 'List applications in the organization',
  input: z.object({
    limit: intText.optional().describe('Maximum number of results (default: "25")'),
    offset: intText.optional().describe('Pagination offset (default: "0")'),
  }),
  writes: false,
  options: [
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of results (default: "25")' },
    { flags: '--offset <n>', field: 'offset', description: 'Pagination offset (default: "0")' },
  ],
  examples: [{}, { limit: '10', offset: '20' }],
  run: async (input, ctx) => contrast<unknown>(ctx, '/applications', limitOffset(input.limit, input.offset)),
});

export const appsCommands = [appsListCommand];
