import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck } from '../../core/check-dossier.js';
import { viewScopes, viewValues } from '../../core/dossier.js';
import { githubArea } from './area.js';
import { github } from './client.js';

/**
 * `toil github check-dossier`: every owner the call's dossier names (`owner`,
 * per repo or not, and `owners`) is a user or organization, and each
 * repository (`repo`) exists under its owner. Read only.
 */
export const checkDossier = githubArea.command({
  path: ['github', 'check-dossier'],
  description: "Check the call's dossier against GitHub: its owners and repositories exist",
  toolDescription:
    'Checks the GitHub sections of the dossier that applies to this call (or the one named in dossier): each owner it names is a user or organization, and each repository exists under its owner. Returns ok and one check per value, with its key path; the CLI exits 1 when one is missing. Read only.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'github');
    const enc = encodeURIComponent;
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['owner', 'owners']), 'owner', (owner) => exists(() => github(ctx, `/users/${enc(owner)}`)));
    const repos = viewScopes(view, ['owner', 'repo']).map((s) => ({ path: `${s.path}.repo`, value: `${s.values.owner}/${s.values.repo}` }));
    checks.push(
      ...(await checkEach(repos, 'repo', (or) => {
        const at = or.indexOf('/');
        return exists(() => github(ctx, `/repos/${enc(or.slice(0, at))}/${enc(or.slice(at + 1))}`));
      })),
    );
    return dossierCheckResult(ctx, view, checks);
  },
});
