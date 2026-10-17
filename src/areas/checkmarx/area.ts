import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { TokenExchange } from '../../core/token.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Checkmarx One (cloud): projects, scans and scan results statistics, read
 * from the REST API under the connection's `baseUrl` (which ends in `/api`).
 * The credential is an API key, which is a refresh token: it's exchanged at
 * the region's IAM host for a short-lived bearer token, so every request
 * arrives with a permit issued minutes earlier by a different office.
 */

/** The client_id the exchange uses when the API key doesn't decode or names none. */
export const FALLBACK_CLIENT_ID = 'ast-app';

/**
 * The `azp` claim of the API key's JWT payload, or `ast-app`. Read exactly as
 * the predecessor read it: base64url swapped to base64 by hand, any failure
 * (not a JWT, not JSON, no `azp`, an empty one) falling back.
 */
export function apiKeyClientId(apiKey: string): string {
  try {
    const payload = apiKey.split('.')[1];
    if (!payload) return FALLBACK_CLIENT_ID;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as { azp?: unknown };
    return typeof claims.azp === 'string' && claims.azp ? claims.azp : FALLBACK_CLIENT_ID;
  } catch {
    return FALLBACK_CLIENT_ID;
  }
}

/**
 * The token endpoint: the API host with its `ast.` label swapped for `iam.`
 * (`eu.ast.checkmarx.net` to `eu.iam.checkmarx.net`), always https, with the
 * base URL's port and path dropped, and the tenant put into the path as typed.
 * Suspected bugs (#89 items 3 and 6): the port is dropped and the tenant isn't
 * encoded. Core refuses the result unless it's under checkmarx.net or the
 * connection's own origin.
 */
export function tokenUrl(baseUrl: string, tenantName: string): string {
  const iamHost = new URL(baseUrl).hostname.replace(/(^|\.)ast\./, '$1iam.');
  return `https://${iamHost}/auth/realms/${tenantName}/protocol/openid-connect/token`;
}

const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});

export const checkmarxArea = defineArea({
  name: 'checkmarx',
  description: 'Checkmarx One: projects, scans and scan results statistics',
  connection: z.object({
    baseUrl: z.url().describe('Checkmarx One API base, ending in /api, e.g. https://eu.ast.checkmarx.net/api'),
    tenantName: z.string().min(1).describe('Tenant name, e.g. imagile'),
    apiKey: z.string().min(1).describe('API key'),
  }),
  secrets: ['apiKey'],
  request: (connection, area) => {
    const exchange: TokenExchange = {
      url: tokenUrl(connection.baseUrl, connection.tenantName),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: apiKeyClientId(connection.apiKey), refresh_token: connection.apiKey }).toString(),
      },
      credential: connection.apiKey,
      // Number(), as the predecessor's `expires_in * 1000` coerced: a missing
      // expires_in is NaN, so the token is never reused (#89 item 5).
      read: (body) => ({ token: obj(body).access_token as string | undefined, expiresInSeconds: Number(obj(body).expires_in) }),
    };
    return {
      baseUrl: connection.baseUrl,
      service: 'Checkmarx One',
      authFix: `Checkmarx One rejected the API key on connection "${connection.name}". Generate a new API key in Checkmarx One, check that tenantName is the tenant it belongs to, then set apiKey (${area.envName('apiKey')} for the default connection).`,
      token: { exchange, headers: (token) => ({ Authorization: `Bearer ${token}` }), vendorDomain: 'checkmarx.net' },
    };
  },
});

/** Cloud only, so there's no release to name; the skill file and the site's integration data say the same. */
export const checkmarxSupported: SupportedVersion = {
  product: 'Checkmarx One',
  minimum: null,
  api: 'REST API',
  note: 'Checkmarx One is cloud only, so there is no server release to pin. toil calls its REST API under /api with a bearer token exchanged from an API key.',
};
