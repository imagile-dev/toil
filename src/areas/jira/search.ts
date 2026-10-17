import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { jiraArea } from './area.js';
import * as client from './client.js';
import { buildFieldMap, resolveFieldKey, translateFieldsInOutput, translateJql } from './custom-fields.js';
import { commaList, resolveJql } from './input.js';

/**
 * Finding issues with JQL, and finding out which fields exist to search on.
 * The query language is Jira's; toil only swaps friendly field names for ids
 * on the way in and back again on the way out, like a translator who has been
 * asked not to editorialise and, for once, doesn't.
 */

export const search = jiraArea.command({
  path: ['jira', 'search'],
  description: 'Search Jira issues with JQL (consider --output-file for large results)',
  toolDescription:
    'Searches Jira issues with JQL and returns { issues, total, startAt, maxResults }. Without maxResults it pages through every match, so bound broad queries. meta.page.nextCursor is the startAt for the next page. Use jira_get_issue for one issue by key.',
  input: z.object({
    jql: z.string().min(1).optional().describe('JQL query, e.g. project = PROJ AND status = "In Progress"'),
    jqlFile: z.string().min(1).optional().describe('Path to a file holding the JQL query ("-" = stdin on the CLI)'),
    maxResults: z.number().int().nonnegative().optional().describe('Maximum number of issues to return; all matches when omitted'),
    startAt: z.number().int().nonnegative().optional().describe('Index of the first result to return, for resuming or paging'),
    fields: z.string().min(1).optional().describe('Comma-separated fields to return instead of the default set (names or ids, e.g. summary,status,"Story Points")'),
  }),
  writes: false,
  // POST /search, as Jira recommends for JQL too long for a URL. It only reads.
  queryByPost: true,
  options: [
    { flags: '--jql <query>', field: 'jql', description: 'JQL query string' },
    { flags: '--jql-file <path>', field: 'jqlFile', description: "Path to a file containing the JQL query ('-' = stdin)" },
    { flags: '--max-results <n>', field: 'maxResults', description: 'Maximum number of results' },
    { flags: '--start-at <n>', field: 'startAt', description: 'Index of the first result to return (for resuming or paging)' },
    { flags: '--fields <list>', field: 'fields', description: 'Comma-separated fields to return instead of the default set (names or ids, e.g. summary,status,"Story Points")' },
  ],
  examples: [
    { jql: 'project = PROJ AND status = "In Progress"', maxResults: 2 },
    { jqlFile: 'query.jql', startAt: 1, fields: 'summary,status,Story Points' },
  ],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    const jql = resolveJql(input.jql, input.jqlFile, ctx.files);
    let fields: string[];
    if (input.fields !== undefined) {
      fields = commaList(input.fields).map((name) => {
        const id = resolveFieldKey(name, fieldMap);
        if (id === undefined) {
          throw new ToilError('INVALID_INPUT', `Unknown field in --fields: "${name}".`, { fix: 'Use a field id, or a custom field name registered in customFields.' });
        }
        return id;
      });
      if (fields.length === 0) throw new ToilError('INVALID_INPUT', '--fields must list at least one field.', { fix: 'Pass --fields summary,status.' });
    } else {
      fields = [...client.STANDARD_SEARCH_FIELDS, ...ctx.connection.customFields.map((f) => f.id)];
    }
    const result = await client.search(ctx, translateJql(jql, fieldMap), { maxResults: input.maxResults, startAt: input.startAt, fields });
    const next = result.startAt + result.issues.length;
    ctx.setPage({ nextCursor: next < result.total ? String(next) : null, limit: input.maxResults ?? result.issues.length });
    return { ...result, issues: result.issues.map((issue) => ({ ...issue, fields: translateFieldsInOutput(issue.fields, fieldMap) })) };
  },
});

export const fields = jiraArea.command({
  path: ['jira', 'fields'],
  description: 'List custom fields (configured or discovered from Jira API) (consider --output-file for large results)',
  toolDescription:
    "Without discover, returns the custom fields registered on the connection. With discover, returns Jira's field list (id, name, schema, suggestedType), and with project also each field's allowedValues. Use it to find a field's id before setting it.",
  input: z.object({
    discover: z.boolean().optional().describe('Fetch field metadata from the Jira API instead of listing registered fields'),
    customOnly: z.boolean().optional().describe('Only custom fields (with discover)'),
    project: z.string().min(1).optional().describe("Project key: adds allowedValues for select fields from createmeta (with discover)"),
    issueType: z.string().min(1).optional().describe('Limit allowedValues to one issue type (with project)'),
  }),
  writes: false,
  options: [
    { flags: '--discover', field: 'discover', description: 'Fetch field metadata from Jira API' },
    { flags: '--custom-only', field: 'customOnly', description: 'Show only custom fields (requires --discover)' },
    { flags: '--project <key>', field: 'project', description: 'Project key — fetches allowedValues for select fields via createmeta (requires --discover)' },
    { flags: '--issue-type <type>', field: 'issueType', description: 'Filter allowedValues to a specific issue type (requires --project)' },
  ],
  examples: [{}, { discover: true, customOnly: true }, { discover: true, project: 'PROJ', issueType: 'Bug' }],
  run: async (input, ctx) => {
    if (!input.discover) {
      const ignored = (['customOnly', 'project', 'issueType'] as const).filter((k) => input[k] !== undefined);
      if (ignored.length > 0) ctx.warn({ code: 'JIRA_NEEDS_DISCOVER', message: `${ignored.join(', ')} only apply with --discover and were ignored.` });
      return ctx.connection.customFields;
    }
    const all = input.project ? await client.fetchFieldsWithAllowedValues(ctx, input.project, input.issueType) : await client.fetchFields(ctx);
    return input.customOnly ? all.filter((f) => f.custom) : all;
  },
});

export const searchCommands = [search, fields];
