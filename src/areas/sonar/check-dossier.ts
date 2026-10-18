import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, notFound } from '../../core/check-dossier.js';
import { viewValues } from '../../core/dossier.js';
import { sonarArea } from './area.js';
import { sonar } from './client.js';

/**
 * `toil sonar check-dossier`: every SonarQube project key the call's dossier
 * names (`project`, per repo or not, `projectKeys` and the `projects` list)
 * exists. One `api/components/show` per key, which needs only Browse, where
 * a project search would need Administer System. Read only.
 */
export const checkDossier = sonarArea.command({
  path: ['sonar', 'check-dossier'],
  description: "Check the call's dossier against SonarQube: its project keys exist",
  toolDescription:
    'Checks the SonarQube sections of the dossier that applies to this call (or the one named in dossier): each project key it names exists. Returns ok and one check per key, with its key path; the CLI exits 1 when one is missing. Read only.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'sonar');
    const checks = await checkEach(viewValues(view, ['project', 'projectKeys', 'projects']), 'project', async (key) => {
      try {
        await sonar(ctx, '/components/show', { component: key });
        return true;
      } catch (err) {
        if (notFound(err)) return false;
        throw err;
      }
    });
    return dossierCheckResult(ctx, view, checks);
  },
});
