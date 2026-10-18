import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, notFound } from '../../core/check-dossier.js';
import { viewValues } from '../../core/dossier.js';
import { jiraArea } from './area.js';
import { jira } from './client.js';

/**
 * `toil jira check-dossier`: the call's dossier's Jira sections against Jira
 * itself. Every project it names (`project`, per repo or not, and the
 * `projects` list) must exist, and every field alias must name a field id
 * Jira has. Read only, through the connection the call resolved, which may be
 * the dossier's own choice. The audit visits the department it audits.
 */
export const checkDossier = jiraArea.command({
  path: ['jira', 'check-dossier'],
  description: "Check the call's dossier against Jira: its projects and field ids exist",
  toolDescription:
    "Checks the Jira sections of the dossier that applies to this call (or the one named in dossier) against Jira: each project key it names exists, and each field alias points at a field id Jira has. Returns ok and one check per value, with its key path; the CLI exits 1 when one is missing. Read only.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'jira');
    const checks = await checkEach(viewValues(view, ['project', 'projects']), 'project', async (key) => {
      try {
        await jira(ctx, `/rest/api/2/project/${encodeURIComponent(key)}`);
        return true;
      } catch (err) {
        if (notFound(err)) return false;
        throw err;
      }
    });
    const aliases = view.sections.flatMap((s) =>
      typeof s.values.fields === 'object' && s.values.fields !== null ? Object.entries(s.values.fields as Record<string, unknown>).map(([alias, id]) => ({ path: `${s.path}.fields.${alias}`, value: String(id) })) : [],
    );
    if (aliases.length > 0) {
      const ids = new Set((await jira<Array<{ id: string }>>(ctx, '/rest/api/2/field')).map((f) => f.id));
      checks.push(...aliases.map((a) => ({ ...a, kind: 'field', found: ids.has(a.value) })));
    }
    return dossierCheckResult(ctx, view, checks);
  },
});
