import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, notFound } from '../../../core/check-dossier.js';
import { viewValues } from '../../../core/dossier.js';
import { apiPath } from '../../../core/api-path.js';
import { confluenceArea } from '../area.js';
import { confluence } from './client.js';

/**
 * `toil confluence check-dossier`: every space key the call's dossier names
 * (`space` and the `spaces` list) exists in Confluence. Read only.
 */
export const checkDossier = confluenceArea.command({
  path: ['confluence', 'check-dossier'],
  description: "Check the call's dossier against Confluence: its spaces exist",
  toolDescription:
    'Checks the Confluence sections of the dossier that applies to this call (or the one named in dossier): each space key it names exists. Returns ok and one check per key, with its key path; the CLI exits 1 when one is missing. Read only.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'confluence');
    const checks = await checkEach(viewValues(view, ['space', 'spaces']), 'space', async (key) => {
      try {
        await confluence(ctx, apiPath`/space/${key}`);
        return true;
      } catch (err) {
        if (notFound(err)) return false;
        throw err;
      }
    });
    return dossierCheckResult(ctx, view, checks);
  },
});
