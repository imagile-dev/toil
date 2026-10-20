import { z } from 'zod';
import { saucelabsArea } from './area.js';
import { intText, parseChoice, parseIntOption, sauce } from './client.js';

/**
 * App storage metadata under `/v1/storage`: what was uploaded, never the
 * upload or the download itself. The inventory, not the warehouse.
 */

const STORAGE_KINDS = ['android', 'ios'] as const;

function storageCommand(what: 'files' | 'groups', description: string, queryHelp: string) {
  return saucelabsArea.command({
    path: ['saucelabs', 'storage', what],
    description,
    input: z.object({
      query: z.string().optional().describe(queryHelp),
      kind: z.string().optional().describe('App kind: android or ios'),
      page: intText.optional().describe('Page number (starts at 1)'),
      pageSize: intText.optional().describe('Results per page (max 100)'),
    }),
    writes: false,
    options: [
      { flags: '--query <text>', field: 'query', description: queryHelp },
      { flags: '--kind <kind>', field: 'kind', description: 'App kind: android or ios' },
      { flags: '--page <n>', field: 'page', description: 'Page number (starts at 1)' },
      { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (max 100)' },
    ],
    examples: [{}, { query: 'imagile', kind: 'Android', page: '2', pageSize: '25' }],
    run: async (input, ctx) =>
      sauce(ctx, `/v1/storage/${what}`, {
        query: {
          q: input.query,
          kind: parseChoice(input.kind, STORAGE_KINDS, '--kind'),
          page: parseIntOption(input.page, '--page'),
          per_page: parseIntOption(input.pageSize, '--page-size'),
        },
      }),
  });
}

export const storageFilesCommand = storageCommand('files', 'List uploaded app files', 'Search file names and app metadata');
export const storageGroupsCommand = storageCommand('groups', 'List app groups (all versions of one app)', 'Search group names');

export const storageCommands = [storageFilesCommand, storageGroupsCommand];
