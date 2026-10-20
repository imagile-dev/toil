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
    connectionString: z
      .string()
      .min(1)
      .optional()
      .describe('API token and server host in one value, <token>@<host>, e.g. abc12345@sde.imagile.dev or abc12345@imagile.sdelements.com'),
    // Usually set once under defaults.sde, so every SD Elements connection shares it.
    project,
  }),
  secrets: ['connectionString'],
  examples: { connectionString: 'abc12345@sde.imagile.dev' },
  notConfigured: {
    message: 'SDElements not configured.',
    // A getter, so the fix can name variables through the area once it exists.
    get fix() {
      return notConfiguredFix();
    },
  },
  context: {
    project: {
      description: 'SD Elements project ID',
      flags: '--project <id>',
      scope: 'command',
      setting: 'project',
    },
  },
  probe: () => ({ path: '/api/v2/users/me/' }),
  request: (connection, area) => {
    const { baseUrl, token } = endpointOf(connection);
    return {
      baseUrl,
      headers: { Authorization: `Token ${token}` },
      service: 'SD Elements',
      authFix: `SD Elements rejected the API token on connection "${connection.name}". Generate a new one in SD Elements under your user menu → API Tokens, then set connectionString to <token>@<host> (${area.envName('connectionString')} for the default connection).`,
    };
  },
});

export type SdeConnection = Connection<z.output<typeof sdeArea.connection>>;

/**
 * `<token>@<host>`, split at the first `@`; the host gets `https://` unless it
 * already has a scheme. No `@`, or `@` first, sets neither half, exactly as
 * before: the command then reports SD Elements as not configured. Suspected
 * bug (#86 item 2): a second `@` stays in the host, as URL userinfo.
 */
export function parseConnectionString(value: string): { token: string; baseUrl: string } | undefined {
  const at = value.indexOf('@');
  if (at <= 0) return undefined;
  const host = value.slice(at + 1);
  return { token: value.slice(0, at), baseUrl: /^https?:\/\//i.test(host) ? host : `https://${host}` };
}

/**
 * The base URL and token for a connection, both from its `connectionString`.
 * Neither half is the "not configured" failure the commands report before
 * anything else, project checks included.
 */
export function endpointOf(connection: SdeConnection): { baseUrl: string; token: string } {
  const parsed = connection.connectionString === undefined ? undefined : parseConnectionString(connection.connectionString);
  if (!parsed) throw new ToilError('NOT_CONFIGURED', 'SDElements not configured.', { fix: notConfiguredFix() });
  return parsed;
}

/** What to set when SD Elements isn't configured. */
function notConfiguredFix(): string {
  return `Set ${sdeArea.envName('connectionString')} to <token>@<host>, e.g. abc12345@sde.imagile.dev, or add an sde connection with toil connections add.`;
}

/** Not established: the commands use `/api/v2/` only and make no version check. */
export const sdeSupported: SupportedVersion = {
  product: 'SD Elements',
  minimum: null,
  api: 'REST API v2',
  note: 'toil calls /api/v2/ with an API token sent as Authorization: Token. server-info reports the version but needs a super-user, so toil makes no version check. No release has been verified yet.',
};
