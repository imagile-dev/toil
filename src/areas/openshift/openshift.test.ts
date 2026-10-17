import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import {
  config as fixtureConfig,
  deployment,
  deploymentConfig,
  eventList,
  LOG,
  NAMESPACE,
  OPENSHIFT,
  POD,
  pendingPod,
  podList,
  podMetrics,
  runningPod,
  seriesEvent,
  warningEvent,
} from '../../../test/fixtures/openshift.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { runCli } from '../../../test/harness/cli.js';
import { commands as registered } from '../../registry.js';
import { age, cpuMillicores, memMiB } from './k8s.js';
import { podMetricsCommand, resourceUsageCommand } from './metrics.js';
import { deploymentsCommand, eventsCommand, logsCommand, podsCommand } from './workloads.js';

/**
 * The exact request toil sends to the API server for each command, and what
 * it makes of the answer. The parity suite proves the two front doors agree;
 * this proves they agree on what the command contract did. Suspected
 * bugs (#88) are pinned here, not fixed, pending a cluster willing to testify.
 */

const JSON_HEADERS = { authorization: 'Bearer test-token', 'content-type': 'application/json', accept: 'application/json', connection: 'close' };
const TEXT_HEADERS = { authorization: 'Bearer test-token', accept: '*/*', connection: 'close' };
const NOW = Date.parse('2024-01-01T03:00:00Z');

/** One connection's settings, as the harness takes them. */
type Settings = Record<string, string>;

/** Several connections, as a version 2 config holds them, with an optional default. */
interface Clusters {
  connections: Record<string, Settings>;
  defaultConnection?: string;
}

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], setup: { config?: Record<string, Settings>; clusters?: Clusters; files?: Record<string, string> } = {}) {
  const t = testContext({ config: setup.config ?? fixtureConfig, routes, ...(setup.files ? { files: setup.files } : {}) });
  if (setup.clusters) {
    const c = t.context.config;
    c.connections = Object.fromEntries(Object.entries(setup.clusters.connections).map(([name, s]) => [name, { ...s, area: 'openshift' }]));
    c.defaults = setup.clusters.defaultConnection ? { openshift: { connection: setup.clusters.defaultConnection } } : {};
    // As if set by TOIL_CONN_<NAME>_* env vars, where a plaintext token may live.
    c.sources = Object.fromEntries(Object.entries(setup.clusters.connections).flatMap(([name, s]) => Object.keys(s).map((k) => [`${name}.${k}`, 'env' as const])));
  }
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls, files: t.files };
}

