import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Sonatype IQ Server: applications, organizations and policies read from its
 * `/api/v2` REST API, and a policy evaluation of a dependency inventory. The
 * credential is a user token pair, a code and a passcode, sent as HTTP Basic;
 * it is not the account's password, whatever the login form would prefer.
 */
export const sonatypeiqArea = defineArea({
  name: 'sonatypeiq',
  description: 'Sonatype IQ Server: applications, organizations, policies and policy evaluations',
  connection: z.object({
    baseUrl: z.url().describe('Sonatype IQ Server root, e.g. https://iq.imagile.dev'),
    userCode: z.string().min(1).describe('User token code'),
    passcode: z.string().min(1).describe('User token passcode'),
  }),
  secrets: ['passcode'],
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Basic ${Buffer.from(`${connection.userCode}:${connection.passcode}`).toString('base64')}` },
    service: 'Sonatype IQ Server',
    authFix: `Sonatype IQ Server rejected the user token on connection "${connection.name}". In IQ Server, open your profile's User Token page and create one, then set userCode (${area.envName('userCode')}) and passcode (${area.envName('passcode')}) for the default connection.`,
  }),
});

/** Not established: the commands use only `/api/v2` endpoints, and no IQ Server release has been verified. */
export const sonatypeiqSupported: SupportedVersion = {
  product: 'Sonatype IQ Server',
  minimum: null,
  api: 'REST API v2',
  note: 'toil calls only /api/v2 endpoints, with a user token pair sent as HTTP Basic. No release has been verified yet.',
};
