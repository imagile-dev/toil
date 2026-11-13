import { z } from 'zod';
import { apiPath } from '../../../core/api-path.js';
import { jiraArea } from '../area.js';
import { pageOf, pagingFields, pagingOptions } from '../paging.js';
import { jira } from './client.js';

/**
 * The value lists a split needs on Data Center: a project's versions and
 * components, the two places a release and a module are written down before
 * anyone is asked to pick one. Jira sends each as one whole array, so --limit
 * and --cursor cut it here. The list of valid values has existed for years; it
 * simply has not been asked for until a meeting required it.
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
    const versions = await jira<Array<Record<string, unknown>>>(ctx, apiPath`/rest/api/2/project/${ctx.context.project!}/versions`);
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
    const components = await jira<Array<Record<string, unknown>>>(ctx, apiPath`/rest/api/2/project/${ctx.context.project!}/components`);
    return pageOf(components, input, ctx.setPage);
  },
});

export const valueListCommands = [listVersions, listComponents];
