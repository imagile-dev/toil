import { z } from 'zod';
import { defineArea, type Connection } from '../../core/area.js';
import type { AreaEndpoint, HookArea } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Dynatrace, on two hosts with two credentials: the classic environment API
 * (entities, services, workloads, problems) takes an access token as
 * `Api-Token`, and the platform's Grail query API (`trace`) takes a platform
 * token as `Bearer`. Each token goes only to its own host. Two front desks,
 * two visitor badges, and neither badge opens the other door.
 */

const connection = z.object({
  baseUrl: z.url().optional().describe('Classic environment URL, e.g. https://abc12345.live.dynatrace.com (Managed: keep the /e/<environment-id> path)'),
  apiToken: z.string().min(1).optional().describe('Access token for the classic environment API, sent as Api-Token'),
  platformUrl: z.url().optional().describe('Platform URL for trace, e.g. https://abc12345.apps.dynatrace.com'),
  platformToken: z.string().min(1).optional().describe('Platform token for trace, sent as Bearer'),
  env: z.string().min(1).optional().describe('Environment name that --env selects this connection by, when it differs from the connection name'),
});

type DynatraceSettings = z.output<typeof connection>;

/** Where a missing setting goes, worded for this connection. */
const setHint = (conn: Connection<DynatraceSettings>, area: HookArea, key: keyof DynatraceSettings & string) =>
  `Set ${key} on connection "${conn.name}" (${area.envName(key)} for the default connection), or run toil connections add <name> --area dynatrace.`;

/** The classic environment API: every command but trace. */
function classicEndpoint(conn: Connection<DynatraceSettings>, area: HookArea): AreaEndpoint {
  // The predecessor checked the URL before the token, so a connection missing both names the URL.
  if (!conn.baseUrl) throw new ToilError('NOT_CONFIGURED', 'Dynatrace baseUrl not configured.', { fix: setHint(conn, area, 'baseUrl') });
  if (!conn.apiToken) throw new ToilError('NOT_CONFIGURED', 'Dynatrace credentials not configured.', { fix: setHint(conn, area, 'apiToken') });
  return {
    baseUrl: conn.baseUrl,
    headers: { Authorization: `Api-Token ${conn.apiToken}` },
    service: 'Dynatrace',
    authFix: `Dynatrace rejected the access token on connection "${conn.name}". Generate a new one under Access tokens → Generate new token, with the entities.read and problems.read scopes, then set apiToken (${area.envName('apiToken')} for the default connection).`,
  };
}

/** The platform's Grail query API: trace only. */
function platformEndpoint(conn: Connection<DynatraceSettings>, area: HookArea): AreaEndpoint {
  if (!conn.platformUrl) throw new ToilError('NOT_CONFIGURED', 'Dynatrace platformUrl not configured.', { fix: setHint(conn, area, 'platformUrl') });
  if (!conn.platformToken) throw new ToilError('NOT_CONFIGURED', 'Dynatrace platform credentials not configured.', { fix: setHint(conn, area, 'platformToken') });
  return {
    baseUrl: conn.platformUrl,
    headers: { Authorization: `Bearer ${conn.platformToken}` },
    service: 'Dynatrace platform',
    authFix: `Dynatrace rejected the platform token on connection "${conn.name}". Generate a platform token with the storage:spans:read and storage:buckets:read scopes, then set platformToken (${area.envName('platformToken')} for the default connection).`,
  };
}

export const dynatraceArea = defineArea({
  name: 'dynatrace',
  description: 'Dynatrace: monitored entities, services, workloads, problems and distributed traces',
  connection,
  secrets: ['apiToken', 'platformToken'],
  request: classicEndpoint,
  context: {
    // One connection per environment: --env names the connection, or the one whose env setting matches.
    env: { description: 'Named Dynatrace environment to use', flags: '--env <name>', selectsConnection: true },
  },
});

/**
 * The same area with the platform hook, for trace. A request hook answers for
 * one host, so the second host gets a second hook rather than a flag on the
 * first; apiRequest still builds every request, and still refuses any origin
 * but the hook's.
 */
export const dynatracePlatform = { ...dynatraceArea, request: platformEndpoint };

/** Not established; the skill file and the site's integration data say the same. */
export const dynatraceSupported: SupportedVersion = {
  product: 'Dynatrace',
  minimum: null,
  api: 'Environment API v2 and the Grail storage query API v1',
  note: 'The classic commands call Environment API v2 (/api/v2) on SaaS and Managed; trace needs the platform Grail query API (/platform/storage/query/v1), so a deployment without the platform can\'t run it. No release has been verified yet.',
};
