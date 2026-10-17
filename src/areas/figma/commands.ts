import { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { QueryValue } from '../../core/rest.js';
import { figmaArea } from './area.js';
import { findNodeIdInUrl, isUrl, parseFileKey, parseNodeId } from './links.js';

/**
 * The five Figma commands, one GET each, sent exactly as the canonical
 * implementation sent them. Image URLs in the answers (`thumbnailUrl`,
 * `img_url`, `thumbnail_url`) live on Figma's CDN and are returned as data,
 * never fetched: the token is for the API, and the CDN never filed a request
 * for it.
 */

type FigmaContext = CommandContext<Connection<z.output<typeof figmaArea.connection>>>;

/** The predecessor's per-request timeout. */
const TIMEOUT_MS = 30_000;
/** What every call sends besides the hook's token, exactly as the predecessor sent it. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

function figma<T>(ctx: FigmaContext, path: string, query?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(figmaArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(query ? { query } : {}) });
}

const count = (map: Record<string, unknown> | undefined) => (map ? Object.keys(map).length : 0);

interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  thumbnailUrl?: string;
  role?: string;
  editorType?: string;
  document?: unknown;
  components?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  schemaVersion?: number;
}

interface FigmaNodesResponse {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  err?: string | null;
  nodes: Record<string, { document: unknown; components?: Record<string, unknown>; styles?: Record<string, unknown> } | null>;
}

const KEY_OR_URL = 'Figma file key or full Figma URL';

export const fileCommand = figmaArea.command({
  path: ['figma', 'file'],
  description: 'Get a Figma file — metadata, structure, and component/style inventory (or a single node with --node-id)',
  input: z.object({
    fileKeyOrUrl: z.string().describe('Figma file key or full Figma URL (https://www.figma.com/design/<key>/...); a node-id query param is auto-detected'),
    document: z.boolean().optional().describe('Include the full document node tree (can be large; omitted by default)'),
    nodeId: z.string().optional().describe('Fetch only this node and its descendants instead of the whole file (overrides any node-id detected in the URL)'),
  }),
  writes: false,
  args: [{ name: 'file-key-or-url', field: 'fileKeyOrUrl', description: 'Figma file key or full Figma URL (https://www.figma.com/design/<key>/...); a node-id query param is auto-detected' }],
  options: [
    { flags: '--document', field: 'document', description: 'Include the full document node tree (can be large; omitted by default)' },
    { flags: '--node-id <id>', field: 'nodeId', description: 'Fetch only this node and its descendants instead of the whole file (overrides any node-id detected in the URL)' },
  ],
  examples: [
    { fileKeyOrUrl: 'abc12345' },
    { fileKeyOrUrl: 'https://www.figma.com/design/abc12345/Checkout', document: true },
    { fileKeyOrUrl: 'https://www.figma.com/design/abc12345/Checkout?node-id=12-34' },
    { fileKeyOrUrl: 'abc12345', nodeId: '12-34' },
  ],
  run: async (input, ctx) => {
    const fileKey = parseFileKey(input.fileKeyOrUrl);
    // An explicit --node-id must parse; one in the link is optional.
    const nodeId = input.nodeId ? parseNodeId(input.nodeId) : isUrl(input.fileKeyOrUrl) ? findNodeIdInUrl(input.fileKeyOrUrl) : undefined;

    if (nodeId) {
      const data = await figma<FigmaNodesResponse>(ctx, `/v1/files/${encodeURIComponent(fileKey)}/nodes`, { ids: nodeId });
      const node = data.nodes[nodeId];
      // Suspected bug (#73 item 8): the response's `err` is never read, so any null node is "not found".
      if (!node) {
        throw new ToilError('NOT_FOUND', `Node ${nodeId} not found in file ${fileKey}`, {
          fix: `Check the node ID: copy the link to the layer in Figma (it carries node-id), or run toil figma file ${fileKey} --document to see the node tree.`,
        });
      }
      // Suspected bug (#73 item 6): --document has no effect here; the node's whole subtree always comes back.
      return {
        fileKey,
        nodeId,
        name: data.name,
        lastModified: data.lastModified,
        thumbnailUrl: data.thumbnailUrl,
        document: node.document,
        componentCount: count(node.components),
        styleCount: count(node.styles),
      };
    }

    // Suspected bug (#73 item 7): counts come from a depth=1 answer, which may hold fewer components and styles.
    const data = await figma<FigmaFile>(ctx, `/v1/files/${encodeURIComponent(fileKey)}`, input.document ? {} : { depth: 1 });
    return {
      fileKey,
      name: data.name,
      lastModified: data.lastModified,
      version: data.version,
      thumbnailUrl: data.thumbnailUrl,
      role: data.role,
      editorType: data.editorType,
      schemaVersion: data.schemaVersion,
      ...(input.document ? { document: data.document } : {}),
      componentCount: count(data.components),
      styleCount: count(data.styles),
    };
  },
});

export const commentsCommand = figmaArea.command({
  path: ['figma', 'comments'],
  description: 'Get comments on a Figma file',
  input: z.object({
    fileKeyOrUrl: z.string().describe(KEY_OR_URL),
    asOf: z.string().optional().describe('ISO 8601 timestamp — return only comments created before this time'),
  }),
  writes: false,
  args: [{ name: 'file-key-or-url', field: 'fileKeyOrUrl', description: KEY_OR_URL }],
  options: [{ flags: '--as-of <date>', field: 'asOf', description: 'ISO 8601 timestamp — return only comments created before this time' }],
  examples: [{ fileKeyOrUrl: 'abc12345' }, { fileKeyOrUrl: 'https://www.figma.com/file/abc12345/Checkout', asOf: '2026-09-01T00:00:00Z' }],
  run: async (input, ctx) => {
    const fileKey = parseFileKey(input.fileKeyOrUrl);
    // Suspected bug (#73 item 2): Figma has no as_of parameter, so the filter is ignored and every comment comes back.
    const data = await figma<{ comments: unknown[] }>(ctx, `/v1/files/${encodeURIComponent(fileKey)}/comments`, input.asOf ? { as_of: input.asOf } : {});
    if (input.asOf) ctx.warn({ code: 'FIGMA_AS_OF_IGNORED', message: "Figma's API doesn't filter comments by --as-of; every comment was returned." });
    return { fileKey, count: data.comments.length, comments: data.comments };
  },
});

export const versionsCommand = figmaArea.command({
  path: ['figma', 'versions'],
  description: 'Get the version history of a Figma file',
  input: z.object({
    fileKeyOrUrl: z.string().describe(KEY_OR_URL),
  }),
  writes: false,
  args: [{ name: 'file-key-or-url', field: 'fileKeyOrUrl', description: KEY_OR_URL }],
  examples: [{ fileKeyOrUrl: 'abc12345' }],
  run: async (input, ctx) => {
    const fileKey = parseFileKey(input.fileKeyOrUrl);
    // Suspected bug (#73 item 3): one page of history only; the answer's `pagination` is dropped.
    const data = await figma<{ versions: unknown[]; pagination?: { next_page?: string | null } }>(ctx, `/v1/files/${encodeURIComponent(fileKey)}/versions`);
    if (data.pagination?.next_page) ctx.warn({ code: 'FIGMA_MORE_VERSIONS', message: 'Figma has more versions than this page; only the first page was read.' });
    return { fileKey, count: data.versions.length, versions: data.versions };
  },
});

export const projectFilesCommand = figmaArea.command({
  path: ['figma', 'project-files'],
  description: 'List files in a Figma project',
  input: z.object({
    projectId: z.string().describe('Figma project ID (visible in the project URL)'),
  }),
  writes: false,
  args: [{ name: 'project-id', field: 'projectId', description: 'Figma project ID (visible in the project URL)' }],
  examples: [{ projectId: '12345' }],
  run: async (input, ctx) => {
    // Suspected bug (#73 item 9): Figma has deprecated this endpoint in favour of /v2/folders/:id/files.
    const data = await figma<{ files: unknown[] }>(ctx, `/v1/projects/${encodeURIComponent(input.projectId)}/files`);
    return { projectId: input.projectId, count: data.files.length, files: data.files };
  },
});

export const meCommand = figmaArea.command({
  path: ['figma', 'me'],
  description: 'Get the current Figma user (useful for verifying credentials)',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => figma<unknown>(ctx, '/v1/me'),
});

export const figmaCommands = [fileCommand, commentsCommand, versionsCommand, projectFilesCommand, meCommand];
