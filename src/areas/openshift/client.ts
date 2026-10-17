import type { Connection } from '../../core/area.js';
import { apiRequest } from '../../core/api.js';
import type { CommandContext } from '../../core/context.js';
import type { QueryValue } from '../../core/rest.js';
import { openshiftArea, type OpenShiftSettings } from './area.js';

/**
 * Every request toil sends to the API server, with the headers, timeout and
 * query exactly as the command contract sent them. List calls send
 * no `limit`, so the server returns the whole list in one answer and nobody
 * has to sign off on page two.
 */

export type OpenShiftContext = CommandContext<Connection<OpenShiftSettings>, Partial<Record<'env' | 'instance', string>>>;

/** The contract's per-request timeout. */
const TIMEOUT_MS = 30_000;
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };
const TEXT_HEADERS = { Accept: '*/*', Connection: 'close' };

export function openshift<T>(ctx: OpenShiftContext, path: string, query?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(openshiftArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(query ? { query } : {}) });
}

/** A text answer (pod logs), sent with `Accept: *\/*` and no Content-Type. */
export function openshiftText(ctx: OpenShiftContext, path: string, query: Record<string, QueryValue>): Promise<string> {
  return apiRequest<string>(openshiftArea, ctx, path, { headers: TEXT_HEADERS, timeoutMs: TIMEOUT_MS, query, as: 'text' });
}

export const ns = (namespace: string) => encodeURIComponent(namespace);
