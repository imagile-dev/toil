import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';
import { jiraCloudArea } from '../jira-cloud/area.js';

/**
 * Confluence Cloud: Atlassian's hosted Confluence, on REST API v2 under
 * `/wiki/api/v2`, with v1 under `/wiki/rest/api` for what v2 doesn't cover
 * (CQL search, adding and removing labels, uploads). Its own area rather than
 * a flag on `confluence` (Data Center), because the two disagree on paths,
 * paging and ids. Built from Atlassian's documented API with no tested
 * contract; the documentation has signed for the delivery and nobody has
 * opened the box.
 */
export const confluenceCloudArea = defineArea({
  name: 'confluence-cloud',
  description: 'Confluence Cloud: pages, spaces, CQL search, comments, labels and attachments',
  connection: z.object({
    baseUrl: z.url().describe('Confluence Cloud site root, without /wiki: https://<your-site>.atlassian.net'),
    email: z.string().min(1).describe('Email address of the Atlassian account the API token belongs to'),
    apiToken: z.string().min(1).describe('Atlassian account API token'),
  }),
  secrets: ['apiToken'],
  // The same Atlassian account token works for Jira Cloud. The default connection
  // falls back to TOIL_JIRA_CLOUD_API_TOKEN; any connection can name a jira-cloud
  // connection to borrow from with apiTokenFrom. The email is never borrowed.
  shares: { area: jiraCloudArea, keys: ['apiToken'] },
  examples: { baseUrl: 'https://<your-site>.atlassian.net', email: 'you@example.com' },
  request: (connection, area) => {
    // toil adds /wiki itself, so a site URL pasted from the browser's address bar
    // would ask for /wiki/wiki/api/v2 and get a 404 that explains nothing.
    if (/\/wiki\/*$/i.test(new URL(connection.baseUrl).pathname)) {
      throw new ToilError('CONFIG_INVALID', `baseUrl on connection "${connection.name}" ends in /wiki (${connection.baseUrl}); it must be the site root, because toil adds /wiki itself.`, {
        fix: `Drop the trailing /wiki: set baseUrl (${area.envName('baseUrl')} for the default connection) to the site root, https://<your-site>.atlassian.net.`,
      });
    }
    return {
      baseUrl: connection.baseUrl,
      // Basic auth with the account's email and API token, as Atlassian documents
      // for scripts: https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/
      headers: { Authorization: `Basic ${Buffer.from(`${connection.email}:${connection.apiToken}`).toString('base64')}`, Accept: 'application/json' },
      service: 'Confluence Cloud',
      authFix: `Confluence Cloud rejected the email and API token on connection "${connection.name}". Check that email (${area.envName('email')}) is the Atlassian account's address, create a new API token at https://id.atlassian.com/manage-profile/security/api-tokens, then set apiToken (${area.envName('apiToken')} for the default connection). If the token came from Jira Cloud (meta.context.shared says so), check it belongs to that same email.`,
    };
  },
});

/** Confluence Cloud has no versions to choose between; the API is what's documented today. The skill file and the site's integration data say the same. */
export const confluenceCloudSupported: SupportedVersion = {
  product: 'Confluence Cloud',
  minimum: null,
  api: 'REST API v2, with v1 for CQL search, labels and uploads',
  note: 'Confluence Cloud is always current. toil calls REST API v2 (/wiki/api/v2) and, where v2 has no endpoint, v1 (/wiki/rest/api: CQL search, adding and removing labels, attachment uploads), with an Atlassian account email and API token sent as Basic auth. Nothing has been run against a live site yet.',
};
