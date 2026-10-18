import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Contrast Security: applications, vulnerability findings (traces) and
 * libraries for one organization, read from the TeamServer "ng" REST API.
 * Contrast authenticates every request twice over, with an org API key and a
 * user's service key, which is the closest thing to a countersigned form most
 * APIs offer.
 */
export const contrastArea = defineArea({
  name: 'contrast',
  description: 'Contrast Security: applications, vulnerability findings and libraries for an organization',
  connection: z.object({
    baseUrl: z.url().describe('Contrast instance root, e.g. https://contrast.imagile.dev or https://app.contrastsecurity.com'),
    orgUuid: z.string().min(1).describe('Organization UUID'),
    username: z.string().min(1).describe('Contrast username'),
    apiKey: z.string().min(1).describe('Organization API key'),
    serviceKey: z.string().min(1).describe('Your service key'),
  }),
  secrets: ['apiKey', 'serviceKey'],
  // Contrast's own format: base64(username:serviceKey) with no "Basic " scheme, plus the
  // org key in API-Key. Core refuses a cross-origin redirect, so API-Key stays on this host.
  probe: (c) => ({ path: `/Contrast/api/ng/${c.orgUuid}/applications`, query: { limit: 1 } }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: {
      Authorization: Buffer.from(`${connection.username}:${connection.serviceKey}`).toString('base64'),
      'API-Key': connection.apiKey,
    },
    service: 'Contrast',
    authFix: `Contrast rejected the credentials on connection "${connection.name}". In Contrast, open User Settings → Your Keys and check username (${area.envName('username')}), apiKey (${area.envName('apiKey')}) and serviceKey (${area.envName('serviceKey')}) for the default connection.`,
  }),
});

/** Not established: the commands use the TeamServer "ng" REST API on SaaS and self-hosted alike. */
export const contrastSupported: SupportedVersion = {
  product: 'Contrast TeamServer',
  minimum: null,
  api: 'ng REST API',
  note: 'toil calls the TeamServer "ng" REST API (/Contrast/api/ng/...) with an API key and a service key. No release has been verified yet.',
};
