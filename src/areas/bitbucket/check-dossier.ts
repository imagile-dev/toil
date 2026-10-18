import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, uncheckedScopes, type DossierCheck } from '../../core/check-dossier.js';
import { viewScopes, viewValues } from '../../core/dossier.js';
import { bitbucketArea } from './area.js';
import { bb } from './client.js';

/**
 * `toil bitbucket check-dossier`: every project key the call's dossier names
 * (`project`, per repo or not, and `projects`) exists, and so does each
 * repository (`repo`) in its project. A repo with no project to look it up in
 * is reported as unchecked. Read only. A repository is presumed to exist only
 * once its project has confirmed it in writing.
 */
export const checkDossier = bitbucketArea.command({
  path: ['bitbucket', 'check-dossier'],
  description: "Check the call's dossier against Bitbucket: its projects and repositories exist",
  toolDescription:
    'Checks the Bitbucket sections of the dossier that applies to this call (or the one named in dossier): each project key it names exists, and each repository in its project. Returns ok, one check per value with its key path, and any value that couldn\'t be checked; the CLI exits 1 when one is missing or unchecked. Read only.',
  input: z.object({}),
  writes: false,
  // The second sets the area's own inputs; the dossier is checked either way.
  examples: [{}, { project: 'PROJ', repo: 'imagile-api' }],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'bitbucket');
    const enc = encodeURIComponent;
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['project', 'projects']), 'project', (key) => exists(() => bb(ctx, `/rest/api/1.0/projects/${enc(key)}`)));
    const { scopes, incomplete } = viewScopes(view, ['project', 'repo']);
    checks.push(
      ...(await checkEach(
        scopes.map((s) => ({ path: s.paths.repo!, value: `${s.values.project}/${s.values.repo}` })),
        'repo',
        (pr) => {
          const at = pr.indexOf('/');
          return exists(() => bb(ctx, `/rest/api/1.0/projects/${enc(pr.slice(0, at))}/repos/${enc(pr.slice(at + 1))}`));
        },
      )),
    );
    return dossierCheckResult(ctx, view, checks, uncheckedScopes(incomplete.filter((i) => i.lacks.includes('project')), 'repo'));
  },
});
