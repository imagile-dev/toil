import { z } from 'zod';
import { sonatypeiqArea } from './area.js';
import { iq } from './client.js';

/**
 * Applications, read from `/api/v2/applications`. `get` is the same list
 * filtered by public ID, so an unknown ID is an empty list and a success
 * (suspected bug #90 item 3). A search that finds nothing has, technically,
 * completed its search.
 */

export const applicationsListCommand = sonatypeiqArea.command({
  path: ['sonatypeiq', 'application', 'list'],
  description: 'List all applications in Sonatype IQ Server',
  toolDescription: 'Every application in Sonatype IQ Server, as the server returns it: { applications: [{ id, publicId, name, organizationId, ... }] }. Use the publicId with sonatypeiq_application_evaluate.',
  input: z.object({
    organizationId: z.string().optional().describe('Filter by organization ID'),
  }),
  writes: false,
  options: [{ flags: '--organization-id <id>', field: 'organizationId', description: 'Filter by organization ID' }],
  examples: [{}, { organizationId: 'abc12345-0000-0000-0000-000000000000' }],
  // Suspected bug #90 item 1: organizationId goes as a query key IQ doesn't document, so it may filter nothing.
  run: async (input, ctx) => iq(ctx, '/api/v2/applications', input.organizationId ? { organizationId: input.organizationId } : {}),
});

export const applicationsGetCommand = sonatypeiqArea.command({
  path: ['sonatypeiq', 'application', 'get'],
  description: 'Get an application by its public ID',
  toolDescription: 'One application by its public ID, as the server returns the filtered list: { applications: [...] }, with zero or one entry. An unknown ID is an empty list, not an error.',
  input: z.object({
    publicId: z.string().describe('Application public ID'),
  }),
  writes: false,
  args: [{ name: 'public-id', field: 'publicId', description: 'Application public ID' }],
  examples: [{ publicId: 'imagile-api' }],
  run: async (input, ctx) => iq(ctx, '/api/v2/applications', { publicId: input.publicId }),
});

export const applicationsCommands = [applicationsListCommand, applicationsGetCommand];
