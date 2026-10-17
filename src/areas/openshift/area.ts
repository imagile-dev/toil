import { z } from 'zod';
import { defineArea, type Connection } from '../../core/area.js';
import type { HookArea } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * OpenShift and Kubernetes clusters, read through the API server's REST API
 * with a Bearer token, typically a service account's. One connection per
 * cluster: `--env` and `--instance` pick it by the connection's `env` and
 * `instance` settings. No kubeconfig and no `oc`, so nobody has to file a
 * request to install a second CLI in order to use the first.
 */

const connection = z.object({
  baseUrl: z.url().optional().describe('API server URL, e.g. https://openshift.imagile.dev'),
  token: z.string().min(1).optional().describe('Bearer token, typically a service account token'),
  env: z.string().min(1).optional().describe('Environment name that --env selects this cluster by, e.g. prod'),
  instance: z.string().min(1).optional().describe('Cluster instance name within the environment that --instance selects this cluster by, e.g. east'),
});

export type OpenShiftSettings = z.output<typeof connection>;

/** `prod/east` for a named cluster; undefined for one with no environment and instance, as the flat keys were. */
export const clusterName = (conn: OpenShiftSettings): string | undefined =>
  conn.env !== undefined && conn.instance !== undefined ? `${conn.env}/${conn.instance}` : undefined;

const setHint = (conn: Connection<OpenShiftSettings>, area: HookArea, key: keyof OpenShiftSettings & string) =>
  `Set ${key} on connection "${conn.name}" (${area.envName(key)} for the default connection), or run toil connections add <name> --area openshift.`;

export const openshiftArea = defineArea({
  name: 'openshift',
  description: 'OpenShift and Kubernetes: pods, deployments, events, logs and resource usage',
  connection,
  secrets: ['token'],
  // Every configured cluster is a connection, so core's list answers; this area never sees the config.
  coreAliases: { 'cluster list': 'connections list' },
  request: (conn, area) => {
    // The predecessor's wording, which differed for a named cluster and the flat one; the URL is checked before the token.
    const cluster = clusterName(conn);
    if (!conn.baseUrl) {
      throw new ToilError('NOT_CONFIGURED', cluster ? `OpenShift cluster "${cluster}" is not configured or missing baseUrl.` : 'OpenShift not configured.', { fix: setHint(conn, area, 'baseUrl') });
    }
    if (!conn.token) {
      throw new ToilError('NOT_CONFIGURED', cluster ? `OpenShift cluster "${cluster}" is missing a token.` : 'OpenShift credentials not configured.', { fix: setHint(conn, area, 'token') });
    }
    return {
      baseUrl: conn.baseUrl,
      headers: { Authorization: `Bearer ${conn.token}` },
      service: 'OpenShift',
      authFix: `The cluster rejected the token on connection "${conn.name}". Create a new service account token for the cluster (the web console's Copy login command shows one), then set token (${area.envName('token')} for the default connection).`,
    };
  },
  context: {
    env: { description: 'Named environment to target', flags: '--env <name>', setting: 'env', selectsConnection: true },
    instance: { description: 'Named cluster instance within the environment to target', flags: '--instance <name>', setting: 'instance', selectsConnection: true },
  },
});

/** Not established; the skill file and the site's integration data say the same. */
export const openshiftSupported: SupportedVersion = {
  product: 'OpenShift / Kubernetes',
  minimum: null,
  api: 'core v1, apps/v1, apps.openshift.io/v1 and metrics.k8s.io/v1beta1',
  note: 'pods, events and logs use core v1; deployments use apps/v1, or apps.openshift.io/v1 for DeploymentConfigs; pod-metrics and resource-usage need metrics-server (metrics.k8s.io/v1beta1). No release has been verified yet.',
};
