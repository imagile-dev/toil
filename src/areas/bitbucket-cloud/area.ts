import { z } from 'zod';
import { pathIdSchema } from '../../core/api-path.js';
import { defineArea, type Connection } from '../../core/area.js';
import type { AreaEndpoint, HookArea } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Bitbucket Cloud: repositories, branches and tags, commits, diffs, files,
 * pull requests and Pipelines, over REST API 2.0 at api.bitbucket.org. Its
 * own area rather than a flag on `bitbucket` (Data Center), because the two
 * share a name and very little else: workspaces instead of projects, account
 * ids instead of usernames, `next` links instead of `nextPageStart`. Built
 * from Atlassian's documented API with no tested contract, so the only
 * reviewer on record is the documentation, and it approved its own work.
 */

const connection = z.object({
  baseUrl: z.url().describe('Bitbucket Cloud REST API root: https://api.bitbucket.org/2.0'),
  email: z.string().min(1).optional().describe('Email address of the Atlassian account an API token belongs to (with apiToken)'),
  apiToken: z.string().min(1).optional().describe('Atlassian API token with Bitbucket scopes, sent as Basic auth with email'),
  accessToken: z.string().min(1).optional().describe('Workspace, project or repository access token, sent as Bearer'),
  // Shared defaults, usually set once under defaults.bitbucket-cloud for every connection.
  workspace: z.string().min(1).optional().describe('Default workspace slug'),
  repo: z.string().min(1).optional().describe('Default repository slug'),
});

export type BitbucketCloudSettings = z.output<typeof connection>;

const API_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/**
 * What to create when Bitbucket Cloud turns the credential away (a 401, a 403
 * or a 410), worded for the credential this connection sent. App passwords
 * are named because a connection that still holds one fails exactly here.
 */
function credentialFix(conn: Connection<BitbucketCloudSettings>, area: HookArea): string {
  const note = "App passwords no longer work and toil does not take them. A 410 means Bitbucket retired either this way of signing in or this endpoint; if the message says the API is no longer available, the endpoint is gone and a new credential won't help.";
  if (conn.accessToken) {
    return `Bitbucket Cloud rejected the access token on connection "${conn.name}", or it lacks a scope this needs. Create a new access token in Bitbucket under Repository settings, Project settings or Workspace settings → Access tokens, with the repository, pullrequest and pipeline scopes (add pullrequest:write and repository:write for writes), then set accessToken (${area.envName('accessToken')} for the default connection). ${note}`;
  }
  return `Bitbucket Cloud rejected the email and API token on connection "${conn.name}", or the token lacks a scope this needs. Create an API token with scopes at ${API_TOKENS} (Create API token with scopes → Bitbucket), with read:repository:bitbucket, read:pullrequest:bitbucket, read:pipeline:bitbucket and read:user:bitbucket (add write:pullrequest:bitbucket and write:repository:bitbucket for writes), then set apiToken (${area.envName('apiToken')} for the default connection) and check email (${area.envName('email')}) is that account's address. ${note}`;
}

/**
 * One of the two credentials, never both: an access token as Bearer, or an
 * API token as Basic with the account's email. Two credentials on one
 * connection would leave toil choosing which one acts, so it refuses instead.
 */
function endpoint(conn: Connection<BitbucketCloudSettings>, area: HookArea): AreaEndpoint {
  const set = `Set either accessToken (${area.envName('accessToken')}), or email and apiToken (${area.envName('email')}, ${area.envName('apiToken')}), for the default connection, or run toil connections add <name> --area bitbucket-cloud.`;
  if (conn.accessToken && conn.apiToken) {
    throw new ToilError('CONFIG_INVALID', `Connection "${conn.name}" has both an accessToken and an apiToken; Bitbucket Cloud takes one credential per connection.`, {
      fix: `Remove one of them: keep accessToken for a workspace, project or repository access token, or apiToken with email for an Atlassian API token. ${set}`,
    });
  }
  if (!conn.accessToken && !conn.apiToken) {
    throw new ToilError('NOT_CONFIGURED', `Bitbucket Cloud credentials not configured on connection "${conn.name}".`, { fix: set });
  }
  if (conn.apiToken && !conn.email) {
    throw new ToilError('NOT_CONFIGURED', `Connection "${conn.name}" has an apiToken but no email; an Atlassian API token is sent with the account's email address.`, {
      fix: `Set email (${area.envName('email')} for the default connection) to the Atlassian account's email address.`,
    });
  }
  const authorization = conn.accessToken ? `Bearer ${conn.accessToken}` : `Basic ${Buffer.from(`${conn.email}:${conn.apiToken}`).toString('base64')}`;
  return {
    baseUrl: conn.baseUrl,
    headers: { Authorization: authorization, Accept: 'application/json' },
    service: 'Bitbucket Cloud',
    authFix: credentialFix(conn, area),
    errorMessage,
    // A 410 Gone is how Bitbucket Cloud turns away retired authentication, so
    // it's AUTH with the fix above rather than a bare HTTP failure.
    authStatuses: [410],
  };
}

