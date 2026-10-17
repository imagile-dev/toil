import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Sonatype OSS Index: known vulnerabilities for a dependency inventory, from
 * its public component-report API, asked anonymously. No connection, no
 * credential and no configurable host: the command names the service
 * (principle 9), so its one host is fixed in code. No account is created,
 * so no account review is scheduled.
 */
export const ossindexArea = defineArea({
  name: 'ossindex',
  description: 'Sonatype OSS Index: known vulnerabilities for a dependency inventory, from the public component-report API',
  connection: z.object({}),
});

/** The public host every ossindex command talks to, and nothing else. */
export const OSSINDEX_URL = 'https://ossindex.sonatype.org';

/** A hosted API with one version; the skill file and the site say the same. */
export const ossindexSupported: SupportedVersion = {
  product: 'OSS Index REST API',
  minimum: 'v3',
  note: 'A public hosted API at https://ossindex.sonatype.org, asked anonymously. No credential is sent.',
};
