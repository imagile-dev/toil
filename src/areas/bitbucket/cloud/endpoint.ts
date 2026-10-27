import type { AreaEndpoint, HookArea } from '../../../core/api.js';
import { ToilError } from '../../../core/errors.js';

/**
 * How a Bitbucket Cloud connection signs in, and how its errors read. This is
 * the request hook's Cloud half (`../area.ts` picks between it and Data
 * Center's by the connection's deployment). Built from Atlassian's documented
 * API with no tested contract, so the only reviewer on record is the
 * documentation, and it approved its own work.
 */

/** The settings of a Cloud connection that decide how it signs in. */
export interface CloudCredentials {
  name: string;
  baseUrl: string;
  email?: string | undefined;
  apiToken?: string | undefined;
  accessToken?: string | undefined;
}

const API_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/**
 * What to create when Bitbucket Cloud turns the credential away (a 401, a 403
 * or a 410), worded for the credential this connection sent. App passwords
 * are named because a connection that still holds one fails exactly here.
 */
function credentialFix(conn: CloudCredentials, area: HookArea): string {
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
export function cloudEndpoint(conn: CloudCredentials, area: HookArea): AreaEndpoint {
  const set = `Set either accessToken (${area.envName('accessToken')}), or email and apiToken (${area.envName('email')}, ${area.envName('apiToken')}), for the default connection, or run toil connections add <name> --area bitbucket and set deployment to cloud.`;
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
