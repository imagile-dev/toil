/**
 * The Kubernetes response shapes the commands read, and the helpers that
 * reshape them: container state, age, and CPU and memory quantities in
 * millicores and mebibytes. Kept exactly as the canonical implementation had
 * them, including the quantities it can't read (#88 item 4), which come back
 * as null and are reported, like most capacity questions, as "no limit set".
 */

export interface K8sContainerState {
  waiting?: { reason?: string; message?: string };
  running?: { startedAt?: string };
  terminated?: { exitCode?: number; reason?: string; message?: string };
}

export interface K8sContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: K8sContainerState;
  lastState?: K8sContainerState;
  image?: string;
}

export interface K8sContainer {
  name: string;
  image?: string;
  resources?: { limits?: { cpu?: string; memory?: string }; requests?: { cpu?: string; memory?: string } };
  [key: string]: unknown;
}

export interface K8sPod {
  metadata: { name: string; namespace: string; creationTimestamp?: string; labels?: Record<string, string>; [key: string]: unknown };
  spec: { containers?: K8sContainer[]; [key: string]: unknown };
  status: {
    phase?: string;
    reason?: string;
    message?: string;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
    containerStatuses?: K8sContainerStatus[];
    initContainerStatuses?: K8sContainerStatus[];
    [key: string]: unknown;
  };
}

export interface K8sEvent {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  regarding?: { kind?: string; name?: string; namespace?: string };
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  source?: { component?: string };
  reportingComponent?: string;
}

export interface K8sPodMetrics {
  metadata: { name: string };
  containers: Array<{ name: string; usage: { cpu: string; memory: string } }>;
}

/** The shared subset of apps/v1 Deployment and apps.openshift.io/v1 DeploymentConfig. */
export interface K8sDeployment {
  metadata: { name: string; namespace: string; creationTimestamp?: string; labels?: Record<string, string>; [key: string]: unknown };
  spec: { replicas?: number; strategy?: { type?: string }; template?: { spec?: { containers?: K8sContainer[] } }; [key: string]: unknown };
  status?: {
    readyReplicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
    unavailableReplicas?: number;
    latestVersion?: number;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
    [key: string]: unknown;
  };
}

export interface K8sList<T> {
  items: T[];
}

export function containerState(s?: K8sContainerState): string {
  if (!s) return 'unknown';
  if (s.waiting) return s.waiting.reason ?? 'Waiting';
  if (s.terminated) return s.terminated.reason ?? 'Terminated';
  if (s.running) return 'Running';
  return 'unknown';
}

/** `42s`, `5m`, `3h` or `12d`, floored; `unknown` without a timestamp. */
export function age(creationTimestamp: string | undefined, now = Date.now()): string {
  if (!creationTimestamp) return 'unknown';
  const seconds = Math.floor((now - new Date(creationTimestamp).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A CPU quantity in millicores: `n`, `u` and `m` suffixes, or whole cores. */
export function cpuMillicores(cpu: string | undefined): number | null {
  if (!cpu) return null;
  if (cpu.endsWith('n')) return Math.round(Number(cpu.slice(0, -1)) / 1_000_000);
  if (cpu.endsWith('u')) return Math.round(Number(cpu.slice(0, -1)) / 1_000);
  if (cpu.endsWith('m')) return Number(cpu.slice(0, -1));
  const whole = Number(cpu);
  if (!Number.isNaN(whole)) return Math.round(whole * 1000);
  return null;
}

/**
 * A memory quantity in MiB: `Ki`/`Mi`/`Gi`/`Ti`, `K`/`M`/`G` and plain bytes.
 * `Ki`, `K`, `M` and bytes round to 2 places; `Gi`, `Ti` and `G` to whole
 * numbers; `Mi` is taken as written. Anything else is null (#88 item 4).
 */
export function memMiB(mem: string | undefined): number | null {
  if (!mem) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (mem.endsWith('Ki')) return round2(Number(mem.slice(0, -2)) / 1024);
  if (mem.endsWith('Mi')) return Number(mem.slice(0, -2));
  if (mem.endsWith('Gi')) return Math.round(Number(mem.slice(0, -2)) * 1024);
  if (mem.endsWith('Ti')) return Math.round(Number(mem.slice(0, -2)) * 1024 * 1024);
  if (mem.endsWith('K')) return round2((Number(mem.slice(0, -1)) * 1000) / (1024 * 1024));
  if (mem.endsWith('M')) return round2((Number(mem.slice(0, -1)) * 1000 * 1000) / (1024 * 1024));
  if (mem.endsWith('G')) return Math.round((Number(mem.slice(0, -1)) * 1000 * 1000 * 1000) / (1024 * 1024));
  const bytes = Number(mem);
  if (!Number.isNaN(bytes)) return round2(bytes / (1024 * 1024));
  return null;
}
