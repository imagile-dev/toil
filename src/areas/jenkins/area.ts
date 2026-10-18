import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Jenkins: jobs, builds, console logs and the build queue, through the classic
 * remote access API (`/api/json` with `tree`, `consoleText`, `/queue/item`).
 * Each named instance is its own connection, picked with `--instance`; a list
 * of servers kept in a spreadsheet of record is now kept in config instead.
 */
export const jenkinsArea = defineArea({
  name: 'jenkins',
  description: 'Jenkins: jobs, builds, console logs and the build queue',
  connection: z.object({
    baseUrl: z.url().describe('Jenkins server root, e.g. https://jenkins.imagile.dev'),
    username: z.string().min(1).describe('Jenkins user name the API token belongs to'),
    apiToken: z.string().min(1).describe('Jenkins API token'),
    instance: z.string().min(1).optional().describe("The name --instance selects this connection by, when it isn't the connection's own name"),
  }),
  secrets: ['apiToken'],
  // Core answers all three, so this area never sees the whole config or the credential store.
  coreAliases: { 'instance list': 'connections list', 'instance add': 'connections add', 'instance remove': 'connections remove' },
  context: {
    // Selects the connection: by its name, or by its `instance` setting.
    instance: {
      description: 'Named Jenkins instance (a jenkins connection, by name or by its instance setting)',
      flags: '--instance <name>',
      selectsConnection: true,
    },
  },
  // The current user; Jenkins with anonymous read answers it as "anonymous".
  probe: () => ({ path: '/me/api/json', query: { tree: 'id' }, accepts: (body) => (body as { id?: unknown } | null)?.id !== 'anonymous' }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.apiToken}`).toString('base64')}` },
    service: 'Jenkins',
    authFix: `Jenkins rejected the user name and API token on connection "${connection.name}". Create a new token under your user name → Security → API Token, then set username and apiToken (${area.envName('username')} and ${area.envName('apiToken')} for the default connection).`,
  }),
});

/** Not established: the commands use the classic remote access API. The skill file and the site's integration data say the same. */
export const jenkinsSupported: SupportedVersion = {
  product: 'Jenkins',
  minimum: null,
  api: 'Remote access API',
  note: 'toil calls the classic remote access API (/api/json with tree, consoleText, /queue/item) with a user name and API token sent as Basic auth. No release has been verified yet.',
};
