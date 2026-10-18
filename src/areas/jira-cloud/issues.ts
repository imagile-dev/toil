import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { adfToText, textToAdf, type AdfDocument } from './adf.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';
import { buildFieldMap, translateFieldsInOutput, withAliases } from './custom-fields.js';
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
import { JIRA_CLOUD_INPUT_FILE_EXAMPLE, JIRA_CLOUD_INPUT_FILE_SCHEMA } from './input-schema.js';

/**
 * Commands on one Jira Cloud issue: read it, create it, change it, move it
 * through its workflow, comment on it, log time, label, assign and link it.
 * Names and flags are `jira`'s wherever the operation is the same; people are
 * accountIds and rich text is converted to and from ADF (see adf.ts). Every
 * write is gated twice by core, which by local standards counts as an
 * expedited approval.
 */

const key = z.string().min(1).describe('Issue key, e.g. PROJ-123');
const keyOption = (description = 'Issue key') => ({ flags: '--key <issue-key>', field: 'key', description });
const accountId = (what: string) => z.string().min(1).describe(`${what} accountId (from jira-cloud search-users), not a username`);

/** The issue as Jira returned it, plus its description as plain text. */
export function withDescriptionText(issue: client.JiraCloudIssue): client.JiraCloudIssue & { descriptionText: string | null } {
  return { ...issue, descriptionText: adfToText(issue.fields?.description) };
}

/** A comment as Jira returned it, plus its body as plain text. */
export const withBodyText = (comment: Record<string, unknown>) => ({ ...comment, bodyText: adfToText(comment.body) });

/** The --input-file, parsed and taken at its word; undefined when not given. */
function readIssueFile(path: string | undefined, ctx: client.JiraCloudContext): IssueJsonInput | undefined {
  return path ? (readJsonInputFile(path, ctx.files) as IssueJsonInput) : undefined;
}

/**
 * The project for create-issue: --project, then "project" in --input-file,
 * then the dossier, then the connection's project. Core
 * resolves the flag, the dossier and the connection; the file's step goes
 * through ctx.supply, so meta.context reports source `file`. An empty value
 * in the file counts as none.
 */
function projectFor(ctx: client.JiraCloudContext, json: IssueJsonInput | undefined): string | undefined {
  if (ctx.resolved.inputs?.project?.source === 'input' || json?.project == null || String(json.project) === '') return ctx.context.project;
  return ctx.supply('project', String(json.project), 'file');
}

/** Built-in and custom field values from --input-file, --fields-file and --field, flags winning and reported. */
function gatherFields(
  ctx: client.JiraCloudContext,
  input: { inputFile?: string | undefined; fieldsFile?: string | undefined; field?: string[] | undefined },
  flagBuiltin: Record<string, unknown>,
  fieldMap: ReturnType<typeof buildFieldMap>,
) {
  const json = readIssueFile(input.inputFile, ctx);
  const fromJson = json?.fields ? splitFieldsDictionary(json.fields, fieldMap, ctx.files) : { builtin: {}, custom: {} };
  const builtin = mergeWithOverrides(fromJson.builtin, flagBuiltin);
  const fileFields = input.fieldsFile ? parseFieldsFile(input.fieldsFile, fieldMap, ctx.files) : {};
  const custom = mergeWithOverrides(fromJson.custom, { ...fileFields, ...parseFieldArgs(input.field ?? [], fieldMap, ctx.files) });
  const overrides = [...builtin.overrides, ...custom.overrides];
  if (overrides.length > 0) ctx.warn({ code: 'JIRA_CLOUD_INPUT_OVERRIDDEN', message: `--input-file value(s) overridden by flags: ${overrides.join(', ')}` });
  return { json, builtin: builtin.merged, custom: custom.merged };
}

const defined = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));

/** A description from a flag or file: plain text, or an ADF document object from the file. Anything else is refused. */
function description(value: unknown): string | AdfDocument | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && (value as { type?: unknown }).type === 'doc') return value as AdfDocument;
  throw new ToilError('INVALID_INPUT', 'fields.description in --input-file must be text or an ADF document ({ "type": "doc", ... }).', {
    fix: 'Run toil jira-cloud schema for the expected shape.',
  });
}

/** A text field from a flag or file; a file value that isn't text is refused rather than sent as "[object Object]". */
function text(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  throw new ToilError('INVALID_INPUT', `${name} in --input-file must be text.`, { fix: 'Run toil jira-cloud schema for the expected shape.' });
}

