import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { confluenceArea } from './area.js';
import * as client from './client.js';

/**
 * Comments and labels on a page. Labels are added as `global` ones, which is
 * the only prefix most people know exists; the others are a matter for the
 * labelling working group.
 */

const id = z.string().describe('Page ID');
const idOption = { flags: '--id <page-id>', field: 'id', description: 'Page ID' };

export const listComments = confluenceArea.command({
  path: ['confluence', 'list-comments'],
  description: 'List comments on a Confluence page',
  toolDescription: 'Returns the comments on a Confluence page, each with its storage-format body and version. Only top-level comments: replies are not included.',
  input: z.object({ id }),
  writes: false,
  options: [idOption],
  examples: [{ id: '12345' }],
  run: (input, ctx) => client.listComments(ctx, input.id),
});

export const addComment = confluenceArea.command({
  path: ['confluence', 'add-comment'],
  description: 'Add a comment to a Confluence page',
  input: z.object({
    id,
    body: z.string().describe('Comment body (storage format HTML)'),
    representation: z.string().optional().describe('Body format: storage (default) or wiki (default: "storage")'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    idOption,
    { flags: '--body <text>', field: 'body', description: 'Comment body (storage format HTML)' },
    { flags: '--representation <format>', field: 'representation', description: 'Body format: storage (default) or wiki (default: "storage")' },
  ],
  examples: [
    { id: '12345', body: '<p>Reviewed.</p>', allowWrite: true },
    { id: '12345', body: 'Reviewed, *approved*.', representation: 'wiki', allowWrite: true },
  ],
  run: (input, ctx) => client.addComment(ctx, input.id, input.body, input.representation ?? 'storage'),
});

export const getLabels = confluenceArea.command({
  path: ['confluence', 'get-labels'],
  description: 'Get labels on a Confluence page',
  input: z.object({ id }),
  writes: false,
  options: [idOption],
  examples: [{ id: '12345' }],
  run: (input, ctx) => client.getLabels(ctx, input.id),
});

export const addLabel = confluenceArea.command({
  path: ['confluence', 'add-label'],
  description: 'Add labels to a Confluence page',
  input: z.object({ id, labels: z.string().describe('Comma-separated label names'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--labels <names>', field: 'labels', description: 'Comma-separated label names' }],
  examples: [{ id: '12345', labels: 'runbook, ops,', allowWrite: true }],
  run: (input, ctx) =>
    client.addLabels(
      ctx,
      input.id,
      input.labels.split(',').map((s) => s.trim()).filter(Boolean),
    ),
});

export const removeLabel = confluenceArea.command({
  path: ['confluence', 'remove-label'],
  description: 'Remove a label from a Confluence page',
  input: z.object({ id, label: z.string().describe('Label name to remove'), ...allowWriteField }),
  writes: true,
  options: [idOption, { flags: '--label <name>', field: 'label', description: 'Label name to remove' }],
  examples: [{ id: '12345', label: 'runbook', allowWrite: true }],
  run: async (input, ctx) => {
    await client.removeLabel(ctx, input.id, input.label);
    return { removed: input.label, from: input.id };
  },
});

export const discussionCommands = [listComments, addComment, getLabels, addLabel, removeLabel];
