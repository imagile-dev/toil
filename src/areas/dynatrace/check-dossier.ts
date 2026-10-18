import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck } from '../../core/check-dossier.js';
import { viewValues } from '../../core/dossier.js';
import { dynatraceArea } from './area.js';
import { dynatrace } from './client.js';

/**
 * `toil dynatrace check-dossier`: every entity id the call's dossier names
 * for the call's environment (`entity`, `entities`) exists in that
 * environment's Dynatrace. Read only.
 */
export const checkDossier = dynatraceArea.command({
  path: ['dynatrace', 'check-dossier'],
  description: "Check the call's dossier against Dynatrace: its entities exist",
  toolDescription:
    "Checks the Dynatrace sections of the dossier that applies to this call, for the call's environment (env, else the dossier's own): each entity id it names exists. Returns ok and one check per id, with its key path; the CLI exits 1 when one is missing. Read only.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'dynatrace');
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['entity', 'entities']), 'entity', (id) => exists(() => dynatrace(ctx, `/api/v2/entities/${encodeURIComponent(id)}`)));
    return dossierCheckResult(ctx, view, checks);
  },
});
