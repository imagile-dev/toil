import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { jiraArea } from './area.js';
import * as client from './client.js';
import { buildFieldMap, translateFieldsInOutput } from './custom-fields.js';
import {
  commaList,
  mergeWithOverrides,
  normalizeLabels,
  parseFieldArgs,
  parseFieldsFile,
  readJsonInputFile,
  splitFieldsDictionary,
  translateFieldErrors,
  type IssueJsonInput,
} from './input.js';
import { JIRA_INPUT_FILE_EXAMPLE, JIRA_INPUT_FILE_SCHEMA } from './input-schema.js';

/**
 * Commands on one issue: read it, create it, change it, move it through its
 * workflow, comment on it, log time against it, label, assign and link it.
 * Each write is gated twice by core before a request leaves, which is two
 * approvals fewer than the process it replaces and two more than it needs.
 */

const key = z.string().describe('Issue key, e.g. PROJ-123');
const keyOption = (description = 'Issue key') => ({ flags: '--key <issue-key>', field: 'key', description });

/** The --input-file, parsed and taken at its word, as the predecessor did; undefined when not given. */
function readIssueFile(path: string | undefined, ctx: client.JiraContext): IssueJsonInput | undefined {
  return path ? (readJsonInputFile(path, ctx.files) as IssueJsonInput) : undefined;
}

/**
 * The project for create-issue, in this order: --project, then "project" in
 * --input-file, then the dossier (#16; empty today), then the connection's
 * project, which is the predecessor's order with the dossier slotted in.
 * Core resolves the flag, the dossier and the connection; the file is read by
 * the command, so its step goes through ctx.supply, and meta.context reports
 * source `file`. The file's value is used as written, as the predecessor's `??`
 * used it: an empty one still wins and gets create-issue's own error.
 */
function projectFor(ctx: client.JiraContext, json: IssueJsonInput | undefined): string | undefined {
  if (ctx.resolved.inputs?.project?.source === 'input' || json?.project == null) return ctx.context.project;
  ctx.supply('project', String(json.project), 'file');
  return json.project;
}

function reportOverrides(ctx: client.JiraContext, overrides: string[]): void {
  if (overrides.length > 0) ctx.warn({ code: 'JIRA_INPUT_OVERRIDDEN', message: `--input-file value(s) overridden by flags: ${overrides.join(', ')}` });
}

/** Built-in and custom field values from --input-file, --fields-file and --field, flags winning. */
function gatherFields(
  ctx: client.JiraContext,
  input: { inputFile?: string | undefined; fieldsFile?: string | undefined; field?: string[] | undefined },
  flagBuiltin: Record<string, unknown>,
  fieldMap: ReturnType<typeof buildFieldMap>,
) {
  const json = readIssueFile(input.inputFile, ctx);
  const fromJson = json?.fields ? splitFieldsDictionary(json.fields, fieldMap, ctx.files) : { builtin: {}, custom: {} };
  const builtin = mergeWithOverrides(fromJson.builtin, flagBuiltin);
  const fileFields = input.fieldsFile ? parseFieldsFile(input.fieldsFile, fieldMap, ctx.files) : {};
  const custom = mergeWithOverrides(fromJson.custom, { ...fileFields, ...parseFieldArgs(input.field ?? [], fieldMap, ctx.files) });
  reportOverrides(ctx, [...builtin.overrides, ...custom.overrides]);
  return { json, builtin: builtin.merged, custom: custom.merged };
}

const defined = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));

const fieldOptions = [
  { flags: '--field <Name=value>', field: 'field', description: 'Custom field value; use Name=@file.json to read value from file (repeatable)' },
  { flags: '--fields-file <path>', field: 'fieldsFile', description: 'Path to a JSON file mapping field names/IDs to their Jira API values' },
];
const fieldInputs = {
  field: z.array(z.string()).optional().describe('Custom field values as "Name=value"; "Name=@file.json" reads the value from a file'),
  fieldsFile: z.string().optional().describe('Path to a JSON file mapping field names or ids to their Jira API values'),
};

