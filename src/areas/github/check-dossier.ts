import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, uncheckedScopes, type DossierCheck } from '../../core/check-dossier.js';
import { viewScopes, viewValues } from '../../core/dossier.js';
import { githubArea } from './area.js';
import { github } from './client.js';

/**
 * `toil github check-dossier`: every owner the call's dossier names (`owner`,
 * per repo or not, and `owners`) is a user or organization, and each
 * repository (`repo`) exists under its owner. A repo with no owner to look it
 * up under is reported as unchecked. Read only. Ownership is verified at the
 * counter, with identification.
 */
export const checkDossier = githubArea.command({
  path: ['github', 'check-dossier'],
  description: "Check the call's dossier against GitHub: its owners and repositories exist",
  toolDescription:
    'Checks the GitHub sections of the dossier that applies to this call (or the one named in dossier): each owner it names is a user or organization, and each repository exists under its owner. Returns ok, one check per value with its key path, and any value that couldn\'t be checked; the CLI exits 1 when one is missing or unchecked. Read only.',
  input: z.object({}),
  writes: false,
  // The second sets the area's own inputs; the dossier is checked either way.
  examples: [{}, { owner: 'imagile', repo: 'toil-probe' }],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'github');
    const enc = encodeURIComponent;
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['owner', 'owners']), 'owner', (owner) => exists(() => github(ctx, `/users/${enc(owner)}`)));
    const { scopes, incomplete } = viewScopes(view, ['owner', 'repo']);
    checks.push(
      ...(await checkEach(
        scopes.map((s) => ({ path: s.paths.repo!, value: `${s.values.owner}/${s.values.repo}` })),
        'repo',
        (or) => {
          const at = or.indexOf('/');
          return exists(() => github(ctx, `/repos/${enc(or.slice(0, at))}/${enc(or.slice(at + 1))}`));
        },
      )),
    );
    return dossierCheckResult(ctx, view, checks, uncheckedScopes(incomplete.filter((i) => i.lacks.includes('owner')), 'repo'));
  },
});
