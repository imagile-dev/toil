import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Figma: files, nodes, comments and version history from the REST API, read
 * with a personal access token in `X-Figma-Token`. Every command reads; a
 * design is reviewed here, not signed off, which keeps the approval chain
 * exactly as long as it was.
 */
export const figmaArea = defineArea({
  name: 'figma',
  description: 'Figma: files and nodes from a link, comments, version history and project files',
  connection: z.object({
    // No default host, as before: the user sets https://api.figma.com themselves.
    baseUrl: z.url().describe('Figma API root: https://api.figma.com'),
    token: z.string().min(1).describe('Figma personal access token'),
  }),
  secrets: ['token'],
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { 'X-Figma-Token': connection.token },
    service: 'Figma',
    authFix: `Figma rejected the personal access token on connection "${connection.name}". Generate a new one in Figma under Settings → Security → Personal access tokens, then set token (${area.envName('token')} for the default connection).`,
  }),
});

/** Not established: the commands call Figma's REST API v1. The skill file and the site's integration data say the same. */
export const figmaSupported: SupportedVersion = {
  product: 'Figma',
  minimum: null,
  api: 'REST API v1',
  note: 'toil calls the Figma REST API v1 (/v1/...) with a personal access token in X-Figma-Token. Nothing has been run against a live account yet.',
};
