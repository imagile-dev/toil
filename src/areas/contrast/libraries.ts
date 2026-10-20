import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { paginate } from '../../core/paginate.js';
import { contrastArea } from './area.js';
import { contrast, intText, limitOffset } from './client.js';
import { apiPath } from '../../core/api-path.js';

/**
 * An application's libraries, as on its Libraries tab: one page of them, or
 * the one with a given hash, found by reading the list 25 at a time. There is
 * no lookup by hash, so the search is conducted the way records retention
 * conducts all searches: from the front.
 */

/** Batch size for `library get`, as the contract specifies. */
const BATCH = 25;

type Library = Record<string, unknown>;

export const librariesListCommand = contrastArea.command({
  path: ['contrast', 'app', 'libraries'],
  description: 'List libraries used by an application, as shown on the Libraries tab',
  input: z.object({
    app: z.string().describe('Application ID (UUID)'),
    limit: intText.optional().describe('Maximum number of results (default: "25")'),
    offset: intText.optional().describe('Pagination offset (default: "0")'),
  }),
  writes: false,
  args: [{ name: 'app', field: 'app', description: 'Application ID (UUID)' }],
  options: [
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of results (default: "25")' },
    { flags: '--offset <n>', field: 'offset', description: 'Pagination offset (default: "0")' },
  ],
  examples: [
    { app: 'abc12345-0000-0000-0000-000000000000' },
    { app: 'abc12345-0000-0000-0000-000000000000', limit: '10', offset: '20' },
  ],
  run: async (input, ctx) => contrast<unknown>(ctx, apiPath`/applications/${input.app}/libraries`, limitOffset(input.limit, input.offset)),
});

export const librariesGetCommand = contrastArea.command({
  path: ['contrast', 'library', 'get'],
  description: 'Get details for a specific library used by an application, by hash',
  input: z.object({
    app: z.string().describe('Application ID (UUID)'),
    hash: z.string().describe('Library hash'),
  }),
  writes: false,
  args: [
    { name: 'app', field: 'app', description: 'Application ID (UUID)' },
    { name: 'hash', field: 'hash', description: 'Library hash' },
  ],
  examples: [{ app: 'abc12345-0000-0000-0000-000000000000', hash: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c' }],
  run: async (input, ctx) => {
    let match: Library | undefined;
    // The contract stops on a match or a short page; core's offset style stops on an
    // empty one. So a page that ends the search is handed over empty, and the offset moves
    // on only past a full page with no match. Suspected bug (#87 item 5): with no check that
    // the server honours offset, a missing hash reads up to MAX_PAGES pages before failing.
    await paginate<Library>(
      { kind: 'offset', startParam: 'offset', limitParam: 'limit', pageSize: BATCH, items: (body) => body as Library[] },
      async (page) => {
        const body = await contrast<{ libraries?: Library[] }>(ctx, apiPath`/applications/${input.app}/libraries`, { limit: page.limit, offset: page.offset });
        const items = body.libraries ?? [];
        match = items.find((item) => item.hash === input.hash);
        return { body: match || items.length < BATCH ? [] : items };
      },
      { what: `Contrast libraries for application ${input.app}` },
    );
    if (!match) {
      throw new ToilError('NOT_FOUND', `Library with hash "${input.hash}" not found for application ${input.app}`, {
        fix: `Check the hash with toil contrast app libraries ${input.app}, and that the application ID is right.`,
      });
    }
    return match;
  },
});

export const librariesCommands = [librariesListCommand, librariesGetCommand];
