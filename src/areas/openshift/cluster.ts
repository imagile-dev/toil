import { z } from 'zod';
import { clusterName, openshiftArea } from './area.js';

/**
 * `cluster list`, which once read every named cluster out of the config
 * file. Clusters are connections now, and an area command sees only the
 * connection its call resolved, so this reports that one and points at
 * `toil connections list` for the rest. Access to the full register is
 * restricted to the department that keeps it.
 */

export const clusterListCommand = openshiftArea.command({
  path: ['openshift', 'cluster', 'list'],
  description: 'Show the OpenShift cluster this call resolves to (--env, --instance or --connection, else the default); toil connections list shows them all',
  input: z.object({}),
  writes: false,
  // An empty input types its examples as Record<string, never>, which shuts out the group inputs core adds; the cast lets one set them.
  examples: [{}, { env: 'prod', instance: 'east' } as unknown as Record<string, never>],
  run: async (_input, ctx) => {
    const conn = ctx.connection;
    const named = clusterName(conn) !== undefined;
    // The predecessor listed the flat cluster only when it had a baseUrl, and a named one always.
    const clusters = named || conn.baseUrl
      ? [{ environment: named ? conn.env : '(default)', instance: named ? conn.instance : '(default)', baseUrl: conn.baseUrl, connection: conn.name }]
      : [];
    // The default's environment and instance are known only when the call resolved the default; otherwise null, never a guess.
    const isDefault = ctx.resolved.connection?.source === 'default';
    ctx.warn({
      code: 'ONE_CONNECTION_LISTED',
      message: `openshift cluster list shows only connection "${conn.name}", the one this call resolved${isDefault ? ' (the default)' : ''}. Run toil connections list to see every openshift connection.`,
    });
    return {
      count: clusters.length,
      clusters,
      defaultEnvironment: isDefault ? conn.env : null,
      defaultInstance: isDefault ? conn.instance : null,
    };
  },
});

export const clusterCommands = [clusterListCommand];