const fieldOptions = [
  { flags: '--field <Name=value>', field: 'field', description: 'Custom field value; use Name=@file.json to read value from file (repeatable)' },
  { flags: '--fields-file <path>', field: 'fieldsFile', description: 'Path to a JSON file mapping field names/IDs to their Jira API values' },
];
const fieldInputs = {
  field: z.array(z.string()).optional().describe('Custom field values as "Name=value"; "Name=@file.json" reads the value from a file'),
  fieldsFile: z.string().optional().describe('Path to a JSON file mapping field names or ids to their Jira API values'),
};

export const getIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'get-issue'],
  description: 'Get a Jira Cloud issue by key',
  toolDescription:
    'Returns one Jira Cloud issue by key with every field as Jira returns it (description in Atlassian Document Format, registered custom fields under their friendly names), plus descriptionText, the description as plain text. Use jira_cloud_search to find issues by JQL.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption('Issue key (e.g. PROJ-123)')],
  examples: [{ key: 'PROJ-123' }],
  run: async (input, ctx) => {
    const fieldMap = buildFieldMap(ctx.connection.customFields);
    const issue = await client.getIssue(ctx, input.key);
    return { ...withDescriptionText(issue), fields: translateFieldsInOutput(issue.fields, fieldMap) };
  },
});

export const createIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'create-issue'],
  description: 'Create a Jira Cloud issue',
  toolDescription:
    'Creates a Jira Cloud issue and returns it as Jira stores it, plus descriptionText. Project, issue type and priority fall back to the connection defaults. description is plain text, sent as ADF paragraphs; Markdown is not interpreted. assignee is an accountId. Custom fields go in field ("Name=value"). Does not check for duplicates: after a timeout, search for the summary before retrying.',
  input: z.object({
    issueType: z.string().min(1).optional().describe("Issue type (Bug, Story, Task, ...); defaults to the connection's issueType, then Task"),
    summary: z.string().min(1).optional().describe('Issue summary (required, unless supplied via inputFile)'),
    description: z.string().optional().describe('Description as plain text: blank lines separate paragraphs; sent as ADF'),
    priority: z.string().min(1).optional().describe('Priority name'),
    assignee: accountId('Assignee').optional(),
    labels: z.string().optional().describe('Comma-separated labels'),
    parent: z.string().min(1).optional().describe('Parent issue key; sets fields.parent'),
    ...fieldInputs,
    inputFile: z.string().optional().describe('JSON file describing the whole issue ({ project, issueType, fields }); "-" = stdin on the CLI. Flags override matching keys.'),
    ...allowWriteField,
  }),
  writes: true,
  context: { project: 'optional' },
  options: [
    { flags: '--type <type>', field: 'issueType', description: 'Issue type (Bug, Story, Task, ...)' },
    { flags: '--summary <text>', field: 'summary', description: 'Issue summary (required, unless supplied via --input-file)' },
    { flags: '--description <text>', field: 'description', description: 'Description as plain text (blank lines separate paragraphs)' },
    { flags: '--priority <name>', field: 'priority', description: 'Priority name' },
    { flags: '--assignee <account-id>', field: 'assignee', description: 'Assignee accountId (from search-users)' },
    { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels' },
    { flags: '--parent <key>', field: 'parent', description: 'Parent issue key — sets fields.parent in the create payload' },
    ...fieldOptions,
    {
      flags: '--input-file <path>',
      field: 'inputFile',
      description: "JSON file describing the whole issue ({ project, issueType, fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil jira-cloud schema",
    },
  ],
  examples: [
    {
      project: 'PROJ',
      issueType: 'Bug',
      summary: 'Login broken on Safari',
      description: 'Steps to reproduce:\nOpen the login page in Safari.\n\nThe button does nothing.',
      priority: 'High',
      assignee: '5b10ac8d82e05b22cc7d4ef5',
      labels: 'frontend,urgent',
      parent: 'PROJ-100',
      allowWrite: true,
    },
    { summary: 'Tidy the release checklist', allowWrite: true },
    { inputFile: 'issue.json', fieldsFile: 'fields.json', field: ['Story Points=5', 'Reviewer=5b10ac8d82e05b22cc7d4ef5'], priority: 'Low', allowWrite: true },
  ],
  run: async (input, ctx) => {
    // A dossier's field aliases join the connection's names, only when the call names a field (src/core/dossier.ts).
    const fieldMap = withAliases(buildFieldMap(ctx.connection.customFields), input.field?.length ? ctx.dossierFields() : {});
    try {
      const flags = defined({ summary: input.summary, description: input.description, priority: input.priority, assignee: input.assignee, labels: input.labels, parent: input.parent });
      const { json, builtin, custom } = gatherFields(ctx, input, flags, fieldMap);
      const project = projectFor(ctx, json);
      if (!project) {
        throw new ToilError('INVALID_INPUT', 'No project for create-issue.', {
          fix: `Pass --project, put "project" in --input-file, or set project on the connection (${jiraCloudArea.envName('project')} for the default connection).`,
        });
      }
      const summary = text('fields.summary', builtin.summary);
      if (!summary) throw new ToilError('INVALID_INPUT', 'Must specify --summary or "fields.summary" in --input-file', { fix: 'Pass --summary, or set "fields.summary" in --input-file.' });
      const issue = await client.createIssue(ctx, {
        project,
        issueType: input.issueType ?? text('issueType', json?.issueType) ?? ctx.connection.issueType ?? 'Task',
        summary,
        description: description(builtin.description),
        priority: text('fields.priority', builtin.priority) ?? ctx.connection.priority,
        assignee: text('fields.assignee', builtin.assignee),
        labels: normalizeLabels(builtin.labels),
        parent: text('fields.parent', builtin.parent),
        customFieldValues: custom,
      });
      return { ...withDescriptionText(issue), fields: translateFieldsInOutput(issue.fields, fieldMap) };
    } catch (err) {
      throw translateFieldErrors(err, fieldMap);
    }
  },
});

