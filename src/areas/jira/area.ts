import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Jira Data Center: the self-hosted Jira, on `/rest/api/2` and the Agile API.
 * Jira Cloud identifies users by accountId rather than username and is its own
 * area (`jira-cloud`), never a flag on this one. Two systems that disagree on
 * what a person is get two forms, not one form with a box marked "if Cloud".
 */

/** How a `--field` value is shaped for Jira's API. Omitted means the raw string. */
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
  'labels',
  'url',
  'textarea',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const customFieldSchema = z.object({
  id: z.string().min(1).describe('Jira field id, e.g. customfield_10032'),
  name: z.string().min(1).describe('Friendly name used in --field, --fields-file, --input-file, JQL and output'),
  type: z.enum(CUSTOM_FIELD_TYPES).optional().describe('How a --field value is shaped; omitted sends the raw string'),
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
});

export type CustomFieldDefinition = z.output<typeof customFieldSchema>;

export const jiraArea = defineArea({
  name: 'jira',
  description: 'Jira Data Center: issues, search, transitions, comments, worklogs, attachments, custom fields, boards and sprints',
  connection: z.object({
    baseUrl: z.url().describe('Jira server root, e.g. https://jira.imagile.dev'),
    apiToken: z.string().min(1).describe('Personal access token'),
    customFields: z.array(customFieldSchema).default([]).describe('Custom fields addressable by friendly name'),
    // Shared defaults, usually set once under defaults.jira for every connection.
    project: z.string().min(1).optional().describe('Default project key for create-issue'),
    issueType: z.string().min(1).optional().describe('Default issue type for create-issue (Task when unset)'),
    priority: z.string().min(1).optional().describe('Default priority for create-issue'),
  }),
  secrets: ['apiToken'],
  context: {
    // Only create-issue lists it: the other --project flags never fell back to
    // a configured project, and a context input always would.
    project: {
      scope: 'command',
      flags: '--project <key>',
      description: 'Project key (or "project" in --input-file)',
      setting: 'project',
      // Any string, as before: an empty --project still gets create-issue's own error.
      schema: z.string(),
    },
  },
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.apiToken}` },
    service: 'Jira',
    authFix: `Jira rejected the personal access token on connection "${connection.name}". Create a new one under your profile picture → Profile → Personal Access Tokens, then set apiToken (${area.envName('apiToken')} for the default connection).`,
  }),
});

/** The floor the credential sets; no release has been verified yet. The skill file and the site's integration data say the same. */
export const jiraSupported: SupportedVersion = {
  product: 'Jira Data Center',
  minimum: '8.14',
  api: 'REST API 2 and Agile REST API 1.0',
  note: 'toil authenticates with a personal access token, which Jira Data Center added in 8.14. No release has been verified yet.',
};
