import { z } from 'zod';
import { allowWriteField } from '../../../core/run.js';
import { confluenceArea } from '../area.js';
import * as client from './client.js';
import { withBodyText } from './storage.js';

/**
 * Comments and labels on a page. Comments are footer comments, the ones at
 * the bottom of the page; inline comments are anchored to a highlighted
 * passage and have been left with the highlighter. Labels are added as
 * `global`, through v1, because v2 reads labels and declines to write them.
 */

const id = z.string().min(1).describe('Page ID');
const idArg = { name: 'id', field: 'id', description: 'Page ID' };

export const listComments = confluenceArea.command({
  path: ['confluence', 'page', 'comments'],
  description: 'List footer comments on a Confluence Cloud page',
  toolDescription:
    'Returns the top-level footer comments on a page, each with its storage-format body, version and bodyText (plain text). Replies and inline comments are not included.',
  input: z.object({ id }),
  writes: false,
  args: [idArg],
  examples: [{ id: '12345' }],
  run: async (input, ctx) => (await client.listComments(ctx, input.id)).map(withBodyText),
});

export const addComment = confluenceArea.command({
  path: ['confluence', 'page', 'comment'],
  description: 'Add a footer comment to a Confluence Cloud page',
  input: z.object({
    id,
    body: z.string().min(1).describe('Comment body (storage-format XHTML, or wiki markup with --representation wiki)'),
    representation: z.enum(['storage', 'wiki']).optional().describe('Body format: storage (default) or wiki'),
    ...allowWriteField,
  }),
  writes: true,
  args: [idArg],
  options: [
    { flags: '--body <text>', field: 'body', description: 'Comment body (storage-format XHTML, or wiki markup with --representation wiki)' },
    { flags: '--representation <format>', field: 'representation', description: 'Body format: storage (default) or wiki' },
  ],
  examples: [
    { id: '12345', body: '<p>Reviewed.</p>', allowWrite: true },
    { id: '12345', body: 'Reviewed, *approved*.', representation: 'wiki', allowWrite: true },
  ],
  run: async (input, ctx) => withBodyText(await client.addComment(ctx, input.id, input.body, input.representation ?? 'storage')),
});

export const getLabels = confluenceArea.command({
  path: ['confluence', 'page', 'labels'],
  description: 'Get labels on a Confluence Cloud page',
  input: z.object({ id }),
  writes: false,
  args: [idArg],
  examples: [{ id: '12345' }],
  run: (input, ctx) => client.getLabels(ctx, input.id),
});

export const addLabel = confluenceArea.command({
  path: ['confluence', 'page', 'label'],
  description: 'Add labels to a Confluence Cloud page',
  input: z.object({ id, labels: z.string().min(1).describe('Comma-separated label names'), ...allowWriteField }),
  writes: true,
  args: [idArg],
  options: [{ flags: '--labels <names>', field: 'labels', description: 'Comma-separated label names' }],
  examples: [{ id: '12345', labels: 'runbook, ops,', allowWrite: true }],
  run: (input, ctx) =>
    client.addLabels(
      ctx,
      input.id,
      input.labels
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export const removeLabel = confluenceArea.command({
  path: ['confluence', 'page', 'unlabel'],
  description: 'Remove a label from a Confluence Cloud page',
  input: z.object({ id, label: z.string().min(1).describe('Label name to remove'), ...allowWriteField }),
  writes: true,
  args: [idArg],
  options: [{ flags: '--label <name>', field: 'label', description: 'Label name to remove' }],
  examples: [{ id: '12345', label: 'runbook', allowWrite: true }],
  run: async (input, ctx) => {
    await client.removeLabel(ctx, input.id, input.label);
    return { removed: input.label, from: input.id };
  },
});

export const discussionCommands = [listComments, addComment, getLabels, addLabel, removeLabel];
