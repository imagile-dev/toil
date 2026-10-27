/**
 * The JSON Schema and a runnable example for the --input-file that
 * `jira issue create` and `jira issue update` accept, served by `toil jira
 * issue schema` so a caller can discover the shape without reading the manual. The
 * manual exists. It is the schema.
 */
export const JIRA_INPUT_FILE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'toil Jira issue input file',
  description:
    'Shape accepted by --input-file on `toil jira issue create` / `issue update`. ' +
    'CLI flags (--summary, --description, --priority, --field, ...) override matching keys here; ' +
    'overridden keys are reported in meta.warnings.',
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project key (issue create only)' },
    issueType: { type: 'string', description: 'Issue type name, e.g. Bug, Story, Task (issue create only)' },
    fields: {
      type: 'object',
      description:
        'Field dictionary. Built-in keys: summary, description, priority, assignee, labels, parent. ' +
        "Any other key resolves as a custom field: a friendly name registered in the connection's customFields, " +
        'or a raw field id (e.g. customfield_10032) passed through untouched; custom fields never ' +
        'need to be registered. Any string value may be "@path/to/file" to read that ' +
        "field's content from a file instead of inlining it (useful for large rich-text fields).",
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

export const JIRA_INPUT_FILE_EXAMPLE = {
  project: 'PROJ',
  issueType: 'Bug',
  fields: {
    summary: 'Login broken on Safari',
    description: '@desc.html',
    priority: 'High',
    labels: ['frontend', 'urgent'],
    // A raw field id, passed through untouched. A friendly name such as
    // "Story Points" works once it's registered in customFields.
    customfield_10032: '@ac.md',
  },
};
