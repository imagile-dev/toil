import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';
import { buildFieldMap, resolveFieldKey, translateFieldsInOutput, translateJql } from './custom-fields.js';
import { commaList, resolveJql } from './input.js';
import { jqlInstant, parseUpdatedSince, updatedSinceField, updatedSinceOption, withUpdatedSince } from '../jira/since.js';

/**
 * JQL search on Jira Cloud's enhanced search endpoint, which pages by token
 * and no longer counts its results, and the field list to search on. toil
 * reports what it read and where to carry on; the grand total is, as in most
 * reorganisations, no longer anyone's responsibility.
 */

export const search = jiraCloudArea.command({
  path: ['jira-cloud', 'search'],
  description: 'Search Jira Cloud issues with JQL (consider --output-file for large results)',
  toolDescription:
    'Searches Jira Cloud issues with JQL and returns { issues, maxResults, isLast }: maxResults is how many came back, isLast whether that was everything. Without maxResults it pages through every match, so bound broad queries. With maxResults, pass meta.page.nextCursor as cursor to get the next page. Jira Cloud reports no total. updatedSince adds updated >= that instant to the JQL, in the time zone of your Atlassian account. Use jira_cloud_get_issue for one issue by key.',
  input: z.object({
    jql: z.string().optional().describe('JQL query, e.g. project = PROJ AND status = "In Progress"'),
    jqlFile: z.string().optional().describe('Path to a file holding the JQL query ("-" = stdin on the CLI)'),
    maxResults: z.number().int().positive().optional().describe('Maximum number of issues to return; all matches when omitted'),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to carry on from there (with maxResults)'),
    updatedSince: updatedSinceField,
    fields: z.string().optional().describe('Comma-separated fields to return instead of the default set (names or ids, e.g. summary,status,"Story Points")'),
  }),
  writes: false,
  // POST /rest/api/3/search/jql, as Jira recommends for JQL too long for a URL. It only reads.
  queryByPost: true,
  options: [
    { flags: '--jql <query>', field: 'jql', description: 'JQL query string' },
    { flags: '--jql-file <path>', field: 'jqlFile', description: "Path to a file containing the JQL query ('-' = stdin)" },
    { flags: '--max-results <n>', field: 'maxResults', description: 'Maximum number of results' },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page (with --max-results)' },
    updatedSinceOption,
    { flags: '--fields <list>', field: 'fields', description: 'Comma-separated fields to return instead of the default set (names or ids, e.g. summary,status,"Story Points")' },
  ],
  examples: [
    { jql: 'project = PROJ AND status = "In Progress"', maxResults: 2 },
    // The cursor the first example hands back: the same page, past its first two issues.
    { jql: 'project = PROJ AND status = "In Progress"', maxResults: 2, cursor: 'eyJjIjpudWxsLCJzIjoyfQ' },
    { jqlFile: 'query.jql', fields: 'summary,status,Story Points' },
    { jqlFile: 'query.jql', updatedSince: '2026-10-01T09:30:00Z', maxResults: 2 },
    { updatedSince: '2026-10-01' },
  ],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    // With --updated-since alone, the instant is the whole query.
    const jql = input.updatedSince !== undefined && input.jql === undefined && input.jqlFile === undefined ? undefined : resolveJql(input.jql, input.jqlFile, ctx.files);
    const since = input.updatedSince === undefined ? undefined : parseUpdatedSince(input.updatedSince);
    if (input.cursor !== undefined && input.maxResults === undefined) {
      throw new ToilError('INVALID_INPUT', '--cursor needs --max-results', {
        fix: 'Pass --max-results with --cursor (the page size of the call that gave you the cursor), or leave out --cursor to read every match.',
      });
    }
    let fields: string[];
    if (input.fields !== undefined) {
      fields = commaList(input.fields).map((name) => {
        const id = resolveFieldKey(name, fieldMap);
        if (id === undefined) throw new ToilError('INVALID_INPUT', `Unknown field in --fields: "${name}".`, { fix: 'Use a field id, or a custom field name registered in customFields.' });
        return id;
      });
      if (fields.length === 0) throw new ToilError('INVALID_INPUT', '--fields must list at least one field.', { fix: 'Pass --fields summary,status.' });
    } else {
      fields = [...client.STANDARD_SEARCH_FIELDS, ...ctx.connection.customFields.map((f) => f.id)];
    }
    let query = jql === undefined ? undefined : translateJql(jql, fieldMap);
    if (since) {
      const zone = await client.myTimeZone(ctx);
      const instant = jqlInstant(since, zone, (asked) =>
        ctx.warn({ code: 'JIRA_CLOUD_TIME_ZONE', message: `Jira Cloud ${asked ? `named a time zone toil doesn't know (${asked})` : "didn't say which time zone your account uses"}, so --updated-since was written in UTC.` }),
      );
      query = withUpdatedSince(query, instant);
    }
    const result = await client.search(ctx, query!, { fields, cap: input.maxResults, cursor: input.cursor });
    const issues = result.items.map((issue) => ({ ...issue, fields: translateFieldsInOutput(issue.fields, fieldMap) }));
    return { issues, maxResults: issues.length, isLast: result.nextCursor === null };
  },
});

export const fields = jiraCloudArea.command({
  path: ['jira-cloud', 'fields'],
  description: 'List custom fields (configured or discovered from Jira API) (consider --output-file for large results)',
  toolDescription:
    "Without discover, returns the custom fields registered on the connection. With discover, returns Jira Cloud's field list (id, name, schema, suggestedType), and with project also each field's allowedValues. Use it to find a field's id before setting it.",
  input: z.object({
    discover: z.boolean().optional().describe('Fetch field metadata from the Jira API instead of listing registered fields'),
    customOnly: z.boolean().optional().describe('Only custom fields (with discover)'),
    project: z.string().min(1).optional().describe('Project key: adds allowedValues for select fields from createmeta (with discover)'),
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
      if (ignored.length > 0) ctx.warn({ code: 'JIRA_CLOUD_NEEDS_DISCOVER', message: `${ignored.join(', ')} only apply with --discover and were ignored.` });
      return ctx.connection.customFields;
    }
    if (input.issueType !== undefined && input.project === undefined) {
      throw new ToilError('INVALID_INPUT', '--issue-type needs --project', { fix: 'Pass --project with --issue-type, or leave --issue-type out.' });
    }
    const all = input.project ? await client.fetchFieldsWithAllowedValues(ctx, input.project, input.issueType) : await client.fetchFields(ctx);
    return input.customOnly ? all.filter((f) => f.custom) : all;
  },
});

export const searchCommands = [search, fields];
