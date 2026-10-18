import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { GitRemote } from '../../core/call-context.js';
import { parseAdoRemote } from '../../core/git-remote.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Azure DevOps Server: work items, git repositories, pull requests and
 * pipelines, over REST API 7.1 with a personal access token. Every path starts
 * with a collection, because an on-premises server is several organisations
 * sharing one front desk.
 */

/**
 * collection, project or repo from one of the working folder's remotes (origin first), only
 * when the remote is on this connection's host, by core's ADO remote parser.
 * Suspected bug (#69 item 5): three common remote shapes are misread.
 */
const fromRemote =
  (name: 'collection' | 'project' | 'repo') =>
  (remote: GitRemote, connection: { baseUrl?: unknown } | undefined): string | undefined =>
    connection && typeof connection.baseUrl === 'string' ? parseAdoRemote(remote.url, connection.baseUrl)?.[name] : undefined;

export const adoArea = defineArea({
  name: 'ado',
  description: 'Azure DevOps Server: work items, repositories, pull requests and pipelines',
  connection: z.object({
    baseUrl: z.url().describe('Azure DevOps Server root, e.g. https://ado.imagile.dev (keep any /tfs prefix)'),
    pat: z.string().min(1).describe('Personal access token'),
    // Shared defaults, usually set once under defaults.ado for every connection.
    collection: z.string().optional().describe('Default collection, when --collection isn\'t given'),
    project: z.string().optional().describe('Default team project, when --project isn\'t given'),
    repo: z.string().optional().describe('Default git repository, when --repo isn\'t given'),
    fieldAliases: z.record(z.string(), z.string()).optional().describe('Work item field aliases, friendly name to reference name (e.g. {"storypoints": "Microsoft.VSTS.Scheduling.StoryPoints"})'),
    discoveredFields: z.array(z.unknown()).optional().describe('Work item fields recorded by an earlier discovery; kept, not read'),
    discoveredTypes: z.array(z.unknown()).optional().describe('Work item types recorded by an earlier discovery; kept, not read'),
  }),
  secrets: ['pat'],
  // Azure Pipelines hands every job its own token as SYSTEM_ACCESSTOKEN, so a pipeline needs nothing more.
  fallbacks: { pat: ['SYSTEM_ACCESSTOKEN'] },
  // None is `required` on a command: --organization stands in for --collection,
  // so the predecessor's own checks run in where() (client.ts), in its order.
  // Any string, as before: an empty --project still gets "Could not determine".
  context: {
    collection: {
      description: 'Azure DevOps collection (organization)',
      flags: '--collection <name>',
      setting: 'collection',
      git: fromRemote('collection'),
      schema: z.string(),
    },
    organization: { description: 'Alias for --collection', flags: '--organization <name>', schema: z.string() },
    project: {
      description: 'Azure DevOps team project',
      flags: '--project <name>',
      setting: 'project',
      git: fromRemote('project'),
      schema: z.string(),
    },
    repo: {
      description: 'Azure DevOps git repository name',
      flags: '--repo <name>',
      setting: 'repo',
      git: fromRemote('repo'),
      schema: z.string(),
    },
  },
  examples: { baseUrl: 'https://ado.imagile.dev' },
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    // Basic auth with an empty user name: the PAT is the password and the whole of the login.
    headers: { Authorization: `Basic ${Buffer.from(`:${connection.pat}`).toString('base64')}` },
    service: 'Azure DevOps',
    authFix: `Azure DevOps rejected the personal access token on connection "${connection.name}", or it lacks the scope this needs. Create a new one under User settings → Personal access tokens, then set pat (${area.envName('pat')}, or SYSTEM_ACCESSTOKEN in Azure Pipelines, for the default connection).`,
  }),
});

/** Azure DevOps Server 2022.1 is REST API 7.1, the version every request asks for. The skill file and the site's integration data say the same. */
export const adoSupported: SupportedVersion = {
  product: 'Azure DevOps Server',
  minimum: '2022.1',
  api: 'REST API 7.1',
  note: 'Requests send api-version=7.1, which newer servers also accept. Azure DevOps Server 2022 RTM, 2020 and 2019 are out of scope.',
};
