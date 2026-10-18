import { z } from 'zod';
import type { Connection } from '../../core/area.js';
import { defineArea } from '../../core/area.js';
import { buildUrl } from '../../core/rest.js';
import type { SupportedVersion } from '../../core/supported.js';
import type { TokenExchange } from '../../core/token.js';

/**
 * Alation: the data catalog (data sources, schemas, tables, columns, search)
 * and Document Hubs, over the public REST API. Every path is a Django route,
 * so the trailing slash is load-bearing. Auth is a 60-day refresh token
 * exchanged for a 24-hour access token: a pass to obtain a pass, which is at
 * least an honest description of most access processes.
 */

/** Alation's documented default access-token lifetime, used when the answer gives no expiry. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** The numeric ID Alation shows with the refresh token: a number or a string, never anything else. */
const USER_ID = /^[1-9]\d*$/;
const userIdMessage = 'Alation userId must be a positive integer (the numeric ID Alation returned when the refresh token was created).';

const connectionSchema = z.object({
  baseUrl: z.url().describe('Alation instance root, e.g. https://alation.imagile.dev'),
  refreshToken: z.string().min(1).describe('Long-lived refresh token, generated in Alation (60-day default life)'),
  // A hand-written config may hold a number or a string; env vars are always strings.
  userId: z
    .union([z.number(), z.string()])
    .refine((value) => USER_ID.test(String(value).trim()), { message: userIdMessage })
    .describe('Numeric ID of the user the refresh token was created for'),
});

export type AlationConnection = Connection<z.output<typeof connectionSchema>>;

export const alationArea = defineArea({
  name: 'alation',
  description: 'Alation data catalog (data sources, schemas, tables, columns, search, documents)',
  connection: connectionSchema,
  secrets: ['refreshToken'],
  examples: { baseUrl: 'https://alation.imagile.dev', userId: '102' },
  // Any read exchanges the refresh token first, so a rejected token fails here before the read.
  probe: () => ({ path: 'integration/v1/datasource/', query: { limit: 1 } }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    service: 'Alation',
    authFix: authFix(connection.name, area.envName('refreshToken'), area.envName('userId')),
    token: {
      exchange: tokenExchange(connection),
      headers: (token) => ({ TOKEN: token }),
    },
  }),
});

/** The fix for a refused refresh token, naming both settings. */
export function authFix(connection: string, refreshTokenVar: string, userIdVar: string): string {
  return `Check refreshToken (${refreshTokenVar}) and userId (${userIdVar}) on connection "${connection}"; refresh tokens expire after 60 days by default. Make a new one in Alation under your profile → Account Settings → Authentication.`;
}

/** The user ID as the exchange sends it: trimmed, as a number. */
export const userIdOf = (connection: AlationConnection): number => Number(String(connection.userId).trim());

/**
 * POST `integration/v1/createAPIAccessToken/` with `{ refresh_token, user_id }`,
 * reading `api_access_token` and `token_expires_at`. A missing or unreadable
 * expiry means Alation's 24-hour default. Core caches the token per connection
 * and renews it 60 s before expiry.
 */
export function tokenExchange(connection: AlationConnection): TokenExchange {
  return {
    url: buildUrl(connection.baseUrl, 'integration/v1/createAPIAccessToken/'),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: connection.refreshToken, user_id: userIdOf(connection) }),
    },
    credential: `${connection.refreshToken}\0${userIdOf(connection)}`,
    read: (body) => {
      const answer = (typeof body === 'object' && body !== null ? body : {}) as { api_access_token?: unknown; token_expires_at?: unknown };
      const expiry = typeof answer.token_expires_at === 'string' && answer.token_expires_at !== '' ? Date.parse(answer.token_expires_at) : NaN;
      return {
        token: typeof answer.api_access_token === 'string' ? answer.api_access_token : undefined,
        ...(Number.isNaN(expiry) ? {} : { expiresInSeconds: lifetimeFor(expiry - Date.now()) }),
      };
    },
    defaultLifetimeSeconds: DEFAULT_TTL_SECONDS,
    service: 'Alation',
  };
}

/**
 * The lifetime to report to core so it renews exactly 60 s before expiry, as
 * the contract specifies. Core renews a lifetime L at L - min(60 s, L / 10), so a
 * token with under ten minutes left is reported a little longer than its
 * remainder minus a minute, and one with a minute or less as already due.
 */
export function lifetimeFor(remainingMs: number): number {
  const lifetimeMs = remainingMs >= 600_000 ? remainingMs : Math.max(0, (remainingMs - 60_000) / 0.9);
  return lifetimeMs / 1000;
}

/** Not established. Document Hubs and the token APIs under integration/v1 are the floor in practice. */
export const alationSupported: SupportedVersion = {
  product: 'Alation',
  minimum: null,
  api: 'Integration API v1/v2',
  note: 'toil needs the token APIs under integration/v1 and the Document Hub endpoints under integration/v2 (document, folder); releases with only Articles lack the latter. No release has been verified yet.',
};
