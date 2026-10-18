import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Jira Cloud: Atlassian's hosted Jira, on REST API 3 and the Agile API 1.0.
 * Its own area rather than a flag on `jira` (Data Center), because the two
 * disagree on what a user is (an accountId here, a username there) and what a
 * description is (an Atlassian Document Format tree here, a string there).
 * Built from Atlassian's documented API; no tested contract exists, so the
 * documentation is the only signatory on this form.
 */
/** How a `--field` value is shaped for Jira Cloud's API. Omitted means the raw string. */
export const CUSTOM_FIELD_TYPES = [
  'string',
  'number',
  'date',
  'datetime',
  'select',
  'multi-select',
  'option-id',
  'cascading-select',
  'user',
  'multi-user',
  'labels',
  'url',
  'textarea',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const customFieldSchema = z.object({
  id: z.string().min(1).describe('Jira field id, e.g. customfield_10016'),
  name: z.string().min(1).describe('Friendly name used in --field, --fields-file, --input-file, JQL and output'),
  type: z.enum(CUSTOM_FIELD_TYPES).optional().describe('How a --field value is shaped; omitted sends the raw string'),
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
});

export type CustomFieldDefinition = z.output<typeof customFieldSchema>;

export const jiraCloudArea = defineArea({
  name: 'jira-cloud',
  description: 'Jira Cloud: issues, JQL search, transitions, comments, worklogs, attachments, custom fields, projects, users, boards and sprints',
  connection: z.object({
    baseUrl: z.url().describe('Jira Cloud site root, https://<your-site>.atlassian.net'),
    email: z.string().min(1).describe('Email address of the Atlassian account the API token belongs to'),
    apiToken: z.string().min(1).describe('Atlassian account API token'),
    customFields: z.array(customFieldSchema).default([]).describe('Custom fields addressable by friendly name'),
    // Shared defaults, usually set once under defaults.jira-cloud for every connection.
    project: z.string().min(1).optional().describe('Default project key for create-issue'),
    issueType: z.string().min(1).optional().describe('Default issue type for create-issue (Task when unset)'),
    priority: z.string().min(1).optional().describe('Default priority for create-issue'),
  }),
  secrets: ['apiToken'],
  examples: { baseUrl: 'https://<your-site>.atlassian.net', email: 'you@example.com' },
  context: {
    project: {
      scope: 'command',
      flags: '--project <key>',
      description: 'Project key (or "project" in --input-file)',
      setting: 'project',
      schema: z.string().min(1),
    },
  },
  probe: () => ({ path: '/rest/api/3/myself' }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    // Basic auth with the account's email and API token, as Atlassian documents
    // for scripts: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
    headers: { Authorization: `Basic ${Buffer.from(`${connection.email}:${connection.apiToken}`).toString('base64')}`, Accept: 'application/json' },
    service: 'Jira Cloud',
    authFix: `Jira Cloud rejected the email and API token on connection "${connection.name}". Check that email (${area.envName('email')}) is the Atlassian account's address, create a new API token at https://id.atlassian.com/manage-profile/security/api-tokens, then set apiToken (${area.envName('apiToken')} for the default connection).`,
  }),
});

/** Jira Cloud has no versions to choose between; the API is what's documented today. The skill file and the site's integration data say the same. */
export const jiraCloudSupported: SupportedVersion = {
  product: 'Jira Cloud',
  minimum: null,
  api: 'REST API 3 and Agile REST API 1.0',
  note: 'Jira Cloud is always current. toil calls REST API 3 (/rest/api/3, with the enhanced JQL search at /rest/api/3/search/jql) and the Agile REST API 1.0, with an Atlassian account email and API token sent as Basic auth. Nothing has been run against a live site yet.',
};
