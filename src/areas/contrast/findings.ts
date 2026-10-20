import { z } from 'zod';
import { contrastArea } from './area.js';
import { contrast, intText, limitOffset } from './client.js';

/**
 * Vulnerability findings, which Contrast calls traces: one page of an
 * application's, or one by its UUID. Filters reach the server as typed,
 * unchecked against the listed choices (#87 item 7), because validating a severity
 * is the server's job and it has never once delegated it.
 */

export const findingsListCommand = contrastArea.command({
  path: ['contrast', 'app', 'findings'],
  description: 'List vulnerability findings for an application',
  input: z.object({
    app: z.string().describe('Application ID (UUID)'),
    severity: z.string().optional().describe('Filter by severity: CRITICAL, HIGH, MEDIUM, LOW, NOTE'),
    status: z.string().optional().describe('Filter by status: REPORTED, CONFIRMED, SUSPICIOUS, NOT_A_PROBLEM, REMEDIATED, FIXED'),
    limit: intText.optional().describe('Maximum number of results (default: "25")'),
    offset: intText.optional().describe('Pagination offset (default: "0")'),
  }),
  writes: false,
  args: [{ name: 'app', field: 'app', description: 'Application ID (UUID)' }],
  options: [
    { flags: '--severity <level>', field: 'severity', description: 'Filter by severity: CRITICAL, HIGH, MEDIUM, LOW, NOTE' },
    { flags: '--status <status>', field: 'status', description: 'Filter by status: REPORTED, CONFIRMED, SUSPICIOUS, NOT_A_PROBLEM, REMEDIATED, FIXED' },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum number of results (default: "25")' },
    { flags: '--offset <n>', field: 'offset', description: 'Pagination offset (default: "0")' },
  ],
  examples: [
    { app: 'abc12345-0000-0000-0000-000000000000' },
    { app: 'abc12345-0000-0000-0000-000000000000', severity: 'HIGH,CRITICAL', status: 'CONFIRMED', limit: '50', offset: '25' },
  ],
  run: async (input, ctx) => {
    const params = {
      ...limitOffset(input.limit, input.offset),
      // An empty value is left out, by the truthiness check the contract specifies.
      ...(input.severity ? { severities: input.severity } : {}),
      // Suspected bug (#87 item 2): Contrast's SDK sends `status`, not `statuses`.
      ...(input.status ? { statuses: input.status } : {}),
    };
    return contrast<unknown>(ctx, `/traces/${input.app}/filter`, params);
  },
});

export const findingsGetCommand = contrastArea.command({
  path: ['contrast', 'finding', 'get'],
  description: 'Get details for a specific vulnerability finding',
  input: z.object({
    app: z.string().describe('Application ID (UUID)'),
    trace: z.string().describe('Trace/finding UUID'),
  }),
  writes: false,
  args: [
    { name: 'app', field: 'app', description: 'Application ID (UUID)' },
    { name: 'trace', field: 'trace', description: 'Trace/finding UUID' },
  ],
  examples: [{ app: 'abc12345-0000-0000-0000-000000000000', trace: 'ABCD-1234-EFGH-5678' }],
  // Suspected bug (#87 item 3): the SDK reads a trace from `/filter/<id>`, not `/trace/<id>`.
  run: async (input, ctx) => contrast<unknown>(ctx, `/traces/${input.app}/trace/${input.trace}`),
});

export const findingsCommands = [findingsListCommand, findingsGetCommand];
