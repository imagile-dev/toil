import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';
import { jiraArea } from '../jira/area.js';

/**
 * Confluence Data Center: the self-hosted Confluence, on the Server REST API
 * under `/rest/api`. Confluence Cloud is its own area (`confluence-cloud`),
 * never a flag on this one. The token may be the Jira one, as it was before:
 * one personal access token per person is, in some organizations, already a
 * generous allocation.
 */
export const confluenceArea = defineArea({
  name: 'confluence',
  description: 'Confluence Data Center: pages, spaces, CQL search, comments, labels and attachments',
  connection: z.object({
    baseUrl: z.url().describe('Confluence server root, e.g. https://confluence.imagile.dev'),
    apiToken: z.string().min(1).describe('Personal access token'),
  }),
  secrets: ['apiToken'],
  // The default connection falls back to TOIL_JIRA_API_TOKEN; any connection
  // can name a Jira connection to borrow from with apiTokenFrom.
  shares: { area: jiraArea, keys: ['apiToken'] },
  // The current user; Confluence answers an anonymous caller with a 200 and type "anonymous".
  probe: () => ({ path: '/rest/api/user/current', accepts: (body) => (body as { type?: unknown } | null)?.type !== 'anonymous' }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.apiToken}` },
    service: 'Confluence',
    authFix: `Confluence rejected the personal access token on connection "${connection.name}". Create a new one under your profile picture → Settings → Personal Access Tokens, then set apiToken (${area.envName('apiToken')} for the default connection). If the token came from Jira (meta.context.shared says so), give Confluence its own.`,
  }),
});

/** The floor the credential sets; no release has been verified yet. The skill file and the site's integration data say the same. */
export const confluenceSupported: SupportedVersion = {
  product: 'Confluence Data Center',
  minimum: '7.9',
  api: 'Server REST API',
  note: 'toil authenticates with a personal access token, which Confluence Data Center added in 7.9. No release has been verified yet.',
};
