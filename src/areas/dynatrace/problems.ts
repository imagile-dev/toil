import { z } from 'zod';
import { dynatraceArea } from './area.js';
import { allPages, dynatrace } from './client.js';

/**
 * Problems: every page of a list over a window (the last two hours unless
 * told otherwise, the same default the API applies), and one problem by id.
 * A problem that resolved itself before anyone looked still counts; the
 * window is the window.
 */

export const problemsListCommand = dynatraceArea.command({
  path: ['dynatrace', 'problem', 'list'],
  description: 'List problems',
  input: z.object({
    from: z.string().optional().describe('Start time (default: now-2h)'),
    to: z.string().optional().describe('End time (default: now)'),
    problemSelector: z.string().optional().describe('Dynatrace problem selector'),
    entitySelector: z.string().optional().describe('Affected entity selector'),
  }),
  writes: false,
  options: [
    { flags: '--from <time>', field: 'from', description: 'Start time (default: now-2h)' },
    { flags: '--to <time>', field: 'to', description: 'End time (default: now)' },
    { flags: '--problem-selector <selector>', field: 'problemSelector', description: 'Dynatrace problem selector' },
    { flags: '--entity-selector <selector>', field: 'entitySelector', description: 'Affected entity selector' },
  ],
  examples: [{}, { from: 'now-1d', to: 'now-1h', problemSelector: 'status("open")', entitySelector: 'type("SERVICE")', env: 'prod' }],
  run: async (input, ctx) => {
    const first = { from: input.from ?? 'now-2h', to: input.to ?? 'now', problemSelector: input.problemSelector, entitySelector: input.entitySelector };
    const { totalCount, items } = await allPages(ctx, '/api/v2/problems', 'problems', first, 'Dynatrace problems');
    return { totalCount, problems: items };
  },
});

export const problemsGetCommand = dynatraceArea.command({
  path: ['dynatrace', 'problem', 'get'],
  description: 'Get a problem by ID',
  input: z.object({
    id: z.string().describe('Problem ID'),
    fields: z.string().optional().describe('Additional fields'),
  }),
  writes: false,
  args: [{ name: 'id', field: 'id', description: 'Problem ID' }],
  options: [
    { flags: '--fields <fields>', field: 'fields', description: 'Additional fields' },
  ],
  examples: [{ id: '1234567890123456789_1700000000000V2' }, { id: '1234567890123456789_1700000000000V2', fields: 'evidenceDetails,impactAnalysis', env: 'dynatrace' }],
  // The server's problem, passed through as it came.
  run: async (input, ctx) => dynatrace(ctx, `/api/v2/problems/${encodeURIComponent(input.id)}`, { query: { fields: input.fields } }),
});

export const problemsCommands = [problemsListCommand, problemsGetCommand];
