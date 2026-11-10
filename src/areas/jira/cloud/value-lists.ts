import { z } from 'zod';
import { jiraArea } from '../area.js';
import { pageOf, pagingFields, pagingOptions } from '../paging.js';
import { jiraCloud } from './client.js';

/**
 * The value lists a split needs on Jira Cloud: a project's versions and
 * components, from REST API 3 (https://developer.atlassian.com/cloud/jira/platform/rest/v3/).
 * Same commands and flags as Data Center. Each is sent as one whole array, so
 * --limit and --cursor cut it here. Nobody has yet filed the form that would
 * let us ask for them in pages.
 */

export const listVersions = jiraArea.command({
  path: ['jira', 'version', 'list'],
  description: "List a Jira project's versions (releases)",
  toolDescription:
    "Returns a Jira project's versions as Jira records them: id, name, description, released, archived, startDate, releaseDate, overdue and projectId. These are the values a fix version or affects version can take. Without limit it returns every version; with limit, pass meta.page.nextCursor as cursor for the next page.",
  input: z.object({ ...pagingFields('versions') }),
  writes: false,
  context: { project: 'required' },
  options: [...pagingOptions('versions')],
  examples: [{ project: 'PROJ' }, { project: 'PROJ', limit: 1 }, { project: 'PROJ', limit: 1, cursor: '1' }],
  run: async (input, ctx) => {
    const versions = await jiraCloud<Array<Record<string, unknown>>>(ctx, `/rest/api/3/project/${encodeURIComponent(ctx.context.project!)}/versions`);
    return pageOf(versions, input, ctx.setPage);
  },
});

export const listComponents = jiraArea.command({
  path: ['jira', 'component', 'list'],
  description: "List a Jira project's components",
  toolDescription:
    "Returns a Jira project's components as Jira records them: id, name, description, lead, assigneeType and project. These are the values an issue's components field can take. Without limit it returns every component; with limit, pass meta.page.nextCursor as cursor for the next page.",
  input: z.object({ ...pagingFields('components') }),
  writes: false,
  context: { project: 'required' },
  options: [...pagingOptions('components')],
  examples: [{ project: 'PROJ' }, { project: 'PROJ', limit: 1 }, { project: 'PROJ', limit: 1, cursor: '1' }],
  run: async (input, ctx) => {
    const components = await jiraCloud<Array<Record<string, unknown>>>(ctx, `/rest/api/3/project/${encodeURIComponent(ctx.context.project!)}/components`);
    return pageOf(components, input, ctx.setPage);
  },
});

export const valueListCommands = [listVersions, listComponents];