export const getIssue = jiraArea.command({
  path: ['jira', 'get-issue'],
  description: 'Get a Jira issue by key',
  toolDescription:
    'Returns one Jira issue by key: every field, with registered custom fields under their friendly names. Use jira_search to find issues by JQL instead.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption('Issue key (e.g. PROJ-123)')],
  examples: [{ key: 'PROJ-123' }],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    const issue = await client.getIssue(ctx, input.key);
    return { ...issue, fields: translateFieldsInOutput(issue.fields, fieldMap) };
  },
});

export const createIssue = jiraArea.command({
  path: ['jira', 'create-issue'],
  description: 'Create a Jira issue',
  toolDescription:
    'Creates a Jira issue and returns it as Jira stores it. Project, issue type and priority fall back to the connection defaults. Custom fields go in field ("Name=value"). Does not check for duplicates: after a timeout, search for the summary before retrying.',
  input: z.object({
    issueType: z.string().optional().describe('Issue type (Bug, Story, Task, ...); defaults to the connection\'s issueType, then Task'),
    summary: z.string().optional().describe('Issue summary (required, unless supplied via inputFile)'),
    description: z.string().optional().describe('Issue description'),
    priority: z.string().optional().describe('Priority name'),
    assignee: z.string().optional().describe('Assignee username (Data Center usernames, not Cloud account ids)'),
    labels: z.string().optional().describe('Comma-separated labels'),
    parent: z.string().optional().describe('Parent issue key; sets fields.parent'),
    ...fieldInputs,
    inputFile: z.string().optional().describe('JSON file describing the whole issue ({ project, issueType, fields }); "-" = stdin on the CLI. Flags override matching keys.'),
    ...allowWriteField,
  }),
  writes: true,
  context: { project: 'optional' },
  options: [
    { flags: '--type <type>', field: 'issueType', description: 'Issue type (Bug, Story, Task, ...)' },
    { flags: '--summary <text>', field: 'summary', description: 'Issue summary (required, unless supplied via --input-file)' },
    { flags: '--description <text>', field: 'description', description: 'Issue description' },
    { flags: '--priority <name>', field: 'priority', description: 'Priority name' },
    { flags: '--assignee <username>', field: 'assignee', description: 'Assignee username' },
    { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels' },
    { flags: '--parent <key>', field: 'parent', description: 'Parent issue key — sets fields.parent in the create payload' },
    ...fieldOptions,
    {
      flags: '--input-file <path>',
      field: 'inputFile',
      description: "JSON file describing the whole issue ({ project, issueType, fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil jira schema",
    },
  ],
  examples: [
    {
      project: 'PROJ',
      issueType: 'Bug',
      summary: 'Login broken on Safari',
      description: 'Steps to reproduce are in the attached HAR.',
      priority: 'High',
      assignee: 'jsmith',
      labels: 'frontend,urgent',
      parent: 'PROJ-100',
      allowWrite: true,
    },
    { inputFile: 'issue.json', fieldsFile: 'fields.json', field: ['Story Points=5', 'customfield_10050=@ac.md'], priority: 'Low', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    try {
      const flags = defined({
        summary: input.summary,
        description: input.description,
        priority: input.priority,
        assignee: input.assignee,
        labels: input.labels,
        parent: input.parent,
      });
      const { json, builtin, custom } = gatherFields(ctx, input, flags, fieldMap);
      const project = projectFor(ctx, json);
      const issueType = input.issueType ?? json?.issueType ?? ctx.connection.issueType ?? 'Task';
      if (!project) {
        throw new ToilError('INVALID_INPUT', '--project required (or set defaults.jira.project in config, or "project" in --input-file)', {
          fix: 'Pass --project, put "project" in --input-file, or set defaults.jira.project in your toil config.',
        });
      }
      const summary = builtin.summary as string | undefined;
      if (!summary) throw new ToilError('INVALID_INPUT', 'Must specify --summary or "fields.summary" in --input-file', { fix: 'Pass --summary, or set "fields.summary" in --input-file.' });
      return await client.createIssue(ctx, {
        project,
        issueType,
        summary,
        description: builtin.description as string | undefined,
        priority: (builtin.priority as string | undefined) ?? ctx.connection.priority,
        assignee: builtin.assignee as string | undefined,
        labels: normalizeLabels(builtin.labels),
        parent: builtin.parent as string | undefined,
        customFieldValues: custom,
      });
    } catch (err) {
      throw translateFieldErrors(err, fieldMap);
    }
  },
});

export const updateIssue = jiraArea.command({
  path: ['jira', 'update-issue'],
  description: 'Update a Jira issue',
  toolDescription:
    'Changes fields on an existing Jira issue and returns { updated: key }. Only the fields you pass are sent. To add or remove single labels without replacing them all, use jira_add_label or jira_remove_label; to change status, use jira_transition_issue.',
  input: z.object({
    key,
    summary: z.string().optional().describe('New summary'),
    description: z.string().optional().describe('New description'),
    priority: z.string().optional().describe('New priority'),
    assignee: z.string().optional().describe('New assignee username'),
    labels: z.string().optional().describe('Comma-separated labels; replaces the issue\'s labels'),
    ...fieldInputs,
    inputFile: z.string().optional().describe('JSON file describing fields to update ({ fields }); "-" = stdin on the CLI. Flags override matching keys.'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    keyOption(),
    { flags: '--summary <text>', field: 'summary', description: 'New summary' },
    { flags: '--description <text>', field: 'description', description: 'New description' },
    { flags: '--priority <name>', field: 'priority', description: 'New priority' },
    { flags: '--assignee <username>', field: 'assignee', description: 'New assignee username' },
    { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels' },
    ...fieldOptions,
    {
      flags: '--input-file <path>',
      field: 'inputFile',
      description: "JSON file describing fields to update ({ fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil jira schema",
    },
  ],
  examples: [
    { key: 'PROJ-123', summary: 'Login broken on Safari 17', description: 'Narrowed down to 17.x.', priority: 'Highest', assignee: 'alice', labels: 'frontend', allowWrite: true },
    { key: 'PROJ-123', inputFile: 'update.json', fieldsFile: 'fields.json', field: ['Story Points=8'], allowWrite: true },
  ],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    try {
      const flags = defined({ summary: input.summary, description: input.description, priority: input.priority, assignee: input.assignee, labels: input.labels });
      const { builtin, custom } = gatherFields(ctx, input, flags, fieldMap);
      const fields = client.updateFields({
        summary: builtin.summary as string | undefined,
        description: builtin.description as string | undefined,
        priority: builtin.priority as string | undefined,
        assignee: builtin.assignee as string | undefined,
        labels: normalizeLabels(builtin.labels),
        customFieldValues: custom,
      });
      // Nothing to change still sends { fields: {} } and reports success, as the
      // predecessor did. Recorded as a suspected bug (#70), not changed.
      await client.updateIssue(ctx, input.key, fields);
      return { updated: input.key };
    } catch (err) {
      throw translateFieldErrors(err, fieldMap);
    }
  },
});

export const schema = jiraArea.command({
  path: ['jira', 'schema'],
  // Under jira's path, but it needs no connection: it answers with no config at all.
  kind: 'area-local',
  description: 'Print the --input-file JSON schema and an example for create-issue/update-issue',
  toolDescription:
    'Returns the JSON Schema and a runnable example for the inputFile accepted by jira_create_issue and jira_update_issue. Needs no Jira connection.',
  input: z.object({
    exampleOnly: z.boolean().optional().describe('Return only the runnable example as data, ready to save as an input file'),
  }),
  writes: false,
  options: [
    {
      flags: '--example-only',
      field: 'exampleOnly',
      description: 'Return only the runnable example JSON as data — save .data and pass it to --input-file',
    },
  ],
  examples: [{}, { exampleOnly: true }],
  run: async (input) => (input.exampleOnly ? JIRA_INPUT_FILE_EXAMPLE : { schema: JIRA_INPUT_FILE_SCHEMA, example: JIRA_INPUT_FILE_EXAMPLE }),
});

export const transitionIssue = jiraArea.command({
  path: ['jira', 'transition-issue'],
  description: 'Transition a Jira issue to a new status',
  toolDescription:
    'Moves a Jira issue through its workflow by transition name (case-insensitive) or id. Use jira_list_transitions to see which transitions the issue allows right now.',
  input: z.object({ key, transition: z.string().describe('Transition name or id'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--transition <name-or-id>', field: 'transition', description: 'Transition name or ID' }],
  examples: [
    { key: 'PROJ-123', transition: 'In Progress', allowWrite: true },
    { key: 'PROJ-123', transition: '31', allowWrite: true },
  ],
  run: async (input, ctx) => {
    let id = input.transition;
    if (!client.looksNumeric(input.transition)) {
      const transitions = await client.listTransitions(ctx, input.key);
      const found = transitions.find((t) => t.name.toLowerCase() === input.transition.toLowerCase());
      if (!found) {
        throw new ToilError('INVALID_INPUT', `Transition not found: ${input.transition}`, {
          fix: `Available from here: ${transitions.map((t) => t.name).join(', ') || '(none)'}. Run toil jira list-transitions --key ${input.key}.`,
        });
      }
      id = found.id;
    }
    await client.transitionIssue(ctx, input.key, id);
    return { transitioned: input.key, transition: input.transition };
  },
});

export const listTransitions = jiraArea.command({
  path: ['jira', 'list-transitions'],
  description: 'List available transitions for an issue',
  toolDescription: 'Returns the workflow transitions currently available on a Jira issue (id, name, target status). Use before jira_transition_issue.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption()],
  examples: [{ key: 'PROJ-123' }],
  run: (input, ctx) => client.listTransitions(ctx, input.key),
});

export const addComment = jiraArea.command({
  path: ['jira', 'add-comment'],
  description: 'Add a comment to a Jira issue',
  toolDescription: 'Adds a comment to a Jira issue and returns the comment Jira created.',
  input: z.object({ key, body: z.string().describe('Comment text (Jira wiki markup)'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--body <text>', field: 'body', description: 'Comment text' }],
  examples: [{ key: 'PROJ-123', body: 'Reproduced on staging.', allowWrite: true }],
  run: (input, ctx) => client.addComment(ctx, input.key, input.body),
});

export const logWork = jiraArea.command({
  path: ['jira', 'log-work'],
  description: 'Add a worklog (time spent) entry to a Jira issue',
  toolDescription: 'Logs time against a Jira issue and returns the worklog Jira created. timeSpent uses Jira durations ("2h 30m", "1d").',
  input: z.object({
    key,
    timeSpent: z.string().describe('Time spent in Jira duration format, e.g. "2h 30m", "1d"'),
    comment: z.string().optional().describe('Worklog comment'),
    started: z.string().optional().describe('When the work started, e.g. 2024-01-15T09:00:00.000+0000; defaults to now'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    keyOption(),
    { flags: '--time-spent <duration>', field: 'timeSpent', description: 'Time spent in Jira duration format (e.g. "2h 30m", "1d")' },
    { flags: '--comment <text>', field: 'comment', description: 'Worklog comment' },
    { flags: '--started <datetime>', field: 'started', description: 'When the work started, in Jira datetime format (e.g. 2024-01-15T09:00:00.000+0000); defaults to now' },
  ],
  examples: [
    { key: 'PROJ-123', timeSpent: '2h 30m', allowWrite: true },
    { key: 'PROJ-123', timeSpent: '1d', comment: 'Investigated the failing build', started: '2024-01-15T09:00:00.000+0000', allowWrite: true },
  ],
  run: (input, ctx) => client.addWorklog(ctx, input.key, input),
});

export const listComments = jiraArea.command({
  path: ['jira', 'list-comments'],
  description: 'List comments on a Jira issue',
  toolDescription: 'Returns every comment on a Jira issue, oldest first, paging through all of them.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption()],
  examples: [{ key: 'PROJ-123' }],
  run: (input, ctx) => client.listComments(ctx, input.key),
});

const labelsInput = (verb: string) => z.string().describe(`Comma-separated labels to ${verb}`);

/** An empty list is still sent (an update with no operations), as before. */
const labelList = (raw: string): string[] => commaList(raw);

export const addLabel = jiraArea.command({
  path: ['jira', 'add-label'],
  description: 'Add one or more labels to a Jira issue (non-destructive)',
  toolDescription: "Adds labels to a Jira issue, keeping the ones it has. Returns { updated, labelsAdded }. jira_update_issue's labels replaces them all instead.",
  input: z.object({ key, labels: labelsInput('add'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels to add' }],
  examples: [{ key: 'PROJ-123', labels: 'backend,urgent', allowWrite: true }],
  run: async (input, ctx) => {
    const labels = labelList(input.labels);
    await client.addLabels(ctx, input.key, labels);
    return { updated: input.key, labelsAdded: labels };
  },
});

export const removeLabel = jiraArea.command({
  path: ['jira', 'remove-label'],
  description: 'Remove one or more labels from a Jira issue (non-destructive)',
  toolDescription: 'Removes labels from a Jira issue, keeping the rest. Returns { updated, labelsRemoved }.',
  input: z.object({ key, labels: labelsInput('remove'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels to remove' }],
  examples: [{ key: 'PROJ-123', labels: 'urgent', allowWrite: true }],
  run: async (input, ctx) => {
    const labels = labelList(input.labels);
    await client.removeLabels(ctx, input.key, labels);
    return { updated: input.key, labelsRemoved: labels };
  },
});

export const assign = jiraArea.command({
  path: ['jira', 'assign'],
  description: 'Assign a Jira issue to a user',
  toolDescription: 'Assigns a Jira issue to a user by Data Center username. Returns { assigned, assignee }.',
  input: z.object({ key, assignee: z.string().describe('Assignee username'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--assignee <username>', field: 'assignee', description: 'Assignee username' }],
  examples: [{ key: 'PROJ-123', assignee: 'jsmith', allowWrite: true }],
  run: async (input, ctx) => {
    await client.assignIssue(ctx, input.key, input.assignee);
    return { assigned: input.key, assignee: input.assignee };
  },
});

export const linkIssue = jiraArea.command({
  path: ['jira', 'link-issue'],
  description: 'Link two Jira issues together',
  toolDescription:
    'Links two Jira issues: key is the inward issue, target the outward one. linkType is a link type id, name ("Blocks") or either phrase ("is blocked by"). Returns { linked, to, type }.',
  input: z.object({
    key: z.string().describe('Source issue key'),
    linkType: z.string().describe('Link type name, inward or outward phrase, or id'),
    target: z.string().describe('Target issue key'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    keyOption('Source issue key'),
    { flags: '--link-type <type>', field: 'linkType', description: 'Link type name or ID' },
    { flags: '--target <issue-key>', field: 'target', description: 'Target issue key' },
  ],
  examples: [
    { key: 'PROJ-123', linkType: 'Blocks', target: 'PROJ-456', allowWrite: true },
    { key: 'PROJ-123', linkType: '10000', target: 'PROJ-456', allowWrite: true },
  ],
  run: async (input, ctx) => {
    await client.linkIssue(ctx, input);
    return { linked: input.key, to: input.target, type: input.linkType };
  },
});

export const issueCommands = [getIssue, createIssue, updateIssue, schema, transitionIssue, listTransitions, addComment, logWork, listComments, addLabel, removeLabel, assign, linkIssue];
