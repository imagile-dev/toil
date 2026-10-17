import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { splitioArea } from './area.js';
import { seg, split, workspaceOf } from './client.js';

/**
 * `environments list`: the environments of one workspace. Split answers this
 * one with a bare array, unlike its paged siblings; consistency was not in
 * the requirements document.
 */

export const environmentsListCommand = splitioArea.command({
  path: ['splitio', 'environments', 'list'],
  description: 'List environments in a workspace',
  input: z.object({}),
  writes: false,
  context: { workspace: 'required' },
  // An input with no fields of its own types its examples as empty, context inputs and all (a kit gap), hence the cast.
  examples: [{ workspace: 'ws-abc12345' } as unknown as Record<string, never>],
  run: async (_input, ctx) => {
    // GET /environments/ws/{workspace}, a bare JSON array. https://docs.split.io/reference/get-environments
    const body = await split<unknown>(ctx, `/environments/ws/${seg(workspaceOf(ctx))}`);
    if (!Array.isArray(body)) {
      throw new ToilError('HTTP', 'Split answered the environments list with something other than a JSON array.', {
        fix: 'Check that baseUrl is the Admin API root (https://api.split.io), then run with --verbose to see the request.',
      });
    }
    return { count: body.length, environments: body };
  },
});

export const environmentsCommands = [environmentsListCommand];
