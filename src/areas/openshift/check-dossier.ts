import { z } from 'zod';
import { checkEach, dossierCheckResult, dossierToCheck, exists, type DossierCheck, type Unchecked } from '../../core/check-dossier.js';
import { viewScopes, viewValues } from '../../core/dossier.js';
import { openshiftArea } from './area.js';
import { ns, openshift } from './client.js';

/**
 * `toil openshift check-dossier`: the call's dossier's OpenShift sections for
 * the call's environment, against the cluster that environment's connection
 * names. Each namespace (`namespace`, `namespaces`) must be a project the
 * token can see. Each deployment in `deployments` must exist in its
 * namespace, found the way a call finds it: the environment's section's,
 * else the area's own, per repo or not. A deployment with no namespace is
 * reported as unchecked. Read only. A deployment without a namespace is a
 * tenant without an address, and the census office won't take it.
 */
export const checkDossier = openshiftArea.command({
  path: ['openshift', 'check-dossier'],
  description: "Check the call's dossier against OpenShift: its namespaces and deployments exist",
  toolDescription:
    "Checks the OpenShift sections of the dossier that applies to this call, for the call's environment (env, else the dossier's own), against that environment's cluster: each namespace it names is a project the token can see, and each deployment in deployments exists in its namespace. Returns ok, one check per value with its key path, and any value that couldn't be checked; the CLI exits 1 when one is missing or unchecked. Read only.",
  input: z.object({}),
  writes: false,
  // The second names the environment and the instance, which choose the cluster.
  examples: [{}, { env: 'prod', instance: 'east' }],
  run: async (_input, ctx) => {
    const view = dossierToCheck(ctx, 'openshift');
    // A project, not the namespace object: listing namespaces needs cluster rights an ordinary token lacks.
    const checks: DossierCheck[] = await checkEach(viewValues(view, ['namespace', 'namespaces']), 'namespace', (name) =>
      exists(() => openshift(ctx, `/apis/project.openshift.io/v1/projects/${ns(name)}`)),
    );
    const namespaces = viewScopes(view, ['namespace']).scopes.map((s) => s.values.namespace!);
    const deployments = viewValues(view, ['deployments']);
    const unchecked: Unchecked[] = namespaces.length > 0 ? [] : deployments.map((d) => ({ path: d.path, value: d.value, reason: 'no namespace to look this deployment up in; set namespace in the dossier' }));
    checks.push(
      ...(await checkEach(
        namespaces.flatMap((namespace) => deployments.map((d) => ({ path: d.path, value: `${namespace}/${d.value}` }))),
        'deployment',
        (nd) => {
          const at = nd.indexOf('/');
          return exists(() => openshift(ctx, `/apis/apps/v1/namespaces/${ns(nd.slice(0, at))}/deployments/${encodeURIComponent(nd.slice(at + 1))}`));
        },
      )),
    );
    return dossierCheckResult(ctx, view, checks, unchecked);
  },
});
