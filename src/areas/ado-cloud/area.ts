import { z } from 'zod';
import { defineArea, type Connection } from '../../core/area.js';
import type { AreaEndpoint, HookArea } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Azure DevOps Services: work items, git repositories and pull requests in
 * one organization, over REST API 7.1 with an organization-scoped personal
 * access token. Its own area rather than a flag on `ado` (Azure DevOps
 * Server), so the Server's recorded behaviour stays exactly as recorded. A
 * connection is one organization, because the token is one organization:
 * Microsoft has retired the token that opened every door, and the doors were
 * relieved.
 */

const connection = z.object({
  baseUrl: z.url().describe('Organization URL: https://dev.azure.com/<organization> (or https://<organization>.visualstudio.com)'),
  pat: z.string().min(1).describe('Organization-scoped personal access token'),
  // Shared defaults, usually set once under defaults.ado-cloud for every connection.
  project: z.string().min(1).optional().describe("Default project, when --project isn't given"),
  repo: z.string().min(1).optional().describe("Default git repository, when --repo isn't given"),
  team: z.string().min(1).optional().describe("Default team for the board, backlog and sprint commands, when --team isn't given (else the project's default team)"),
  fieldAliases: z.record(z.string(), z.string()).optional().describe('Work item field aliases, friendly name to reference name (e.g. {"effortdays": "MyOrg.EffortDays"})'),
});

export type AdoCloudSettings = z.output<typeof connection>;

/** Where an organization-scoped token is made, and why a global one won't do, said once for every 401. */
export const PAT_HELP =
  'Create an organization-scoped personal access token in that organization: User settings → Personal access tokens → New Token, with Organization set to this organization (not "All accessible organizations"), and the Work Items and Code scopes (Read, or Read & write for the write commands). Global personal access tokens ("All accessible organizations") are being retired by Microsoft and stop working on December 1, 2026.';

/**
 * The organization URL, checked before anything is sent: on dev.azure.com
 * the organization is the first path segment, so a bare https://dev.azure.com
 * would read every project name as an organization.
 */
function organizationUrl(conn: Connection<AdoCloudSettings>, area: HookArea): string {
  const url = new URL(conn.baseUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  // URL lower-cases the host already. On visualstudio.com the organization is the host, and
  // the legacy /DefaultCollection is the one path segment that belongs there; a project doesn't.
  const host = url.hostname;
  const extra =
    host === 'dev.azure.com'
      ? segments.length !== 1
      : host.endsWith('.visualstudio.com')
        ? segments.length > 1 || (segments.length === 1 && segments[0]!.toLowerCase() !== 'defaultcollection')
        : false;
  if (extra) {
    throw new ToilError('CONFIG_INVALID', `Connection "${conn.name}" has baseUrl ${conn.baseUrl}, which doesn't name one organization.`, {
      fix: `Set baseUrl to the organization URL, https://dev.azure.com/<organization> or https://<organization>.visualstudio.com, with no project in it (${area.envName('baseUrl')} for the default connection).`,
    });
  }
  return conn.baseUrl;
}

function endpoint(conn: Connection<AdoCloudSettings>, area: HookArea): AreaEndpoint {
  return {
    baseUrl: organizationUrl(conn, area),
    // Basic auth with an empty user name: the PAT is the password and the whole of the login.
    headers: { Authorization: `Basic ${Buffer.from(`:${conn.pat}`).toString('base64')}` },
    service: 'Azure DevOps Services',
    authFix: `Azure DevOps Services rejected the personal access token on connection "${conn.name}", or it lacks the scope this needs, or it was made for another organization. ${PAT_HELP} Then set pat (${area.envName('pat')} for the default connection).`,
  };
}

export const adoCloudArea = defineArea({
  name: 'ado-cloud',
  description: 'Azure DevOps Services: work items, boards, backlogs, sprints, repositories and pull requests',
  connection,
  secrets: ['pat'],
  // No CI fallbacks: Azure Pipelines sets SYSTEM_ACCESSTOKEN and SYSTEM_COLLECTIONURI
  // under the same names on Server and Services, and `ado` already reads the first.
  // AGENT_DECISIONS.md, #222 ado-cloud, says why and what a pipeline maps instead.
  examples: { baseUrl: 'https://dev.azure.com/imagile' },
  context: {
    project: {
      description: 'Azure DevOps project',
      flags: '--project <name>',
      setting: 'project',
      missing: { message: 'No Azure DevOps project given. Pass --project <name>, or set project on the connection.' },
    },
    repo: {
      description: 'Azure DevOps git repository name',
      flags: '--repo <name>',
      setting: 'repo',
      missing: { message: 'No Azure DevOps repository given. Pass --repo <name>, or set repo on the connection.' },
    },
    // Only the commands that read a team's settings take it, so it isn't on every tool.
    team: {
      scope: 'command',
      description: "Azure DevOps team, by name or id (default: the project's default team)",
      flags: '--team <name>',
      setting: 'team',
    },
  },
  // The organization's connection data names the token's own user, so a bad token can't pass.
  probe: () => ({ path: '/_apis/connectionData', query: { 'api-version': '7.1-preview.1' } }),
  request: endpoint,
});

/** Azure DevOps Services has no versions to choose between; toil asks for REST API 7.1. The skill file and the site's integration data say the same. */
export const adoCloudSupported: SupportedVersion = {
  product: 'Azure DevOps Services',
  minimum: null,
  api: 'REST API 7.1',
  note: 'Azure DevOps Services is always current. toil sends api-version=7.1, the newest released version (7.2 is preview only), with an organization-scoped personal access token as Basic auth. Its work item reads and team settings commands have been run against one live Scrum organization; its pull request commands have not.',
};
