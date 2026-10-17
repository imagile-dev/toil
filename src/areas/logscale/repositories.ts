import { z } from 'zod';
import { logscaleArea } from './area.js';
import { listRepositories } from './client.js';

/** The repositories the token can see, as LogScale's GraphQL API lists them. Views are filed separately. */

export const repositoriesListCommand = logscaleArea.command({
  path: ['logscale', 'repositories', 'list'],
  description: 'List available repositories',
  toolDescription: 'List the LogScale repositories the token can see, with id, name, description and timeOfLatestIngest for each. Pass a name as repository to logscale_query.',
  input: z.object({}),
  writes: false,
  // GraphQL reads are sent as POST.
  queryByPost: true,
  examples: [{}],
  run: async (_input, ctx) => {
    const repositories = await listRepositories(ctx);
    return { count: repositories.length, repositories };
  },
});

export const repositoriesCommands = [repositoriesListCommand];
