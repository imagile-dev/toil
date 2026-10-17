import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';
import { commaList } from './issues.js';

/**
 * JQL search on Jira Cloud's enhanced search endpoint, which pages by token
 * and no longer counts its results. toil reports what it read and where to
 * carry on; the grand total is, as in most reorganisations, no longer
 * anyone's responsibility.
 */

export const search = jiraCloudArea.command({
  path: ['jira-cloud', 'search'],
  description: 'Search Jira Cloud issues with JQL (consider --output-file for large results)',
  toolDescription:
    'Searches Jira Cloud issues with JQL and returns { issues, maxResults, isLast }: maxResults is how many came back, isLast whether that was everything. Without maxResults it pages through every match, so bound broad queries. With maxResults, pass meta.page.nextCursor as cursor to get the next page. Jira Cloud reports no total. Use jira_cloud_get_issue for one issue by key.',
  input: z.object({
    jql: z.string().optional().describe('JQL query, e.g. project = PROJ AND status = "In Progress"'),
    jqlFile: z.string().optional().describe('Path to a file holding the JQL query ("-" = stdin on the CLI)'),
    maxResults: z.number().int().positive().optional().describe('Maximum number of issues to return; all matches when omitted'),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to carry on from there'),
    fields: z.string().optional().describe('Comma-separated field ids to return instead of the default set, e.g. summary,status,customfield_10016'),
  }),
  writes: false,
  // POST /rest/api/3/search/jql, as Jira recommends for JQL too long for a URL. It only reads.
  queryByPost: true,
  options: [
    { flags: '--jql <query>', field: 'jql', description: 'JQL query string' },
    { flags: '--jql-file <path>', field: 'jqlFile', description: "Path to a file containing the JQL query ('-' = stdin)" },
    { flags: '--max-results <n>', field: 'maxResults', description: 'Maximum number of results' },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page (with --max-results)' },
    { flags: '--fields <list>', field: 'fields', description: 'Comma-separated field ids to return instead of the default set' },
  ],
  examples: [
    { jql: 'project = PROJ AND status = "In Progress"', maxResults: 2 },
    // The cursor the first example hands back: the same page, past its first two issues.
    { jql: 'project = PROJ AND status = "In Progress"', maxResults: 2, cursor: 'eyJjIjpudWxsLCJzIjoyfQ' },
    { jqlFile: 'query.jql', fields: 'summary,status,customfield_10016' },
  ],
  run: async (input, ctx) => {
    if (input.jql !== undefined && input.jqlFile !== undefined) throw new ToilError('INVALID_INPUT', 'Cannot specify both --jql and --jql-file', { fix: 'Pass one of them.' });
    const raw = input.jqlFile !== undefined ? ctx.files.readText(input.jqlFile) : input.jql;
    if (raw === undefined) throw new ToilError('INVALID_INPUT', 'Must specify --jql or --jql-file', { fix: 'Pass --jql "project = ABC", or --jql-file query.jql.' });
    // A file almost always ends in a newline, which Jira rejects.
    const jql = raw.trim();
    if (!jql) throw new ToilError('INVALID_INPUT', 'JQL query is empty', { fix: 'Put a JQL query in the flag or file.' });
    if (input.cursor !== undefined && input.maxResults === undefined) {
      throw new ToilError('INVALID_INPUT', '--cursor needs --max-results', {
        fix: 'Pass --max-results with --cursor (the page size of the call that gave you the cursor), or leave out --cursor to read every match.',
      });
    }
    const fields = input.fields === undefined ? client.STANDARD_SEARCH_FIELDS : commaList(input.fields);
    if (fields.length === 0) throw new ToilError('INVALID_INPUT', '--fields must list at least one field.', { fix: 'Pass --fields summary,status.' });
    const result = await client.search(ctx, jql, { fields, cap: input.maxResults, cursor: input.cursor });
    return { issues: result.items, maxResults: result.items.length, isLast: result.nextCursor === null };
  },
});

export const searchCommands = [search];
