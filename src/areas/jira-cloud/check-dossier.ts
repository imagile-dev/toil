import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck } from '../../core/check-dossier.js';
import { viewValues } from '../../core/dossier.js';
import { apiPath } from '../../core/api-path.js';
import { jiraCloudArea } from './area.js';
import { jiraCloud } from './client.js';

/**
 * `toil jira-cloud check-dossier`: as `jira check-dossier`, on Cloud's API.
 * Every project the call's dossier names exists, and every field alias names
 * a field id the site has. Read only. The same audit as the data center's,
 * conducted remotely, with the same form.
 */
export const checkDossier = jiraCloudArea.command({
  path: ['jira-cloud', 'check-dossier'],
  description: "Check the call's dossier against Jira Cloud: its projects and field ids exist",
  toolDescription:
    "Checks the Jira Cloud sections of the dossier that applies to this call (or the one named in dossier): each project key it names exists, and each field alias points at a field id the site has. Returns ok and one check per value, with its key path; the CLI exits 1 when one is missing. Read only.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'jira-cloud');
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['project', 'projects']), 'project', (key) => exists(() => jiraCloud(ctx, apiPath`/rest/api/3/project/${key}`)));
    const aliases = view.sections.flatMap((s) =>
      typeof s.values.fields === 'object' && s.values.fields !== null ? Object.entries(s.values.fields as Record<string, unknown>).map(([alias, id]) => ({ path: `${s.path}.fields.${alias}`, value: String(id) })) : [],
    );
    if (aliases.length > 0) {
      const ids = new Set((await jiraCloud<Array<{ id: string }>>(ctx, '/rest/api/3/field')).map((f) => f.id));
      checks.push(...aliases.map((a) => ({ ...a, kind: 'field', found: ids.has(a.value) })));
    }
    return dossierCheckResult(ctx, view, checks);
  },
});
