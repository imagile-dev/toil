import { basename } from 'node:path';
import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { jiraCloudArea } from './area.js';
import * as client from './client.js';

/**
 * Attachments on a Jira Cloud issue: upload one, list them, save one locally.
 * Files move through `ctx.files`, so paths resolve inside the workspace on
 * both front doors. Downloads ask Jira for the bytes directly rather than a
 * redirect to its media service, so the credential stays on the site it was
 * issued for. Attachments are filed in triplicate by tradition; toil files
 * them once.
 */

const key = z.string().min(1).describe('Issue key, e.g. PROJ-123');
const keyOption = { flags: '--key <issue-key>', field: 'key', description: 'Issue key (e.g. PROJ-123)' };

export const addAttachment = jiraCloudArea.command({
  path: ['jira-cloud', 'add-attachment'],
  description: 'Upload a file as an attachment to a Jira Cloud issue',
  toolDescription: 'Uploads a local file to a Jira Cloud issue and returns the attachments Jira created. file is a path on the machine toil runs on.',
  input: z.object({ key, file: z.string().min(1).describe('Path to the file to upload'), ...allowWriteField }),
  writes: true,
  options: [keyOption, { flags: '--file <path>', field: 'file', description: 'Path to the file to upload' }],
  examples: [{ key: 'PROJ-123', file: 'screenshot.png', allowWrite: true }],
  run: async (input, ctx) => {
    const data = ctx.files.readBytes(input.file);
    return client.uploadAttachment(ctx, input.key, basename(input.file), data);
  },
});

export const listAttachments = jiraCloudArea.command({
  path: ['jira-cloud', 'list-attachments'],
  description: 'List attachments on a Jira Cloud issue',
  toolDescription: 'Returns the attachments on a Jira Cloud issue (id, filename, size, mimeType, content URL). Use jira_cloud_download_attachment to save one.',
  input: z.object({ key }),
  writes: false,
  options: [keyOption],
  examples: [{ key: 'PROJ-123' }],
  run: (input, ctx) => client.listAttachments(ctx, input.key),
});

export const downloadAttachment = jiraCloudArea.command({
  path: ['jira-cloud', 'download-attachment'],
  description: 'Download a Jira Cloud issue attachment to .toil/ (or --dir)',
  toolDescription:
    'Saves one attachment from a Jira Cloud issue to a local directory (default .toil in the working directory) and returns { saved, filename, size }. Get the id from jira_cloud_list_attachments. Never replaces an existing file.',
  input: z.object({
    key,
    attachmentId: z.string().min(1).describe('Attachment id from list-attachments'),
    dir: z.string().optional().describe('Output directory; defaults to .toil in the working directory'),
  }),
  writes: false,
  writesLocal: true,
  options: [
    keyOption,
    { flags: '--attachment-id <id>', field: 'attachmentId', description: 'Attachment ID from list-attachments output' },
    { flags: '--dir <path>', field: 'dir', description: 'Output directory (default: .toil relative to cwd)' },
  ],
  examples: [
    { key: 'PROJ-123', attachmentId: '10001' },
    { key: 'PROJ-123', attachmentId: '10001', dir: 'downloads' },
  ],
  run: async (input, ctx) => {
    // The issue's list says the attachment is on that issue, and gives its file name.
    const attachment = (await client.listAttachments(ctx, input.key)).find((a) => a.id === input.attachmentId);
    if (!attachment) {
      throw new ToilError('INVALID_INPUT', `Attachment not found on ${input.key}: ${input.attachmentId}`, {
        fix: `Run toil jira-cloud list-attachments --key ${input.key} for the ids it has.`,
      });
    }
    const data = await client.downloadAttachment(ctx, attachment.id);
    const saved = ctx.files.writeBytes(`${input.dir ?? '.toil'}/${basename(attachment.filename)}`, data);
    return { saved, filename: attachment.filename, size: data.length };
  },
});

export const attachmentCommands = [addAttachment, listAttachments, downloadAttachment];
