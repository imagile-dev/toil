import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck } from '../../core/check-dossier.js';
import { viewValues } from '../../core/dossier.js';
import { openshiftArea } from './area.js';
import { ns, openshift } from './client.js';

/**
 * `toil openshift check-dossier`: the call's dossier's OpenShift sections for
 * the call's environment, against the cluster that environment's connection
 * names. Each namespace (`namespace`, `namespaces`) must be a project the
 * token can see, and each deployment in `deployments` must exist in its
 * section's namespace. Read only.
 */
export const checkDossier = openshiftArea.command({
  path: ['openshift', 'check-dossier'],
  description: "Check the call's dossier against OpenShift: its namespaces and deployments exist",
  toolDescription:
    "Checks the OpenShift sections of the dossier that applies to this call, for the call's environment (env, else the dossier's own), against that environment's cluster: each namespace it names is a project the token can see, and each deployment in deployments exists in its namespace. Returns ok and one check per value, with its key path; the CLI exits 1 when one is missing. Read only.",
  input: z.object({}),
  writes: false,
  // The second sets the area's own inputs, which choose the connection and (ado) the fallback collection; the dossier is checked either way.
  examples: [{}, { env: 'prod', instance: 'east' }],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'openshift');
    // A project, not the namespace object: listing namespaces needs cluster rights an ordinary token lacks.
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['namespace', 'namespaces']), 'namespace', (name) =>
      exists(() => openshift(ctx, `/apis/project.openshift.io/v1/projects/${ns(name)}`)),
    );
    const deployments = view.sections.flatMap((s) => {
      const namespace = typeof s.values.namespace === 'string' ? s.values.namespace : undefined;
      const list = Array.isArray(s.values.deployments) ? s.values.deployments : [];
      return namespace ? list.flatMap((d, i) => (typeof d === 'string' ? [{ path: `${s.path}.deployments[${i}]`, value: `${namespace}/${d}` }] : [])) : [];
    });
    checks.push(
      ...(await checkEach(deployments, 'deployment', (nd) => {
        const [namespace, name] = [nd.slice(0, nd.indexOf('/')), nd.slice(nd.indexOf('/') + 1)];
        return exists(() => openshift(ctx, `/apis/apps/v1/namespaces/${ns(namespace)}/deployments/${encodeURIComponent(name)}`));
      })),
    );
    return dossierCheckResult(ctx, view, checks);
  },
});
