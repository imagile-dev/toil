import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * OSV.dev: known vulnerabilities for a dependency inventory, from Google's
 * public OSV API. No connection, no credential and no configurable host: the
 * command names the service (principle 9), so its one host is fixed in code.
 * There is nothing to configure, which makes it the only area whose setup
 * guide is complete.
 */
export const osvArea = defineArea({
  name: 'osv',
  description: 'OSV.dev: known vulnerabilities for a dependency inventory, from the public OSV API',
  connection: z.object({}),
});

/** The public host every osv command talks to, and nothing else. */
export const OSV_URL = 'https://api.osv.dev';

/** A hosted API with one version; the skill file and the site say the same. */
export const osvSupported: SupportedVersion = {
  product: 'OSV API',
  minimum: 'v1',
  note: 'A public hosted API at https://api.osv.dev, not a server you run. No credential is sent.',
};
