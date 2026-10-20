import { z } from 'zod';
import { sonatypeiqArea } from './area.js';
import { iq } from './client.js';

/** Organizations, read from `/api/v2/organizations` and returned as the server sent them. The org chart, at least, is someone else's to maintain. */

export const organizationsListCommand = sonatypeiqArea.command({
  path: ['sonatypeiq', 'organization', 'list'],
  description: 'List all organizations in Sonatype IQ Server',
  toolDescription: 'Every organization in Sonatype IQ Server, as the server returns it: { organizations: [{ id, name, ... }] }. The id is what --organization-id takes.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => iq(ctx, '/api/v2/organizations'),
});

export const organizationsCommands = [organizationsListCommand];
