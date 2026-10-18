import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Sauce Labs: test jobs on virtual and real devices, builds, the real-device
 * catalog and Real Device Access sessions, Sauce Connect tunnels, app storage
 * metadata and teams, all on the one regional API host named by `baseUrl`.
 * The username travels twice, once in the Basic header and once in most
 * paths, so that nobody can say it wasn't submitted in duplicate.
 */
export const saucelabsArea = defineArea({
  name: 'saucelabs',
  description: 'Sauce Labs: test jobs, builds, real devices and device sessions, tunnels, platforms, app storage and teams',
  connection: z.object({
    baseUrl: z.url().describe('Data-center API endpoint, e.g. https://api.us-west-1.saucelabs.com'),
    username: z.string().min(1).describe('Sauce Labs username; most API paths are scoped to it'),
    accessKey: z.string().min(1).describe('Sauce Labs access key'),
  }),
  secrets: ['accessKey'],
  examples: { baseUrl: 'https://api.us-west-1.saucelabs.com' },
  // saucectl, Sauce Connect and Sauce's own CI docs read these two, so a pipeline that already runs Sauce needs nothing more.
  fallbacks: { username: ['SAUCE_USERNAME'], accessKey: ['SAUCE_ACCESS_KEY'] },
  probe: (c) => ({ path: `/rest/v1.2/users/${encodeURIComponent(c.username)}/concurrency` }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.accessKey}`).toString('base64')}` },
    service: 'Sauce Labs',
    authFix: `Sauce Labs rejected the username and access key on connection "${connection.name}". Copy both from User settings → Access key in Sauce Labs, check baseUrl is your account's data center, then set username (${area.envName('username')}, or SAUCE_USERNAME) and accessKey (${area.envName('accessKey')}, or SAUCE_ACCESS_KEY) for the default connection.`,
  }),
});

/** Sauce Labs is SaaS only: the API versions are fixed in the paths, and the region is chosen by baseUrl. */
export const saucelabsSupported: SupportedVersion = {
  product: 'Sauce Labs',
  minimum: null,
  note: 'Sauce Labs is SaaS only, so there is no server release to pin. toil calls the REST v1 and v1.2, Real Device Access v2, Builds v2, Team Management v1 and Storage v1 APIs on the data-center host in baseUrl. Nothing has been verified against a live account yet.',
};
