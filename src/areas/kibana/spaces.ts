import { z } from 'zod';
import { kibanaArea } from './area.js';
import { kibana } from './client.js';

/**
 * The spaces the API key can see, from GET /api/spaces/space. Never
 * space-prefixed: asking which rooms exist is done from the lobby.
 * https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-spaces-space
 */

interface Space {
  id: string;
  name: string;
  description?: string;
  disabledFeatures?: string[];
}

export const spacesListCommand = kibanaArea.command({
  path: ['kibana', 'spaces', 'list'],
  description: 'List the spaces the API key can see',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const data = await kibana<Space[]>(ctx, '/api/spaces/space');
    const spaces = data.map((s) => ({ id: s.id, name: s.name, description: s.description, disabledFeatures: s.disabledFeatures ?? [] }));
    return { count: spaces.length, spaces };
  },
});

export const spacesCommands = [spacesListCommand];
