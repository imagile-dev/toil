import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, apiResponse, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { QueryValue } from '../../core/rest.js';
import { jenkinsArea } from './area.js';

/**
 * Every request toil sends to Jenkins, kept as the canonical implementation
 * sent them: the same endpoints, the same `tree` selections, the same headers.
 * A job in a folder is addressed by repeating `/job/` once per level, which is
 * how Jenkins files its paperwork: in folders, inside folders, inside folders.
 */

export type JenkinsConnection = Connection<z.output<typeof jenkinsArea.connection>>;
export type JenkinsContext = CommandContext<JenkinsConnection, { instance?: string }>;

/** The predecessor's per-request timeout. */
const TIMEOUT_MS = 30_000;

/** What every call sends besides the Basic auth header, exactly as the predecessor sent it. */
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

/** `A/B/C` -> `A/job/B/job/C`, each segment percent-encoded. A single-level name is unchanged. */
export function jobPath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/job/');
}

function jenkins<T>(ctx: JenkinsContext, path: string, req: ApiRequest = {}): Promise<T> {
  return apiRequest<T>(jenkinsArea, ctx, path, { headers: HEADERS, timeoutMs: TIMEOUT_MS, ...req });
}

const JOB_TREE = 'jobs[name,url,color,description,buildable,lastBuild[number,url,result]]';
const JOB_DETAIL_TREE =
  'name,url,color,description,buildable,nextBuildNumber,inQueue,lastBuild[number,url,result],builds[number,url,result,duration,timestamp,building,displayName]{0,10}';
const BUILD_FIELDS = 'number,url,result,duration,timestamp,building,displayName,fullDisplayName,description,id,queueId';

export async function listJobs(ctx: JenkinsContext, folder?: string): Promise<unknown> {
  const path = folder ? `/job/${jobPath(folder)}/api/json` : '/api/json';
  const data = await jenkins<{ jobs?: unknown }>(ctx, path, { query: { tree: JOB_TREE } });
  return data?.jobs;
}

export function getJob(ctx: JenkinsContext, name: string): Promise<unknown> {
  return jenkins(ctx, `/job/${jobPath(name)}/api/json`, { query: { tree: JOB_DETAIL_TREE } });
}

/**
 * POSTs `/build`, or `/buildWithParameters` with the parameters in the query
 * when there are any, and reads the queue item id from `Location`. Suspected
 * bug (#80 item 4): a parameterized job run with no parameters still goes to
 * `/build`.
 */
export async function triggerBuild(ctx: JenkinsContext, name: string, params?: Record<string, string>): Promise<{ queueItemId: number }> {
  const hasParams = params !== undefined && Object.keys(params).length > 0;
  const path = `/job/${jobPath(name)}/${hasParams ? 'buildWithParameters' : 'build'}`;
  const res = await apiResponse<string>(jenkinsArea, ctx, path, {
    method: 'POST',
    headers: HEADERS,
    timeoutMs: TIMEOUT_MS,
    as: 'text',
    ...(hasParams ? { query: params as Record<string, QueryValue> } : {}),
  });
  const location = res.headers.get('Location') ?? '';
  const match = /\/queue\/item\/(\d+)\/?$/.exec(location);
  if (!match) {
    throw new ToilError('HTTP', 'Build queued but Jenkins did not return a Location header — cannot track queue item', {
      fix: `The build may be queued. Check it with toil jenkins pipeline list-runs --name ${name} before triggering it again.`,
      details: { status: res.status },
    });
  }
  return { queueItemId: parseInt(match[1]!, 10) };
}

export interface QueueItem {
  why?: string | null;
  blocked?: boolean;
  buildable?: boolean;
  executable?: { number?: number };
}

export function getQueueItem(ctx: JenkinsContext, queueItemId: number): Promise<QueueItem> {
  return jenkins(ctx, `/queue/item/${queueItemId}/api/json`);
}

/** Suspected bug (#80 item 3): `builds` holds only the newest 100, so `top` above 100 is quietly capped. */
export async function listBuilds(ctx: JenkinsContext, name: string, top: number): Promise<unknown> {
  const data = await jenkins<{ builds?: unknown }>(ctx, `/job/${jobPath(name)}/api/json`, { query: { tree: `builds[${BUILD_FIELDS}]{0,${top}}` } });
  return data?.builds ?? [];
}

export interface Build {
  building?: boolean;
  result?: string | null;
  [key: string]: unknown;
}

export function getBuild(ctx: JenkinsContext, name: string, buildNumber: number): Promise<Build> {
  return jenkins(ctx, `/job/${jobPath(name)}/${buildNumber}/api/json`);
}

export function getConsoleLog(ctx: JenkinsContext, name: string, buildNumber: number): Promise<string> {
  return jenkins(ctx, `/job/${jobPath(name)}/${buildNumber}/consoleText`, { as: 'text' });
}
