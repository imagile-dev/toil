import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck } from '../../core/check-dossier.js';
import { viewScopes, viewValues, type DossierView } from '../../core/dossier.js';
import { ToilError } from '../../core/errors.js';
import { adoArea } from './area.js';
import { ado, API } from './client.js';

/**
 * `toil ado check-dossier`: the call's dossier's Azure DevOps sections against
 * the server. Each team project (`project`, per repo or not, and `projects`)
 * must exist in its collection, and each repository (`repo`) in its project.
 * The collection is the section's (per repo or not), else the call's own
 * (`--collection`, or the connection's). A value with no collection anywhere
 * is refused rather than skipped. Read only.
 */
export const checkDossier = adoArea.command({
  path: ['ado', 'check-dossier'],
  description: "Check the call's dossier against Azure DevOps: its projects and repositories exist",
  toolDescription:
    "Checks the Azure DevOps sections of the dossier that applies to this call (or the one named in dossier): each team project it names exists in its collection, and each repository in its project. The collection comes from the dossier, else the call's collection or the connection's. Returns ok and one check per value, with its key path; the CLI exits 1 when one is missing. Read only.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'ado');
    const fallback = ctx.context.collection || ctx.context.organization || undefined;
    const enc = encodeURIComponent;
    const scoped = (keys: string[]) => viewScopes(view, keys).map((s) => ({ ...s, collection: collectionFor(view, s.path, s.repo) ?? fallback }));
    const projects = [
      ...scoped(['project']).map((s) => ({ path: `${s.path}.project`, collection: s.collection, value: s.values.project! })),
      ...viewValues(view, ['projects']).map((p) => ({ path: p.path, collection: fallback, value: p.value })),
    ];
    const repos = scoped(['project', 'repo']).map((s) => ({ path: `${s.path}.repo`, collection: s.collection, value: `${s.values.project}/${s.values.repo}` }));
    const orphan = [...projects, ...repos].find((v) => !v.collection);
    if (orphan) {
      throw new ToilError('INVALID_INPUT', `${orphan.path} names "${orphan.value}", but there's no collection to look it up in.`, {
        fix: 'Pass --collection, set collection on the connection, or set "collection" in the dossier\'s ado section.',
      });
    }
    const checks: DossierCheck[] = await checkEach(
      projects.map((p) => ({ path: p.path, value: `${p.collection}/${p.value}` })),
      'project',
      (cp) => {
        const [collection, project] = splitOnce(cp);
        return exists(() => ado(ctx, `/${enc(collection)}/_apis/projects/${enc(project)}?api-version=${API}`));
      },
    );
    checks.push(
      ...(await checkEach(
        repos.map((r) => ({ path: r.path, value: `${r.collection}/${r.value}` })),
        'repo',
        (cpr) => {
          const [collection, rest] = splitOnce(cpr);
          const [project, repo] = splitOnce(rest);
          return exists(() => ado(ctx, `/${enc(collection)}/${enc(project)}/_apis/git/repositories/${enc(repo)}?api-version=${API}`));
        },
      )),
    );
    return dossierCheckResult(ctx, view, checks);
  },
});

/** The section's `collection` for a scope: one value, or that repo's. */
function collectionFor(view: DossierView, path: string, repo: string | null): string | undefined {
  const section = view.sections.find((s) => path === s.path || path.startsWith(`${s.path} (`));
  const value = section?.values.collection;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && repo !== null) {
    const one = (value as Record<string, unknown>)[repo];
    return typeof one === 'string' ? one : undefined;
  }
  return undefined;
}

const splitOnce = (value: string): [string, string] => {
  const at = value.indexOf('/');
  return [value.slice(0, at), value.slice(at + 1)];
};
