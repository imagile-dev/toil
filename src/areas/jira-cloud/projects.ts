import { z } from 'zod';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';

/**
 * Projects, and the people in them. Cloud names a person by an opaque
 * accountId, so search-users is how a name becomes something assign accepts;
 * the directory is consulted, as the onboarding checklist always intended.
 */

export const listProjects = jiraCloudArea.command({
  path: ['jira-cloud', 'list-projects'],
  description: 'List Jira Cloud projects visible to you',
  toolDescription:
    'Returns every Jira Cloud project the account can see (id, key, name, projectTypeKey, ...), optionally filtered by query, a case-insensitive match on key or name.',
  input: z.object({ query: z.string().min(1).optional().describe('Only projects whose key or name contains this text') }),
  writes: false,
  options: [{ flags: '--query <text>', field: 'query', description: 'Only projects whose key or name contains this text' }],
  examples: [{}, { query: 'imagile' }],
  run: (input, ctx) => client.listProjects(ctx, input.query),
});

export const getProject = jiraCloudArea.command({
  path: ['jira-cloud', 'get-project'],
  description: 'Get a Jira Cloud project by key or id',
  toolDescription: 'Returns one Jira Cloud project by key or id, as Jira returns it (lead, issueTypes, components, versions, ...).',
  input: z.object({ project: z.string().min(1).describe('Project key or id') }),
  writes: false,
  options: [{ flags: '--project <key>', field: 'project', description: 'Project key or id' }],
  examples: [{ project: 'PROJ' }],
  run: (input, ctx) => client.getProject(ctx, input.project),
});

export const searchUsers = jiraCloudArea.command({
  path: ['jira-cloud', 'search-users'],
  description: 'Find Jira Cloud users and their accountIds',
  toolDescription:
    'Returns active Jira Cloud users matching query (display name or email address), each with accountId, displayName and accountType. Use the accountId as assignee in jira_cloud_assign, jira_cloud_create_issue and jira_cloud_update_issue.',
  input: z.object({
    query: z.string().min(1).describe('Text to match against display name and email address'),
    maxResults: z.number().int().positive().max(1000).optional().describe('Most users to return (default 50)'),
  }),
  writes: false,
  options: [
    { flags: '--query <text>', field: 'query', description: 'Text to match against display name and email address' },
    { flags: '--max-results <n>', field: 'maxResults', description: 'Most users to return (default 50)' },
  ],
  examples: [{ query: 'smith' }, { query: 'you@example.com', maxResults: 5 }],
  run: (input, ctx) => client.searchUsers(ctx, input.query, input.maxResults ?? 50),
});

export const projectCommands = [listProjects, getProject, searchUsers];
