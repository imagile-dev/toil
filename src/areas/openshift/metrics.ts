import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { openshiftArea } from './area.js';
import { ns, openshift } from './client.js';
import { cpuMillicores, memMiB, type K8sList, type K8sPod, type K8sPodMetrics } from './k8s.js';

/**
 * CPU and memory from metrics-server, alone (pod-metrics) or joined to each
 * container's limits and requests (resource-usage). The CSV goes to a file
 * the caller names, never to stdout: a spreadsheet is a deliverable, and
 * deliverables get filed.
 */

const CSV_HEADER = ['Pod', 'Container', 'CPU Usage (m)', 'Memory Usage (Mi)', 'CPU Limits (m)', 'Memory Limits (Mi)', 'CPU Requests (m)', 'Memory Requests (Mi)'];

export const podMetricsCommand = openshiftArea.command({
  path: ['openshift', 'pod-metrics'],
  description: 'Get CPU and memory usage for pods in a namespace (requires metrics-server)',
  input: z.object({ namespace: z.string().describe('Kubernetes namespace') }),
  writes: false,
  options: [{ flags: '--namespace <ns>', field: 'namespace', description: 'Kubernetes namespace' }],
  examples: [{ namespace: 'payments' }, { namespace: 'payments', env: 'prod', instance: 'east' }],
  run: async (input, ctx) => {
    const metrics = await openshift<K8sList<K8sPodMetrics>>(ctx, `/apis/metrics.k8s.io/v1beta1/namespaces/${ns(input.namespace)}/pods`);
    const pods = metrics.items.map((pm) => ({ name: pm.metadata.name, containers: pm.containers.map((c) => ({ name: c.name, cpu: c.usage.cpu, memory: c.usage.memory })) }));
    return { namespace: input.namespace, pods };
  },
});

export const resourceUsageCommand = openshiftArea.command({
  path: ['openshift', 'resource-usage'],
  description:
    'Combined CPU/memory usage, limits, and requests for all pods in a namespace — all values normalized to millicores (m) and mebibytes (Mi). Requires metrics-server. Use --csv with --out <file> to also save a spreadsheet-friendly CSV.',
  input: z.object({
    namespace: z.string().describe('Kubernetes namespace'),
    labelSelector: z.string().optional().describe('Label selector (e.g. app=my-app)'),
    csv: z.boolean().optional().describe('Also write the rows as CSV (suitable for Excel) to the file named by out (default: false)'),
    out: z.string().optional().describe('The CSV file to write, inside the workspace; it must not exist yet. Required with csv'),
  }),
  writes: false,
  options: [
    { flags: '--namespace <ns>', field: 'namespace', description: 'Kubernetes namespace' },
    { flags: '--label-selector <selector>', field: 'labelSelector', description: 'Label selector (e.g. app=my-app)' },
    { flags: '--csv', field: 'csv', description: 'Also write the rows as CSV (suitable for Excel) to the --out file (default: false)' },
    { flags: '--out <file>', field: 'out', description: 'The CSV file to write, inside the workspace; it must not exist yet. Required with --csv' },
  ],
  examples: [{ namespace: 'payments' }, { namespace: 'payments', labelSelector: 'app=api', csv: true, out: 'usage.csv', env: 'prod', instance: 'east' }],
  run: async (input, ctx) => {
    // Checked before any request, so a missing file name costs no round trip.
    if (input.csv && !input.out) {
      throw new ToilError('INVALID_INPUT', '--csv writes the CSV to a file, and no --out <file> was given.', { fix: 'Pass --out <file> (a new file inside the workspace) with --csv, or drop --csv for the JSON rows alone.' });
    }
    if (input.out && !input.csv) {
      throw new ToilError('INVALID_INPUT', '--out names the CSV file, but --csv wasn\'t given.', { fix: 'Pass --csv with --out <file>, or drop --out for the JSON rows alone.' });
    }
    const query = { labelSelector: input.labelSelector || undefined };
    // Pods (limits and requests) and metrics (usage) at once, both filtered by the label selector.
    const [podList, metricsList] = await Promise.all([
      openshift<K8sList<K8sPod>>(ctx, `/api/v1/namespaces/${ns(input.namespace)}/pods`, query),
      openshift<K8sList<K8sPodMetrics>>(ctx, `/apis/metrics.k8s.io/v1beta1/namespaces/${ns(input.namespace)}/pods`, query),
    ]);

    const usageByPod = new Map<string, Map<string, { cpu: string; memory: string }>>();
    for (const pm of metricsList.items) usageByPod.set(pm.metadata.name, new Map(pm.containers.map((c) => [c.name, c.usage])));

    const rows = podList.items.flatMap((pod) =>
      (pod.spec.containers ?? []).map((container) => {
        const usage = usageByPod.get(pod.metadata.name)?.get(container.name);
        return {
          pod: pod.metadata.name,
          container: container.name,
          cpuUsageMillicores: cpuMillicores(usage?.cpu),
          memUsageMiB: memMiB(usage?.memory),
          cpuLimitsMillicores: cpuMillicores(container.resources?.limits?.cpu),
          memLimitsMiB: memMiB(container.resources?.limits?.memory),
          cpuRequestsMillicores: cpuMillicores(container.resources?.requests?.cpu),
          memRequestsMiB: memMiB(container.resources?.requests?.memory),
        };
      }),
    );

    const data = { namespace: input.namespace, count: rows.length, units: { cpu: 'm', memory: 'Mi' }, rows };
    if (!input.csv) return data;
    const file = ctx.files.writeCsv(
      input.out!,
      CSV_HEADER,
      rows.map((r) => [r.pod, r.container, r.cpuUsageMillicores, r.memUsageMiB, r.cpuLimitsMillicores, r.memLimitsMiB, r.cpuRequestsMillicores, r.memRequestsMiB]),
    );
    return { ...data, file };
  },
});

export const metricsCommands = [podMetricsCommand, resourceUsageCommand];
