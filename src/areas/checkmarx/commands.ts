import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { checkmarxArea } from './area.js';
import { checkmarx, checkmarxList } from './client.js';

/**
 * The five Checkmarx One commands: projects and scans, listed or fetched by
 * UUID, and a scan's results statistics. Every one reads. Lists are one page
 * (100 by default) with a warning when there's more, because the predecessor
 * never asked for page two and nobody has yet asked why.
 */

/** Placeholder UUIDs for the examples. */
const PROJECT_ID = 'abc12345-0000-0000-0000-000000000000';
const SCAN_ID = 'abc12345-0000-0000-0000-0000000000a1';

export const projectListCommand = checkmarxArea.command({
  path: ['checkmarx', 'project', 'list'],
  description: 'List all projects',
  input: z.object({}),
  writes: false,
  examples: [{}],
  // Suspected bug (#89 item 1): one request with limit=100, despite "all".
  run: async (_input, ctx) => checkmarxList(ctx, 'projects', { limit: 100 }),
});

export const projectGetCommand = checkmarxArea.command({
  path: ['checkmarx', 'project', 'get'],
  description: 'Get a project by ID',
  input: z.object({
    id: z.string().describe('Project UUID'),
  }),
  writes: false,
  options: [{ flags: '--id <id>', field: 'id', description: 'Project UUID' }],
  examples: [{ id: PROJECT_ID }],
  // Suspected bug (#89 item 7): the id goes into the path unencoded.
  run: async (input, ctx) => checkmarx(ctx, `projects/${input.id}`),
});

export const scanListCommand = checkmarxArea.command({
  path: ['checkmarx', 'scan', 'list'],
  description: 'List scans',
  input: z.object({
    project: z.string().optional().describe('Filter by project UUID'),
    // Text until parseInt reads it, as the predecessor did (#89 item 4).
    last: z.union([z.number(), z.string()]).optional().describe('Return only the last N scans'),
  }),
  writes: false,
  options: [
    { flags: '--project <id>', field: 'project', description: 'Filter by project UUID' },
    { flags: '--last <n>', field: 'last', description: 'Return only the last N scans' },
  ],
  examples: [{}, { project: PROJECT_ID, last: '5' }],
  run: async (input, ctx) => {
    const text = input.last === undefined ? undefined : String(input.last);
    const last = text ? parseInt(text, 10) : undefined;
    // Suspected bug (#89 item 4): only a wholly non-numeric value is refused; 5abc is 5, and 0 or -3 reach the server.
    if (text && Number.isNaN(last)) {
      throw new ToilError('INVALID_INPUT', `Invalid --last "${text}". Expected an integer.`, { fix: 'Pass --last a whole number of scans, e.g. --last 10.' });
    }
    return checkmarxList(ctx, 'scans', { limit: last ?? 100, 'project-id': input.project ? input.project : undefined });
  },
});

export const scanGetCommand = checkmarxArea.command({
  path: ['checkmarx', 'scan', 'get'],
  description: 'Get a scan by ID',
  input: z.object({
    id: z.string().describe('Scan UUID'),
  }),
  writes: false,
  options: [{ flags: '--id <id>', field: 'id', description: 'Scan UUID' }],
  examples: [{ id: SCAN_ID }],
  run: async (input, ctx) => checkmarx(ctx, `scans/${input.id}`),
});

export const scanStatsCommand = checkmarxArea.command({
  path: ['checkmarx', 'scan', 'stats'],
  description: 'Get results statistics for a scan',
  input: z.object({
    id: z.string().describe('Scan UUID'),
  }),
  writes: false,
  options: [{ flags: '--id <id>', field: 'id', description: 'Scan UUID' }],
  examples: [{ id: SCAN_ID }],
  // Suspected bug (#89 item 2): the deprecated Results Summary API, with scan-id.
  run: async (input, ctx) => checkmarx(ctx, 'results/summary', { 'scan-id': input.id }),
});

export const checkmarxCommands = [projectListCommand, projectGetCommand, scanListCommand, scanGetCommand, scanStatsCommand];