const json = (body: unknown): Route => ({ url: /.*/, respond: { json: body } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('pods', () => {
  it('GETs the namespace\'s pods with the JSON headers and the token, and sends labelSelector only when given', async () => {
    const { calls } = await run(podsCommand, { namespace: 'pay ments', labelSelector: 'app=api,tier!=db' }, [json(podList)]);
    expect(calls).toEqual([{ method: 'GET', url: `${OPENSHIFT}/api/v1/namespaces/pay%20ments/pods?labelSelector=app%3Dapi,tier%21%3Ddb`, headers: JSON_HEADERS, body: undefined }]);
    const bare = await run(podsCommand, { namespace: NAMESPACE, labelSelector: '' }, [json(podList)]);
    expect(bare.calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/pods`);
  });

  it('summarises: phase counters, problem counters, problem pods first, and per-container detail', async () => {
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE }, [json(podList)]);
    expect(envelope.data).toEqual({
      namespace: NAMESPACE,
      summary: { total: 2, running: 1, pending: 1, failed: 0, succeeded: 0, unknown: 0, crashLoopBackOff: 0, oomKilled: 1, imagePullBackOff: 1, totalRestarts: 3 },
      pods: [
        {
          name: 'worker-5c4b3a2190-fghij',
          phase: 'Pending',
          ready: '0/1',
          restartCount: 0,
          age: '3h',
          reason: 'ContainersNotReady',
          containers: [{ name: 'worker', ready: false, restartCount: 0, state: 'ImagePullBackOff' }],
        },
        {
          name: POD,
          phase: 'Running',
          ready: '2/2',
          restartCount: 3,
          age: '3h',
          containers: [
            { name: 'api', ready: true, restartCount: 3, state: 'Running', lastExitCode: 137, lastReason: 'OOMKilled' },
            { name: 'proxy', ready: true, restartCount: 0, state: 'Running' },
          ],
          labels: { app: 'api' },
        },
      ],
    });
  });

  it('sorts Failed, Pending, Unknown, then the rest, by restarts within each; a missing phase is Unknown; ErrImagePull counts as an image pull problem', async () => {
    const pod = (name: string, phase: string | undefined, restarts: number, state: Record<string, unknown> = { running: {} }) => ({
      metadata: { name, namespace: NAMESPACE },
      spec: { containers: [{ name: 'c' }] },
      status: { ...(phase ? { phase } : {}), containerStatuses: [{ name: 'c', ready: false, restartCount: restarts, state }] },
    });
    const items = [pod('ok-few', 'Running', 1), pod('ok-many', 'Running', 9), pod('done', 'Succeeded', 0), pod('nophase', undefined, 0), pod('pending', 'Pending', 0, { waiting: { reason: 'ErrImagePull' } }), pod('failed', 'Failed', 0, { waiting: { reason: 'CrashLoopBackOff' } })];
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE }, [json({ items })]);
    const data = envelope.data as { summary: Record<string, number>; pods: Array<{ name: string; phase: string; age: string }> };
    expect(data.pods.map((p) => p.name)).toEqual(['failed', 'pending', 'nophase', 'ok-many', 'ok-few', 'done']);
    expect(data.pods.find((p) => p.name === 'nophase')).toMatchObject({ phase: 'Unknown', age: 'unknown' });
    expect(data.summary).toMatchObject({ total: 6, running: 2, pending: 1, failed: 1, succeeded: 1, unknown: 1, crashLoopBackOff: 1, imagePullBackOff: 1, totalRestarts: 10 });
  });

  it('suspected bug #88 item 2: ready and restarts count init containers, but the total counts only spec.containers', async () => {
    const pod = {
      metadata: { name: 'sidecar', namespace: NAMESPACE },
      spec: { containers: [{ name: 'a' }, { name: 'b' }] },
      status: {
        phase: 'Running',
        containerStatuses: [{ name: 'a', ready: true, restartCount: 1 }, { name: 'b', ready: true, restartCount: 0 }],
        initContainerStatuses: [{ name: 'mesh', ready: true, restartCount: 4 }],
      },
    };
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE }, [json({ items: [pod] })]);
    const data = envelope.data as { summary: { totalRestarts: number }; pods: Array<{ ready: string; restartCount: number }> };
    expect(data.pods[0]).toMatchObject({ ready: '3/2', restartCount: 5 });
    expect(data.summary.totalRestarts).toBe(5);
  });

  it('suspected bug #88 item 5: oomKilled counts lastState only, not a container OOMKilled right now', async () => {
    const pod = {
      metadata: { name: 'job', namespace: NAMESPACE },
      spec: { containers: [{ name: 'c' }] },
      status: { phase: 'Failed', containerStatuses: [{ name: 'c', ready: false, restartCount: 0, state: { terminated: { exitCode: 137, reason: 'OOMKilled' } } }] },
    };
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE }, [json({ items: [pod] })]);
    const data = envelope.data as { summary: { oomKilled: number }; pods: Array<{ containers: Array<{ state: string }> }> };
    expect(data.pods[0]!.containers[0]!.state).toBe('OOMKilled');
    expect(data.summary.oomKilled).toBe(0);
  });

  it('takes reason from status.reason before the first False condition, and keeps the message', async () => {
    const pod = { ...pendingPod, status: { ...pendingPod.status, reason: 'Evicted', message: 'The node was low on resource: memory.' } };
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE }, [json({ items: [pod] })]);
    expect((envelope.data as { pods: unknown[] }).pods[0]).toMatchObject({ reason: 'Evicted', message: 'The node was low on resource: memory.' });
  });

  it('--raw returns the pod objects unmodified, with count', async () => {
    const { envelope } = await run(podsCommand, { namespace: NAMESPACE, raw: true }, [json(podList)]);
    expect(envelope.data).toEqual({ namespace: NAMESPACE, count: 2, pods: [runningPod, pendingPod] });
  });

  it("a 401 is AUTH saying where to get a token; a 404 carries the Kubernetes Status message", async () => {
    const denied = await run(podsCommand, { namespace: NAMESPACE }, [{ url: /.*/, respond: { status: 401, json: { kind: 'Status', status: 'Failure', message: 'Unauthorized', code: 401 } } }]);
    expect(denied.envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('service account token') });
    expect(denied.envelope.error?.fix).toContain('TOIL_OPENSHIFT_TOKEN');
    const missing = await run(podsCommand, { namespace: 'nope' }, [{ url: /.*/, respond: { status: 404, json: { kind: 'Status', status: 'Failure', message: 'namespaces "nope" not found', reason: 'NotFound', code: 404 } } }]);
    expect(missing.envelope.error).toMatchObject({ code: 'NOT_FOUND', message: 'namespaces "nope" not found' });
  });

  it('needs --namespace, refused before any request', async () => {
    const { envelope, calls } = await run(podsCommand, {}, []);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(calls).toEqual([]);
  });
});

describe('deployments', () => {
  it('reads apps/v1 Deployments: ready, replica counts, images, strategy, and only the problem conditions', async () => {
    const { envelope, calls } = await run(deploymentsCommand, { namespace: NAMESPACE, labelSelector: 'app=api' }, [json({ items: [deployment] })]);
    expect(calls).toEqual([{ method: 'GET', url: `${OPENSHIFT}/apis/apps/v1/namespaces/${NAMESPACE}/deployments?labelSelector=app%3Dapi`, headers: JSON_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      namespace: NAMESPACE,
      kind: 'Deployment',
      count: 1,
      deployments: [
        {
          name: 'api',
          ready: '2/3',
          desiredReplicas: 3,
          readyReplicas: 2,
          updatedReplicas: 3,
          availableReplicas: 2,
          unavailableReplicas: 1,
          age: '3h',
          images: [{ name: 'api', image: 'registry.imagile.dev/api:1.4.2' }],
          strategy: 'RollingUpdate',
          conditions: [{ type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable', message: 'Deployment does not have minimum availability.' }],
          labels: { app: 'api' },
        },
      ],
    });
  });

  it('--deployment-configs reads apps.openshift.io/v1, keeps latestVersion, and sorts by unavailable replicas', async () => {
    const bare = { metadata: { name: 'bare', namespace: NAMESPACE }, spec: {} };
    const { envelope, calls } = await run(deploymentsCommand, { namespace: NAMESPACE, deploymentConfigs: true }, [json({ items: [deploymentConfig, bare, { ...deploymentConfig, metadata: { ...deploymentConfig.metadata, name: 'worse' }, status: { ...deploymentConfig.status, unavailableReplicas: 2, conditions: [{ type: 'ReplicaFailure', status: 'True', reason: 'FailedCreate' }] } }] })]);
    expect(calls[0]!.url).toBe(`${OPENSHIFT}/apis/apps.openshift.io/v1/namespaces/${NAMESPACE}/deploymentconfigs`);
    const data = envelope.data as { kind: string; deployments: Array<Record<string, unknown>> };
    expect(data.kind).toBe('DeploymentConfig');
    expect(data.deployments.map((d) => d.name)).toEqual(['worse', 'legacy', 'bare']);
    expect(data.deployments[0]).toMatchObject({ latestVersion: 7, conditions: [{ type: 'ReplicaFailure', status: 'True', reason: 'FailedCreate', message: undefined }] });
    expect(data.deployments[2]).toEqual({ name: 'bare', ready: '0/0', desiredReplicas: 0, readyReplicas: 0, updatedReplicas: 0, availableReplicas: 0, unavailableReplicas: 0, age: 'unknown', images: [] });
  });

  it('--raw returns the objects unmodified, with kind and count', async () => {
    const { envelope } = await run(deploymentsCommand, { namespace: NAMESPACE, raw: true }, [json({ items: [deployment] })]);
    expect(envelope.data).toEqual({ namespace: NAMESPACE, kind: 'Deployment', count: 1, deployments: [deployment] });
  });
});

describe('events', () => {
  it('asks for Warning events by default and maps both core and events.k8s.io field names, most frequent first', async () => {
    const { envelope, calls } = await run(eventsCommand, { namespace: NAMESPACE }, [json(eventList)]);
    expect(calls).toEqual([{ method: 'GET', url: `${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/events?fieldSelector=type%3DWarning`, headers: JSON_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      namespace: NAMESPACE,
      count: 2,
      events: [
        { type: 'Warning', reason: 'BackOff', object: `Pod/${POD}`, message: warningEvent.message, count: 12, firstTime: warningEvent.firstTimestamp, lastTime: warningEvent.lastTimestamp, source: 'kubelet' },
        // Suspected bug (#88 item 6): series.count (40) is never read, so it shows 1 and sorts last.
        { type: 'Warning', reason: 'FailedScheduling', object: 'Pod/worker-5c4b3a2190-fghij', message: seriesEvent.message, count: 1, firstTime: seriesEvent.eventTime, lastTime: seriesEvent.eventTime, source: 'default-scheduler' },
      ],
    });
  });

  it('joins --field-selector to the Warning filter with a comma; --all drops the Warning filter', async () => {
    const both = await run(eventsCommand, { namespace: NAMESPACE, fieldSelector: `involvedObject.name=${POD}` }, [json({ items: [] })]);
    expect(both.calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/events?fieldSelector=type%3DWarning,involvedObject.name%3D${POD}`);
    const all = await run(eventsCommand, { namespace: NAMESPACE, all: true }, [json({ items: [] })]);
    expect(all.calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/events`);
    const allFiltered = await run(eventsCommand, { namespace: NAMESPACE, all: true, fieldSelector: 'reason=BackOff' }, [json({ items: [] })]);
    expect(allFiltered.calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/events?fieldSelector=reason%3DBackOff`);
  });

  it('defaults a missing type to Normal, an object with no kind or name to Object/?, and leaves object out with none', async () => {
    const { envelope } = await run(eventsCommand, { namespace: NAMESPACE, all: true }, [json({ items: [{ reason: 'Pulled', involvedObject: {} }, { reason: 'Other' }] })]);
    const events = (envelope.data as { events: Array<Record<string, unknown>> }).events;
    expect(events[0]).toEqual({ type: 'Normal', reason: 'Pulled', object: 'Object/?', count: 1 });
    expect(events[1]).toEqual({ type: 'Normal', reason: 'Other', count: 1 });
  });
});

describe('logs', () => {
  it('GETs the log as text with Accept */* and no Content-Type, tailLines 100 by default, and no container (suspected bug #88 item 1)', async () => {
    const { envelope, calls } = await run(logsCommand, { namespace: NAMESPACE, pod: POD }, [{ url: /.*/, respond: { text: LOG } }]);
    expect(calls).toEqual([{ method: 'GET', url: `${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/pods/${POD}/log?tailLines=100`, headers: TEXT_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({ pod: POD, namespace: NAMESPACE, container: '(default)', previous: false, lines: 100, log: LOG });
  });

  it('sends container, previous=true and tailLines, in that order', async () => {
    const { envelope, calls } = await run(logsCommand, { namespace: NAMESPACE, pod: POD, container: 'api', lines: '20', previous: true }, [{ url: /.*/, respond: { text: LOG } }]);
    expect(calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/pods/${POD}/log?container=api&previous=true&tailLines=20`);
    expect(envelope.data).toMatchObject({ container: 'api', previous: true, lines: 20 });
  });

  it('suspected bug #88 item 7: --lines goes through parseInt unvalidated, so "abc" sends NaN and 0 passes', async () => {
    const nan = await run(logsCommand, { namespace: NAMESPACE, pod: POD, lines: 'abc' }, [{ url: /.*/, respond: { text: '' } }]);
    expect(nan.calls[0]!.url).toBe(`${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/pods/${POD}/log?tailLines=NaN`);
    expect((nan.envelope.data as { lines: unknown }).lines).toBeNaN();
    const zero = await run(logsCommand, { namespace: NAMESPACE, pod: POD, lines: 0 }, [{ url: /.*/, respond: { text: '' } }]);
    expect(zero.calls[0]!.url).toContain('tailLines=0');
    const parsed = await run(logsCommand, { namespace: NAMESPACE, pod: POD, lines: '25x' }, [{ url: /.*/, respond: { text: '' } }]);
    expect(parsed.calls[0]!.url).toContain('tailLines=25');
  });

  it("a refusal carries the API server's message", async () => {
    const { envelope } = await run(logsCommand, { namespace: NAMESPACE, pod: POD }, [
      { url: /.*/, respond: { status: 400, json: { kind: 'Status', message: `a container name must be specified for pod ${POD}, choose one of: [api proxy]` } } },
    ]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: `a container name must be specified for pod ${POD}, choose one of: [api proxy]` });
  });
});

describe('pod-metrics', () => {
  it('reads metrics.k8s.io and returns each container\'s raw usage', async () => {
    const { envelope, calls } = await run(podMetricsCommand, { namespace: NAMESPACE }, [json(podMetrics)]);
    expect(calls).toEqual([{ method: 'GET', url: `${OPENSHIFT}/apis/metrics.k8s.io/v1beta1/namespaces/${NAMESPACE}/pods`, headers: JSON_HEADERS, body: undefined }]);
    expect(envelope.data).toEqual({
      namespace: NAMESPACE,
      pods: [{ name: POD, containers: [{ name: 'api', cpu: '123456789n', memory: '204800Ki' }, { name: 'proxy', cpu: '2500u', memory: '64Mi' }] }],
    });
  });
});

describe('resource-usage', () => {
  const routes: Route[] = [
    { path: `/api/v1/namespaces/${NAMESPACE}/pods`, respond: { json: podList } },
    { path: `/apis/metrics.k8s.io/v1beta1/namespaces/${NAMESPACE}/pods`, respond: { json: podMetrics } },
  ];
  const rows = [
    { pod: POD, container: 'api', cpuUsageMillicores: 123, memUsageMiB: 200, cpuLimitsMillicores: 500, memLimitsMiB: 512, cpuRequestsMillicores: 250, memRequestsMiB: 256 },
    { pod: POD, container: 'proxy', cpuUsageMillicores: 3, memUsageMiB: 64, cpuLimitsMillicores: 1000, memLimitsMiB: 1024, cpuRequestsMillicores: null, memRequestsMiB: null },
    { pod: 'worker-5c4b3a2190-fghij', container: 'worker', cpuUsageMillicores: null, memUsageMiB: null, cpuLimitsMillicores: null, memLimitsMiB: null, cpuRequestsMillicores: null, memRequestsMiB: null },
  ];

  it('asks for pods and metrics, both with the label selector, and joins them per container in m and Mi', async () => {
    const { envelope, calls } = await run(resourceUsageCommand, { namespace: NAMESPACE, labelSelector: 'app=api' }, routes);
    expect(calls).toEqual([
      { method: 'GET', url: `${OPENSHIFT}/api/v1/namespaces/${NAMESPACE}/pods?labelSelector=app%3Dapi`, headers: JSON_HEADERS, body: undefined },
      { method: 'GET', url: `${OPENSHIFT}/apis/metrics.k8s.io/v1beta1/namespaces/${NAMESPACE}/pods?labelSelector=app%3Dapi`, headers: JSON_HEADERS, body: undefined },
    ]);
    expect(envelope.data).toEqual({ namespace: NAMESPACE, count: 3, units: { cpu: 'm', memory: 'Mi' }, rows });
  });

  it('--csv --out writes the CSV with the exact header and empty cells for null, and returns the rows with the absolute path', async () => {
    const { envelope, files } = await run(resourceUsageCommand, { namespace: NAMESPACE, csv: true, out: 'reports/usage.csv' }, routes);
    expect(envelope.data).toEqual({ namespace: NAMESPACE, count: 3, units: { cpu: 'm', memory: 'Mi' }, rows, file: '/work/reports/usage.csv' });
    expect(new TextDecoder().decode(files.written['/work/reports/usage.csv'])).toBe(
      [
        'Pod,Container,CPU Usage (m),Memory Usage (Mi),CPU Limits (m),Memory Limits (Mi),CPU Requests (m),Memory Requests (Mi)',
        `${POD},api,123,200,500,512,250,256`,
        `${POD},proxy,3,64,1000,1024,,`,
        'worker-5c4b3a2190-fghij,worker,,,,,,',
        '',
      ].join('\n'),
    );
  });

  it('never overwrites, and refuses --csv without --out (or --out without --csv) before any request', async () => {
    const exists = await run(resourceUsageCommand, { namespace: NAMESPACE, csv: true, out: 'usage.csv' }, routes, { files: { 'usage.csv': 'keep me' } });
    expect(exists.envelope.ok).toBe(false);
    expect(exists.files.written).toEqual({});
    const noOut = await run(resourceUsageCommand, { namespace: NAMESPACE, csv: true }, routes);
    expect(noOut.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--out <file>') });
    expect(noOut.calls).toEqual([]);
    const noCsv = await run(resourceUsageCommand, { namespace: NAMESPACE, out: 'usage.csv' }, routes);
    expect(noCsv.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--csv') });
    expect(noCsv.calls).toEqual([]);
  });
});

describe('quantities', () => {
  it('CPU: n, u and m suffixes and whole cores, in millicores', () => {
    expect([cpuMillicores('123456789n'), cpuMillicores('2500u'), cpuMillicores('250m'), cpuMillicores('1.5'), cpuMillicores(undefined), cpuMillicores('')]).toEqual([123, 3, 250, 1500, null, null]);
  });

  it('memory: binary and decimal suffixes and bytes, in MiB, rounded as the contract rounded', () => {
    expect([memMiB('1536Ki'), memMiB('64Mi'), memMiB('1.5Gi'), memMiB('1Ti'), memMiB('500K'), memMiB('100M'), memMiB('1G'), memMiB('1048576')]).toEqual([1.5, 64, 1536, 1048576, 0.48, 95.37, 954, 1]);
  });

  it('suspected bug #88 item 4: lowercase k, milli, E/P/T, Ei/Pi and exponents after a suffix are null', () => {
    expect([memMiB('500k'), memMiB('129m'), memMiB('1T'), memMiB('1P'), memMiB('1E'), memMiB('1Pi'), memMiB('1Ei'), memMiB('1e3k'), cpuMillicores('1k')]).toEqual([null, null, null, null, null, null, null, null, null]);
    // An exponent alone is a number, so it works.
    expect(memMiB('1e9')).toBe(953.67);
  });

  it('age floors to s, m, h or d', () => {
    const t = Date.parse('2024-01-10T00:00:00Z');
    expect([age('2024-01-09T23:59:30Z', t), age('2024-01-09T23:00:01Z', t), age('2024-01-09T01:00:00Z', t), age('2024-01-01T00:00:00Z', t), age(undefined, t)]).toEqual(['30s', '59m', '23h', '9d', 'unknown']);
  });
});

describe('choosing a cluster', () => {
  const clusters: Clusters = {
    connections: {
      'prod-east': { baseUrl: 'https://prod-east.openshift.imagile.dev', token: 'prod-east-token', env: 'prod', instance: 'east' },
      'prod-west': { baseUrl: 'https://prod-west.openshift.imagile.dev', token: 'prod-west-token', env: 'prod', instance: 'west' },
      'dev-north': { baseUrl: 'https://dev-north.openshift.imagile.dev', token: 'dev-token', env: 'dev', instance: 'north' },
    },
    defaultConnection: 'prod-east',
  };

  it('uses the default connection with no flags, and --env or --instance alone when it identifies one cluster', async () => {
    const byDefault = await run(podMetricsCommand, { namespace: NAMESPACE }, [json(podMetrics)], { clusters });
    expect(byDefault.calls[0]).toMatchObject({ url: `https://prod-east.openshift.imagile.dev/apis/metrics.k8s.io/v1beta1/namespaces/${NAMESPACE}/pods`, headers: { authorization: 'Bearer prod-east-token' } });
    const byEnv = await run(podMetricsCommand, { namespace: NAMESPACE, env: 'dev' }, [json(podMetrics)], { clusters });
    expect(byEnv.calls[0]).toMatchObject({ url: expect.stringContaining('https://dev-north.openshift.imagile.dev/'), headers: { authorization: 'Bearer dev-token' } });
    expect(byEnv.envelope.meta.context?.connection).toEqual({ value: 'dev-north', source: 'input', via: 'env' });
    const byInstance = await run(podMetricsCommand, { namespace: NAMESPACE, instance: 'west' }, [json(podMetrics)], { clusters });
    expect(byInstance.calls[0]!.url).toContain('https://prod-west.openshift.imagile.dev/');
  });

  it('--env and --instance pick a cluster together, must agree, and a value that matches several is refused naming them', async () => {
    const disagree = await run(podMetricsCommand, { namespace: NAMESPACE, env: 'dev', instance: 'west' }, [], { clusters });
    expect(disagree.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Two different connections') });
    // KF3 (#136): each alone is ambiguous here, so the pair picks the one cluster that matches both.
    const together = await run(podMetricsCommand, { namespace: NAMESPACE, env: 'prod', instance: 'east' }, [json(podMetrics)], { clusters });
    expect(together.calls[0]!.url).toContain('https://prod-east.openshift.imagile.dev/');
    const ambiguous = await run(podMetricsCommand, { namespace: NAMESPACE, env: 'prod' }, [], { clusters });
    expect(ambiguous.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Several openshift connections have env "prod" (from the call): prod-east, prod-west.' });
    expect(ambiguous.calls).toEqual([]);
  });

  it('an unknown --env lists the clusters toil knows', async () => {
    const { envelope, calls } = await run(podMetricsCommand, { namespace: NAMESPACE, env: 'qa' }, [], { clusters });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'openshift has no env "qa" (from the call). It knows: prod (connection prod-east), prod (connection prod-west), dev (connection dev-north).' });
    expect(calls).toEqual([]);
  });

  it("keeps the contract's not-configured wording: a named cluster by env/instance, the flat one plainly; URL before token", async () => {
    const named = (settings: Settings) => run(podMetricsCommand, { namespace: NAMESPACE }, [], { config: { openshift: { env: 'prod', instance: 'east', ...settings } } });
    expect((await named({ token: 't' })).envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'OpenShift cluster "prod/east" is not configured or missing baseUrl.', fix: expect.stringContaining('TOIL_OPENSHIFT_BASE_URL') });
    expect((await named({})).envelope.error?.message).toBe('OpenShift cluster "prod/east" is not configured or missing baseUrl.');
    expect((await named({ baseUrl: OPENSHIFT })).envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'OpenShift cluster "prod/east" is missing a token.', fix: expect.stringContaining('TOIL_OPENSHIFT_TOKEN') });
    const flat = (settings: Settings) => run(podMetricsCommand, { namespace: NAMESPACE }, [], { config: { openshift: settings } });
    expect((await flat({ token: 't' })).envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'OpenShift not configured.' });
    expect((await flat({ baseUrl: OPENSHIFT })).envelope.error).toMatchObject({ code: 'NOT_CONFIGURED', message: 'OpenShift credentials not configured.' });
  });
});

describe('cluster list', () => {
  it('runs connections list for openshift alone: every configured cluster, never a secret', async () => {
    const { context } = testContext({ config: { openshift: fixtureConfig.openshift, sonar: { baseUrl: 'https://sonar.imagile.dev', token: 't' } } });
    const run = await runCli(['openshift', 'cluster', 'list'], { commands: registered, context });
    expect(run.envelope?.meta.command).toBe('connections list');
    const data = run.envelope?.data as { connections: Array<{ name: string; area: string; host: string; values: Record<string, string> }> };
    expect(data.connections).toEqual([expect.objectContaining({ name: 'openshift', area: 'openshift', host: 'openshift.imagile.dev', values: { baseUrl: 'env', token: 'env', env: 'env', instance: 'env' } })]);
    expect(JSON.stringify(run.envelope)).not.toContain('test-token');
  });
});