export const updateIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'update-issue'],
  description: 'Update a Jira Cloud issue',
  toolDescription:
    'Changes fields on an existing Jira Cloud issue and returns { updated: key }. Only the fields you pass are sent. description is plain text, sent as ADF; assignee is an accountId. labels replaces every label; use jira_cloud_add_label or jira_cloud_remove_label for one at a time, and jira_cloud_transition_issue to change status.',
  input: z.object({
    key,
    summary: z.string().min(1).optional().describe('New summary'),
    description: z.string().min(1).optional().describe('New description as plain text; sent as ADF'),
    priority: z.string().min(1).optional().describe('New priority'),
    assignee: accountId('New assignee').optional(),
    labels: z.string().optional().describe("Comma-separated labels; replaces the issue's labels"),
    ...fieldInputs,
    inputFile: z.string().optional().describe('JSON file describing fields to update ({ fields }); "-" = stdin on the CLI. Flags override matching keys.'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    keyOption(),
    { flags: '--summary <text>', field: 'summary', description: 'New summary' },
    { flags: '--description <text>', field: 'description', description: 'New description as plain text' },
    { flags: '--priority <name>', field: 'priority', description: 'New priority' },
    { flags: '--assignee <account-id>', field: 'assignee', description: 'New assignee accountId' },
    { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels' },
    ...fieldOptions,
    {
      flags: '--input-file <path>',
      field: 'inputFile',
      description: "JSON file describing fields to update ({ fields: {...} }); '-' = stdin. CLI flags override matching keys. See: toil jira-cloud schema",
    },
  ],
  examples: [
    { key: 'PROJ-123', summary: 'Login broken on Safari 17', description: 'Narrowed down to 17.x.', priority: 'Highest', assignee: '5b10ac8d82e05b22cc7d4ef5', labels: 'frontend', allowWrite: true },
    { key: 'PROJ-123', inputFile: 'update.json', fieldsFile: 'fields.json', field: ['Story Points=8'], allowWrite: true },
  ],
  run: async (input, ctx) => {
    // A dossier's field aliases join the connection's names, only when the call names a field (src/core/dossier.ts).
    const fieldMap = withAliases(buildFieldMap(ctx.connection.customFields), input.field?.length ? ctx.dossierFields() : {});
    try {
      const flags = defined({ summary: input.summary, description: input.description, priority: input.priority, assignee: input.assignee, labels: input.labels });
      const { builtin, custom } = gatherFields(ctx, input, flags, fieldMap);
      const fields = client.issueFields({
        summary: text('fields.summary', builtin.summary),
        description: description(builtin.description),
        priority: text('fields.priority', builtin.priority),
        assignee: text('fields.assignee', builtin.assignee),
        labels: normalizeLabels(builtin.labels),
        customFieldValues: custom,
      });
      if (Object.keys(fields).length === 0) {
        throw new ToilError('INVALID_INPUT', 'Nothing to update: pass at least one field to change.', {
          fix: 'Pass --summary, --description, --priority, --assignee, --labels, --field, --fields-file or --input-file.',
        });
      }
      await client.editIssue(ctx, input.key, { fields });
      return { updated: input.key };
    } catch (err) {
      throw translateFieldErrors(err, fieldMap);
    }
  },
});

export const schema = jiraCloudArea.command({
  path: ['jira-cloud', 'schema'],
  // Under jira-cloud's path, but it needs no connection: it answers with no config at all.
  kind: 'area-local',
  description: 'Print the --input-file JSON schema and an example for create-issue/update-issue',
  toolDescription: 'Returns the JSON Schema and a runnable example for the inputFile accepted by jira_cloud_create_issue and jira_cloud_update_issue. Needs no Jira Cloud connection.',
  input: z.object({ exampleOnly: z.boolean().optional().describe('Return only the runnable example as data, ready to save as an input file') }),
  writes: false,
  options: [{ flags: '--example-only', field: 'exampleOnly', description: 'Return only the runnable example JSON as data — save .data and pass it to --input-file' }],
  examples: [{}, { exampleOnly: true }],
  run: async (input) => (input.exampleOnly ? JIRA_CLOUD_INPUT_FILE_EXAMPLE : { schema: JIRA_CLOUD_INPUT_FILE_SCHEMA, example: JIRA_CLOUD_INPUT_FILE_EXAMPLE }),
});

export const logWork = jiraCloudArea.command({
  path: ['jira-cloud', 'log-work'],
  description: 'Add a worklog (time spent) entry to a Jira Cloud issue',
  toolDescription:
    'Logs time against a Jira Cloud issue and returns the worklog Jira created, plus commentText. timeSpent uses Jira durations ("2h 30m", "1d"); started is required on Cloud. comment is plain text, sent as ADF.',
  input: z.object({
    key,
    timeSpent: z.string().min(1).describe('Time spent in Jira duration format, e.g. "2h 30m", "1d"'),
    started: z.string().min(1).describe('When the work started, e.g. 2026-01-15T09:00:00.000+0000 (required by Jira Cloud)'),
    comment: z.string().optional().describe('Worklog comment as plain text; sent as ADF'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    keyOption(),
    { flags: '--time-spent <duration>', field: 'timeSpent', description: 'Time spent in Jira duration format (e.g. "2h 30m", "1d")' },
    { flags: '--started <datetime>', field: 'started', description: 'When the work started, in Jira datetime format (e.g. 2026-01-15T09:00:00.000+0000)' },
    { flags: '--comment <text>', field: 'comment', description: 'Worklog comment (plain text)' },
  ],
  examples: [
    { key: 'PROJ-123', timeSpent: '2h 30m', started: '2026-01-15T09:00:00.000+0000', allowWrite: true },
    { key: 'PROJ-123', timeSpent: '1d', started: '2026-01-15T09:00:00.000+0000', comment: 'Investigated the failing build', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const worklog = await client.addWorklog(ctx, input.key, input);
    return { ...worklog, commentText: adfToText(worklog.comment) };
  },
});

export const transitionIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'transition-issue'],
  description: 'Transition a Jira Cloud issue to a new status',
  toolDescription:
    'Moves a Jira Cloud issue through its workflow by transition name (case-insensitive) or numeric id. Use jira_cloud_list_transitions to see which transitions the issue allows right now.',
  input: z.object({ key, transition: z.string().min(1).describe('Transition name or id'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--transition <name-or-id>', field: 'transition', description: 'Transition name or ID' }],
  examples: [
    { key: 'PROJ-123', transition: 'In Progress', allowWrite: true },
    { key: 'PROJ-123', transition: '31', allowWrite: true },
  ],
  run: async (input, ctx) => {
    let id = input.transition;
    if (!/^\d+$/.test(input.transition)) {
      const transitions = await client.listTransitions(ctx, input.key);
      const found = transitions.find((t) => t.name.toLowerCase() === input.transition.toLowerCase());
      if (!found) {
        throw new ToilError('INVALID_INPUT', `Transition not found: ${input.transition}`, {
          fix: `Available from here: ${transitions.map((t) => t.name).join(', ') || '(none)'}. Run toil jira-cloud list-transitions --key ${input.key}.`,
        });
      }
      id = found.id;
    }
    await client.transitionIssue(ctx, input.key, id);
    return { transitioned: input.key, transition: input.transition };
  },
});

export const listTransitions = jiraCloudArea.command({
  path: ['jira-cloud', 'list-transitions'],
  description: 'List available transitions for an issue',
  toolDescription: 'Returns the workflow transitions currently available on a Jira Cloud issue (id, name, target status). Use before jira_cloud_transition_issue.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption()],
  examples: [{ key: 'PROJ-123' }],
  run: (input, ctx) => client.listTransitions(ctx, input.key),
});

export const addComment = jiraCloudArea.command({
  path: ['jira-cloud', 'add-comment'],
  description: 'Add a comment to a Jira Cloud issue',
  toolDescription: 'Adds a plain-text comment to a Jira Cloud issue (sent as ADF paragraphs; Markdown is not interpreted) and returns the comment Jira created, plus bodyText.',
  input: z.object({ key, body: z.string().min(1).describe('Comment as plain text: blank lines separate paragraphs'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--body <text>', field: 'body', description: 'Comment text (plain text)' }],
  examples: [{ key: 'PROJ-123', body: 'Reproduced on staging.', allowWrite: true }],
  run: async (input, ctx) => {
    if (input.body.trim() === '') throw new ToilError('INVALID_INPUT', '--body is blank.', { fix: 'Pass the comment text in --body.' });
    return withBodyText(await client.addComment(ctx, input.key, textToAdf(input.body)));
  },
});

export const listComments = jiraCloudArea.command({
  path: ['jira-cloud', 'list-comments'],
  description: 'List comments on a Jira Cloud issue',
  toolDescription: 'Returns every comment on a Jira Cloud issue, oldest first, each with its ADF body and bodyText, the body as plain text.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption()],
  examples: [{ key: 'PROJ-123' }],
  run: async (input, ctx) => (await client.listComments(ctx, input.key)).map(withBodyText),
});

const labelsInput = (verb: string) => z.string().describe(`Comma-separated labels to ${verb}`);

/** At least one label: an edit with no operations would report success for doing nothing. */
function labelList(raw: string): string[] {
  const labels = commaList(raw);
  if (labels.length === 0) throw new ToilError('INVALID_INPUT', '--labels names no label.', { fix: 'Pass --labels backend,urgent.' });
  return labels;
}

export const addLabel = jiraCloudArea.command({
  path: ['jira-cloud', 'add-label'],
  description: 'Add one or more labels to a Jira Cloud issue (non-destructive)',
  toolDescription: "Adds labels to a Jira Cloud issue, keeping the ones it has. Returns { updated, labelsAdded }. jira_cloud_update_issue's labels replaces them all instead.",
  input: z.object({ key, labels: labelsInput('add'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels to add' }],
  examples: [{ key: 'PROJ-123', labels: 'backend,urgent', allowWrite: true }],
  run: async (input, ctx) => {
    const labels = labelList(input.labels);
    await client.changeLabels(ctx, input.key, 'add', labels);
    return { updated: input.key, labelsAdded: labels };
  },
});

export const removeLabel = jiraCloudArea.command({
  path: ['jira-cloud', 'remove-label'],
  description: 'Remove one or more labels from a Jira Cloud issue (non-destructive)',
  toolDescription: 'Removes labels from a Jira Cloud issue, keeping the rest. Returns { updated, labelsRemoved }.',
  input: z.object({ key, labels: labelsInput('remove'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels to remove' }],
  examples: [{ key: 'PROJ-123', labels: 'urgent', allowWrite: true }],
  run: async (input, ctx) => {
    const labels = labelList(input.labels);
    await client.changeLabels(ctx, input.key, 'remove', labels);
    return { updated: input.key, labelsRemoved: labels };
  },
});

export const assign = jiraCloudArea.command({
  path: ['jira-cloud', 'assign'],
  description: 'Assign a Jira Cloud issue to a user by accountId',
  toolDescription: 'Assigns a Jira Cloud issue to a user by accountId (find one with jira_cloud_search_users). Returns { assigned, assignee }.',
  input: z.object({ key, assignee: accountId('Assignee'), ...allowWriteField }),
  writes: true,
  options: [keyOption(), { flags: '--assignee <account-id>', field: 'assignee', description: 'Assignee accountId (from search-users)' }],
  examples: [{ key: 'PROJ-123', assignee: '5b10ac8d82e05b22cc7d4ef5', allowWrite: true }],
  run: async (input, ctx) => {
    await client.assignIssue(ctx, input.key, input.assignee);
    return { assigned: input.key, assignee: input.assignee };
  },
});

export const linkIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'link-issue'],
  description: 'Link two Jira Cloud issues together',
  toolDescription:
    'Links two Jira Cloud issues: key is the inward issue, target the outward one. linkType is a link type id, name ("Blocks") or either phrase ("is blocked by"). Returns { linked, to, type }.',
  input: z.object({
    key: z.string().min(1).describe('Source issue key'),
    linkType: z.string().min(1).describe('Link type name, inward or outward phrase, or id'),
    target: z.string().min(1).describe('Target issue key'),
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

export const issueCommands = [getIssue, createIssue, updateIssue, schema, transitionIssue, listTransitions, addComment, listComments, logWork, addLabel, removeLabel, assign, linkIssue];