/**
 * Bitbucket Cloud's standard error body, `{ type: "error", error: { message,
 * detail?, fields? } }`, as one line: the message, then the detail, then each
 * field's complaints. The common shapes core reads don't include it.
 */
export function errorMessage(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const error = (parsed as { error?: { message?: unknown; detail?: unknown; fields?: unknown } } | null)?.error;
  if (typeof error?.message !== 'string' || error.message === '') return undefined;
  const parts = [error.message];
  if (typeof error.detail === 'string' && error.detail !== '') parts.push(error.detail);
  if (error.fields && typeof error.fields === 'object') {
    for (const [field, problems] of Object.entries(error.fields as Record<string, unknown>)) parts.push(`${field}: ${Array.isArray(problems) ? problems.join(' ') : String(problems)}`);
  }
  return parts.join('; ');
}

export const bitbucketCloudArea = defineArea({
  name: 'bitbucket-cloud',
  description: 'Bitbucket Cloud: repositories, branches, tags, commits, diffs, files, pull requests, comments, build statuses and Pipelines',
  connection,
  secrets: ['apiToken', 'accessToken'],
  // Bitbucket Pipelines sets both on every step, so a pipeline needs no toil-specific context.
  fallbacks: { workspace: ['BITBUCKET_WORKSPACE'], repo: ['BITBUCKET_REPO_SLUG'] },
  examples: { baseUrl: 'https://api.bitbucket.org/2.0', email: 'you@example.com' },
  context: {
    // toil's own --workspace is the file-workspace flag and takes it wherever
    // it appears, so Bitbucket's workspace is spelt --ws, as splitio's is.
    // A workspace slug (or its {uuid}) and a repository slug are letters,
    // digits, -, _ and ., so either one holding path syntax is refused,
    // whether it came from a flag, the connection or BITBUCKET_* in a pipeline.
    workspace: {
      description: 'Bitbucket Cloud workspace slug',
      flags: '--ws <slug>',
      setting: 'workspace',
      missing: { message: "No Bitbucket Cloud workspace given. Pass --ws <slug>; toil's --workspace is the folder commands may read files in, not the Bitbucket workspace." },
      schema: pathIdSchema('A Bitbucket Cloud workspace slug').min(1),
    },
    repo: {
      description: 'Bitbucket Cloud repository slug',
      flags: '--repo <slug>',
      setting: 'repo',
      missing: { message: 'No Bitbucket Cloud repository given. Pass --repo <slug>, or set repo on the connection.' },
      schema: pathIdSchema('A Bitbucket Cloud repository slug').min(1),
    },
  },
  // An API token belongs to a user, so /user proves it. An access token is no
  // user; the repository it was made for proves it, when the connection names one.
  probe: (c) => (c.accessToken ? (c.workspace && c.repo ? { path: `/repositories/${encodeURIComponent(c.workspace)}/${encodeURIComponent(c.repo)}` } : undefined) : { path: '/user' }),
  request: endpoint,
});

/** Bitbucket Cloud has no versions to choose between; the API is what's documented today. The skill file and the site's integration data say the same. */
export const bitbucketCloudSupported: SupportedVersion = {
  product: 'Bitbucket Cloud',
  minimum: null,
  api: 'REST API 2.0',
  note: 'Bitbucket Cloud is always current. toil calls REST API 2.0 (https://api.bitbucket.org/2.0) with an Atlassian API token sent as Basic auth with the account email, or a workspace, project or repository access token sent as Bearer. Nothing has been run against a live workspace yet.',
};
