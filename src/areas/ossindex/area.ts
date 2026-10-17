import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Sonatype OSS Index: known vulnerabilities for a dependency inventory, from
 * its public component-report API. OSS Index now refuses anonymous requests
 * (HTTP 401, seen live on 2026-10-17; #91 item 7), so a connection holds a
 * free account's username and API token, sent as Basic auth. The host is
 * fixed in code, because the command names the service (principle 9), so the
 * credential can only ever go to ossindex.sonatype.org. The account is free;
 * the form to justify it is not, but toil doesn't ask for one.
 */

/** The public host every ossindex command talks to, and nothing else. */
export const OSSINDEX_URL = 'https://ossindex.sonatype.org';

export const ossindexArea = defineArea({
  name: 'ossindex',
  description: 'Sonatype OSS Index: known vulnerabilities for a dependency inventory, from the public component-report API',
  connection: z.object({
    username: z.string().min(1).describe('OSS Index account username (the email address you signed up with)'),
    token: z.string().min(1).describe('OSS Index API token, from your account settings'),
  }),
  secrets: ['token'],
  request: (connection, area) => ({
    baseUrl: OSSINDEX_URL,
    headers: { Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.token}`).toString('base64')}` },
    service: 'Sonatype OSS Index',
    authFix: `OSS Index rejected the username and token on connection "${connection.name}". Sign in at ${OSSINDEX_URL}, copy the API token from your account settings, then set username and token (${area.envName('username')} and ${area.envName('token')} for the default connection).`,
  }),
});

/** A hosted API with one version; the skill file and the site say the same. */
export const ossindexSupported: SupportedVersion = {
  product: 'OSS Index REST API',
  minimum: 'v3',
  note: "A public hosted API at https://ossindex.sonatype.org, asked with a free account's username and API token.",
};
