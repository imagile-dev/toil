import { z } from 'zod';
import { jiraArea } from '../area.js';
import * as client from './client.js';
import { pagingFields, pagingOptions } from '../paging.js';

/**
 * Projects, and the people in them. Cloud names a person by an opaque
 * accountId, so user search is how a name becomes something assign accepts;
 * the directory is consulted, as the onboarding checklist always intended.
 */

export const listProjects = jiraArea.command({
  path: ['jira', 'project', 'list'],
  description: 'List Jira Cloud projects visible to you',
  toolDescription:
    'Returns the Jira Cloud projects the account can see (id, key, name, projectTypeKey, ...), optionally filtered by query, a case-insensitive match on key or name. Without limit it returns every one; with limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ query: z.string().min(1).optional().describe('Only projects whose key or name contains this text'), ...pagingFields('projects') }),
  writes: false,
  options: [{ flags: '--query <text>', field: 'query', description: 'Only projects whose key or name contains this text' }, ...pagingOptions('projects')],
  examples: [{}, { query: 'imagile' }, { limit: 1 }, { limit: 1, cursor: '1' }],
  run: (input, ctx) => client.listProjects(ctx, input.query, input),
});

export const getProject = jiraArea.command({
  path: ['jira', 'project', 'get'],
  description: 'Get a Jira Cloud project by key or id',
  toolDescription: 'Returns one Jira Cloud project by key or id, as Jira returns it (lead, issueTypes, components, versions, ...).',
  input: z.object({ project: z.string().min(1).describe('Project key or id') }),
  writes: false,
  args: [{ name: 'project', field: 'project', description: 'Project key or id' }],
  examples: [{ project: 'PROJ' }],
  run: (input, ctx) => client.getProject(ctx, input.project),
});

export const searchUsers = jiraArea.command({
  path: ['jira', 'user', 'search'],
  description: 'Find Jira Cloud users and their accountIds',
  toolDescription:
    'Returns active Jira Cloud users matching query (display name or email address), each with accountId, displayName and accountType, one page of at most limit users (default 50). A full page sets meta.page.nextCursor: pass it as cursor for the next. Use the accountId as assignee in jira_issue_assign, jira_issue_create and jira_issue_update.',
  input: z.object({
    query: z.string().min(1).describe('Text to match against display name and email address'),
    limit: z.number().int().positive().max(1000).optional().describe('Most users to return (default 50)'),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous page, to carry on from there'),
  }),
  writes: false,
  options: [
    { flags: '--query <text>', field: 'query', description: 'Text to match against display name and email address' },
    { flags: '--limit <n>', field: 'limit', description: 'Most users to return (default 50)' },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous page' },
  ],
  examples: [{ query: 'smith' }, { query: 'you@example.com', limit: 5 }, { query: 'smith', limit: 1, cursor: '1' }],
  run: (input, ctx) => client.searchUsers(ctx, input.query, input.limit ?? 50, input.cursor),
});

export const projectCommands = [listProjects, getProject, searchUsers];
