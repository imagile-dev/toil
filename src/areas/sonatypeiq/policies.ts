import { z } from 'zod';
import { sonatypeiqArea } from './area.js';
import { iq } from './client.js';

/**
 * Policies, from `/api/v2/policies`, or with --organization-id from
 * `/api/v2/policies/organization/<id>`, a path IQ doesn't document (suspected
 * bug #90 item 2). Policy about policies is, as ever, undocumented.
 */

export const policiesListCommand = sonatypeiqArea.command({
  path: ['sonatypeiq', 'policies', 'list'],
  description: 'List all policies',
  toolDescription: 'Every policy in Sonatype IQ Server, as the server returns it: { policies: [{ id, name, ownerId, ownerType, threatLevel, policyType }] }.',
  input: z.object({
    organizationId: z.string().optional().describe('Filter by organization ID'),
  }),
  writes: false,
  options: [{ flags: '--organization-id <id>', field: 'organizationId', description: 'Filter by organization ID' }],
  examples: [{}, { organizationId: 'abc12345-0000-0000-0000-000000000000' }],
  run: async (input, ctx) => iq(ctx, input.organizationId ? `/api/v2/policies/organization/${encodeURIComponent(input.organizationId)}` : '/api/v2/policies'),
});

export const policiesCommands = [policiesListCommand];
