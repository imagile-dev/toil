import { z } from 'zod';
import { confluenceArea } from './area.js';
import * as client from './client.js';

/** Spaces: list them, or read one with its plain-text description. A space is a filing cabinet with a key. */

export const listSpaces = confluenceArea.command({
  path: ['confluence', 'list-spaces'],
  description: 'List Confluence spaces',
  input: z.object({
    type: z.string().optional().describe('Space type: global or personal'),
    limit: z.union([z.number(), z.string()]).optional().describe('Max total spaces to return (default: all)'),
  }),
  writes: false,
  options: [
    { flags: '--type <type>', field: 'type', description: 'Space type: global or personal' },
    { flags: '--limit <n>', field: 'limit', description: 'Max total spaces to return (default: all)' },
  ],
  examples: [{}, { type: 'global', limit: '10' }],
  run: async (input, ctx) => {
    // Read only when set; parseInt leaves "abc" as NaN (#78 item 9).
    const max = input.limit === undefined || input.limit === '' ? undefined : parseInt(String(input.limit), 10);
    return client.warnBadLimit(ctx, input.limit, max, await client.listSpaces(ctx, { type: input.type, max }));
  },
});

export const getSpace = confluenceArea.command({
  path: ['confluence', 'get-space'],
  description: 'Get a Confluence space by key',
  input: z.object({ key: z.string().describe('Space key') }),
  writes: false,
  options: [{ flags: '--key <space-key>', field: 'key', description: 'Space key' }],
  examples: [{ key: 'DOCS' }],
  run: (input, ctx) => client.getSpace(ctx, input.key),
});

export const spaceCommands = [listSpaces, getSpace];
