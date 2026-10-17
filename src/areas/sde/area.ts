import { z } from 'zod';
import type { Connection } from '../../core/area.js';
import { defineArea } from '../../core/area.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * SD Elements: projects, countermeasures (tasks), threats and users, read
 * from the REST API under `/api/v2/`. Every command reads. The server is
 * where security requirements are recorded; toil only reads them back, which
 * is the step most compliance programmes also stop at.
 */

const project = z.string().min(1).optional().describe('Default project ID for project, tasks, task and threats');

export const sdeArea = defineArea({
  name: 'sde',
  description: 'SD Elements: projects, countermeasures, threats and users',
  connection: z.object({
    baseUrl: z.url().optional().describe('SD Elements server root, e.g. https://sde.imagile.dev (or set connectionString)'),
    token: z.string().min(1).optional().describe('SD Elements API token (or set connectionString)'),
    connectionString: z
      .string()
      .min(1)
      .optional()
      .describe('Token and host in one value, <token>@<host>, e.g. abc12345@sde.imagile.dev; baseUrl and token win where set'),
    // Usually set once under defaults.sde, so every SD Elements connection shares it.
    project,
  }),
  secrets: ['token', 'connectionString'],
  // The old single setting held both halves, and `connection` now names a connection, so it lands here.
  renamed: { connection: 'connectionString' },
  context: {
    project: {
      description: 'SD Elements project ID',
      flags: '--project <id>',
      scope: 'command',
      setting: 'project',
    },
    // `sde project` has always spelt the same project ID --id.
    id: {
      description: 'SD Elements project ID',
      flags: '--id <id>',
      scope: 'command',
      setting: 'project',
    },
  },
  request: (connection, area) => {
    const { baseUrl, token } = endpointOf(connection);
    return {
      baseUrl,
      headers: { Authorization: `Token ${token}` },
      service: 'SD Elements',
      authFix: `SD Elements rejected the API token on connection "${connection.name}". Generate a new one in SD Elements under your user menu → API Tokens, then set token (${area.envName('token')} for the default connection), or connectionString as <token>@<host>.`,
    };
  },
});

export type SdeConnection = Connection<z.output<typeof sdeArea.connection>>;

/**
 * `<token>@<host>`, split at the first `@`; the host gets `https://` unless it
 * already has a scheme. No `@`, or `@` first, sets neither half, exactly as
 * before: the command then reports SD Elements as not configured.
 */
export function parseConnectionString(value: string): { token: string; baseUrl: string } | undefined {
  const at = value.indexOf('@');
  if (at <= 0) return undefined;
  const host = value.slice(at + 1);
  return { token: value.slice(0, at), baseUrl: /^https?:\/\//i.test(host) ? host : `https://${host}` };
}

/**
 * The base URL and token for a connection: `baseUrl` and `token` where set,
 * each half otherwise from `connectionString`. Neither is the "not
 * configured" failure the commands report before anything else, project
 * checks included.
 */
export function endpointOf(connection: SdeConnection): { baseUrl: string; token: string } {
  const parsed = connection.connectionString === undefined ? undefined : parseConnectionString(connection.connectionString);
  const baseUrl = connection.baseUrl ?? parsed?.baseUrl;
  const token = connection.token ?? parsed?.token;
  const fix = `Set ${sdeArea.envName('connectionString')} (or the old ${(sdeArea.envName as (key: string) => string)('connection')}) to <token>@<host>, or set ${sdeArea.envName('baseUrl')} and ${sdeArea.envName('token')}; or add an sde connection with toil connections add.`;
  if (!baseUrl) throw new ToilError('NOT_CONFIGURED', 'SDElements not configured.', { fix });
  if (!token) throw new ToilError('NOT_CONFIGURED', 'SDElements credentials not configured.', { fix });
  return { baseUrl, token };
}

/** Not established: the commands use `/api/v2/` only and make no version check. */
export const sdeSupported: SupportedVersion = {
  product: 'SD Elements',
  minimum: null,
  api: 'REST API v2',
  note: 'toil calls /api/v2/ with an API token sent as Authorization: Token. server-info reports the version but needs a super-user, so toil makes no version check. No release has been verified yet.',
};
