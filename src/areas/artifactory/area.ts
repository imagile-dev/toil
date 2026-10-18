import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * JFrog Artifactory: repositories, artifact metadata and properties, AQL
 * search, Build Integration, and version and license lookups for a
 * dependency inventory, all over the classic REST API under `api/`. The
 * hook sends only the token; each call adds the headers the canonical
 * implementation sent with it. An artifact repository is where builds go to
 * be retained for the period specified in a policy nobody has read.
 */
export const artifactoryArea = defineArea({
  name: 'artifactory',
  description: 'JFrog Artifactory: repositories, artifact metadata and properties, AQL search, builds, and dependency versions and licenses',
  connection: z.object({
    baseUrl: z.url().describe('Artifactory root, keeping any context path, e.g. https://artifactory.imagile.dev/artifactory'),
    token: z.string().min(1).describe('Artifactory access or identity token'),
    npmRepo: z.string().min(1).optional().describe('npm repository key that outdated and license-check look packages up in'),
    nugetRepo: z.string().min(1).optional().describe('NuGet repository key that outdated and license-check look packages up in'),
    mavenRepo: z.string().min(1).optional().describe('Maven repository key that outdated looks packages up in'),
  }),
  secrets: ['token'],
  // The ping answers anyone; the repository list needs a user, and a bad token is a 401 even where anonymous access is on.
  probe: () => ({ path: '/api/repositories' }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.token}` },
    service: 'Artifactory',
    authFix: tokenFix(connection.name, area.envName('token')),
  }),
});

/** What to do when Artifactory rejects the token: where to make one, and where to put it. */
export function tokenFix(connection: string, envVar: string): string {
  return `Artifactory rejected the token on connection "${connection}". Generate a new one under your profile (Edit Profile → Generate an Identity Token), then set token (${envVar} for the default connection).`;
}

/** Not established: the commands use the classic REST API and AQL with a Bearer token. The skill file and the site's integration data say the same. */
export const artifactorySupported: SupportedVersion = {
  product: 'JFrog Artifactory',
  minimum: null,
  api: 'REST API',
  note: 'toil calls the classic REST API (api/...) and AQL with an access or identity token sent as a Bearer header. No release has been verified yet.',
};
