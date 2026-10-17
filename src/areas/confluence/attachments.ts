import { basename } from 'node:path';
import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { confluenceArea } from './area.js';
import * as client from './client.js';

/**
 * Attachments: list a page's, upload one, save one locally, or move one to
 * the trash. Files move through `ctx.files`, so paths stay inside the
 * workspace on both front doors and a download never replaces a file. The
 * trash is not emptied; that requires an administrator, which is the point.
 */

const pageId = z.string().describe('Page ID');
const attachmentId = z.string().describe('Attachment content ID');
const attachmentOption = { flags: '--id <attachment-id>', field: 'id', description: 'Attachment content ID' };

/**
 * The file name a download is saved under: the attachment title's last
 * segment, splitting on both `/` and `\` whatever the platform, with `.` and
 * `..` dropped, and `attachment` when nothing is left. The title comes from
 * the server, so it never picks the directory.
 */
export function attachmentFileName(title: string): string {
  const segments = title.split(/[\\/]/).filter((s) => s !== '' && s !== '.' && s !== '..');
  return segments.pop() ?? 'attachment';
}

export const listAttachments = confluenceArea.command({
  path: ['confluence', 'list-attachments'],
  description: 'List attachments on a Confluence page',
  toolDescription: 'Returns every attachment on a Confluence page (id, title, metadata, download link). Use confluence_download_attachment with an id to save one.',
  input: z.object({ id: pageId }),
  writes: false,
  options: [{ flags: '--id <page-id>', field: 'id', description: 'Page ID' }],
  examples: [{ id: '12345' }],
  run: (input, ctx) => client.listAttachments(ctx, input.id),
});

export const uploadAttachment = confluenceArea.command({
  path: ['confluence', 'upload-attachment'],
  description: 'Upload a file as an attachment to a Confluence page',
  toolDescription: 'Uploads a local file to a Confluence page as a new attachment and returns what Confluence created. file is a path inside the workspace. A file name already on the page is not versioned.',
  input: z.object({
    id: pageId,
    file: z.string().describe('Path to the file to upload'),
    comment: z.string().optional().describe('Optional comment to attach to the file version'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--id <page-id>', field: 'id', description: 'Page ID' },
    { flags: '--file <path>', field: 'file', description: 'Path to the file to upload' },
    { flags: '--comment <text>', field: 'comment', description: 'Optional comment to attach to the file version' },
  ],
  examples: [
    { id: '12345', file: 'diagram.png', allowWrite: true },
    { id: '12345', file: 'notes.txt', comment: 'First draft', allowWrite: true },
  ],
  run: async (input, ctx) => {
    if (!ctx.files.exists(input.file)) {
      throw new ToilError('INVALID_INPUT', `File not found: ${input.file}`, { fix: 'Check the path. Relative paths resolve against the workspace.' });
    }
    const data = ctx.files.readBytes(input.file);
    // The platform's own basename, as before: on Linux and macOS a backslash is part of the name.
    return client.uploadAttachment(ctx, input.id, basename(input.file), data, input.comment);
  },
});

export const downloadAttachment = confluenceArea.command({
  path: ['confluence', 'download-attachment'],
  description: 'Download a Confluence attachment to .toil/ (or --dir)',
  toolDescription:
    'Saves one Confluence attachment to a directory inside the workspace (default .toil) and returns { saved, filename, size }. Never replaces an existing file. Get the id from confluence_list_attachments.',
  input: z.object({
    id: attachmentId,
    dir: z.string().optional().describe('Output directory; defaults to .toil in the workspace'),
  }),
  writes: false,
  options: [attachmentOption, { flags: '--dir <path>', field: 'dir', description: 'Output directory (default: .toil relative to cwd)' }],
  examples: [{ id: '98765' }, { id: '98765', dir: 'downloads' }],
  run: async (input, ctx) => {
    const attachment = await client.getAttachment(ctx, input.id);
    const data = await client.downloadAttachment(ctx, attachment);
    const saved = ctx.files.writeBytes(`${input.dir ?? '.toil'}/${attachmentFileName(attachment.title)}`, data);
    return { saved, filename: attachment.title, size: data.length };
  },
});

export const deleteAttachment = confluenceArea.command({
  path: ['confluence', 'delete-attachment'],
  description: 'Delete an attachment from Confluence by its content ID (moves it to the trash; does not permanently purge it)',
  input: z.object({ id: attachmentId, ...allowWriteField }),
  writes: true,
  mcp: false,
  options: [attachmentOption],
  examples: [{ id: '98765', allowWrite: true }],
  run: async (input, ctx) => {
    await client.deleteContent(ctx, input.id);
    return { deleted: input.id };
  },
});

export const attachmentCommands = [listAttachments, uploadAttachment, downloadAttachment, deleteAttachment];
