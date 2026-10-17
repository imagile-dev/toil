import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { adfToText, textToAdf } from './adf.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';

/**
 * Commands on one Jira Cloud issue: read it, create it, change it, move it
 * through its workflow, comment on it, label, assign and link it. Names and
 * flags are `jira`'s wherever the operation is the same; people are accountIds
 * and rich text is converted to and from ADF (see adf.ts). Every write is gated
 * twice by core, which by local standards counts as an expedited approval.
 */

const key = z.string().min(1).describe('Issue key, e.g. PROJ-123');
const keyOption = (description = 'Issue key') => ({ flags: '--key <issue-key>', field: 'key', description });
const accountId = (what: string) => z.string().min(1).describe(`${what} accountId (from jira-cloud search-users), not a username`);

/** A comma-separated flag as a list, empty entries dropped. */
export const commaList = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The issue as Jira returned it, plus its description as plain text. */
export function withDescriptionText(issue: client.JiraCloudIssue): client.JiraCloudIssue & { descriptionText: string | null } {
  return { ...issue, descriptionText: adfToText(issue.fields?.description) };
}

/** A comment as Jira returned it, plus its body as plain text. */
export const withBodyText = (comment: Record<string, unknown>) => ({ ...comment, bodyText: adfToText(comment.body) });

export const getIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'get-issue'],
  description: 'Get a Jira Cloud issue by key',
  toolDescription:
    'Returns one Jira Cloud issue by key with every field as Jira returns it (description in Atlassian Document Format), plus descriptionText, the description as plain text. Use jira_cloud_search to find issues by JQL.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption('Issue key (e.g. PROJ-123)')],
  examples: [{ key: 'PROJ-123' }],
  run: async (input, ctx) => withDescriptionText(await client.getIssue(ctx, input.key)),
});

export const createIssue = jiraCloudArea.command({
  path: ['jira-cloud', 'create-issue'],
  description: 'Create a Jira Cloud issue',
  toolDescription:
    "Creates a Jira Cloud issue and returns it as Jira stores it, plus descriptionText. Project, issue type and priority fall back to the connection defaults. description is plain text, sent as ADF paragraphs; Markdown is not interpreted. assignee is an accountId. Does not check for duplicates: after a timeout, search for the summary before retrying.",
  input: z.object({
    issueType: z.string().min(1).optional().describe("Issue type (Bug, Story, Task, ...); defaults to the connection's issueType, then Task"),
    summary: z.string().min(1).describe('Issue summary'),
    description: z.string().optional().describe('Description as plain text: blank lines separate paragraphs; sent as ADF'),
    priority: z.string().min(1).optional().describe('Priority name'),
    assignee: accountId('Assignee').optional(),
    labels: z.string().optional().describe('Comma-separated labels'),
    parent: z.string().min(1).optional().describe('Parent issue key; sets fields.parent'),
    ...allowWriteField,
  }),
  writes: true,
  context: { project: 'required' },
  options: [
    { flags: '--type <type>', field: 'issueType', description: 'Issue type (Bug, Story, Task, ...)' },
    { flags: '--summary <text>', field: 'summary', description: 'Issue summary' },
    { flags: '--description <text>', field: 'description', description: 'Description as plain text (blank lines separate paragraphs)' },
    { flags: '--priority <name>', field: 'priority', description: 'Priority name' },
    { flags: '--assignee <account-id>', field: 'assignee', description: 'Assignee accountId (from search-users)' },
    { flags: '--labels <labels>', field: 'labels', description: 'Comma-separated labels' },
    { flags: '--parent <key>', field: 'parent', description: 'Parent issue key — sets fields.parent in the create payload' },
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
  ],
  run: async (input, ctx) => {
    const issue = await client.createIssue(ctx, {
      project: ctx.context.project!,
      issueType: input.issueType ?? ctx.connection.issueType ?? 'Task',
      summary: input.summary,
      description: input.description,
      priority: input.priority ?? ctx.connection.priority,
      assignee: input.assignee,
      labels: input.labels === undefined ? undefined : commaList(input.labels),
      parent: input.parent,
    });
    return withDescriptionText(issue);
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
  ],
  examples: [{ key: 'PROJ-123', summary: 'Login broken on Safari 17', description: 'Narrowed down to 17.x.', priority: 'Highest', assignee: '5b10ac8d82e05b22cc7d4ef5', labels: 'frontend', allowWrite: true }],
  run: async (input, ctx) => {
    const fields = client.issueFields({ ...input, labels: input.labels === undefined ? undefined : commaList(input.labels) });
    if (Object.keys(fields).length === 0) {
      throw new ToilError('INVALID_INPUT', 'Nothing to update: pass at least one of --summary, --description, --priority, --assignee or --labels.', {
        fix: 'Pass the fields to change, e.g. --summary "New summary".',
      });
    }
    await client.editIssue(ctx, input.key, { fields });
    return { updated: input.key };
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

export const issueCommands = [getIssue, createIssue, updateIssue, transitionIssue, listTransitions, addComment, listComments, addLabel, removeLabel, assign, linkIssue];
