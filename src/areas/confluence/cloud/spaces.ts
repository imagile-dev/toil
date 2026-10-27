import { z } from 'zod';
import { confluenceArea } from '../area.js';
import * as client from './client.js';
import { needLimitForCursor } from './pages.js';

/** Spaces: list them, or read one by key with its plain-text description. A space is a filing cabinet with a key and, on Cloud, a serial number. */

export const listSpaces = confluenceArea.command({
  path: ['confluence', 'space', 'list'],
  description: 'List Confluence Cloud spaces',
  toolDescription: 'Lists the Confluence Cloud spaces this account can see (id, key, name, type, status). With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    type: z.string().min(1).optional().describe('Space type, e.g. global or personal'),
    limit: z.number().int().positive().optional().describe('Max total spaces to return (default: all)'),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to carry on from there (with limit)'),
  }),
  writes: false,
  options: [
    { flags: '--type <type>', field: 'type', description: 'Space type, e.g. global or personal' },
    { flags: '--limit <n>', field: 'limit', description: 'Max total spaces to return (default: all)' },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page (with --limit)' },
  ],
  examples: [{}, { type: 'global', limit: 1 }, { type: 'global', limit: 1, cursor: 'eyJjIjoicGFnZS0xIiwicyI6MH0' }],
  run: async (input, ctx) => {
    needLimitForCursor(input);
    return (await client.listSpaces(ctx, { type: input.type, cap: input.limit, cursor: input.cursor })).items;
  },
});

export const getSpace = confluenceArea.command({
  path: ['confluence', 'space', 'get'],
  description: 'Get a Confluence Cloud space by key',
  input: z.object({ key: z.string().min(1).describe('Space key') }),
  writes: false,
  args: [{ name: 'key', field: 'key', description: 'Space key' }],
  examples: [{ key: 'DOCS' }],
  run: (input, ctx) => client.getSpace(ctx, input.key),
});

export const spaceCommands = [listSpaces, getSpace];
