import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import type { QueryValue } from '../../core/rest.js';
import { sonatypeiqArea } from './area.js';

/**
 * The read commands' one request shape, as the command contract specifies
 * it: a GET under the base URL, JSON headers, `Connection: close`, 30 s, and
 * the server's answer passed through untouched. Nothing is reshaped, so
 * nothing needs a reshaping committee.
 */

export type SonatypeIqConnection = Connection<z.output<typeof sonatypeiqArea.connection>>;
export type SonatypeIqContext = CommandContext<SonatypeIqConnection>;

/** The per-request timeout the contract specifies for these commands. */
const TIMEOUT_MS = 30_000;
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export function iq<T>(ctx: SonatypeIqContext, path: string, params?: Record<string, QueryValue>): Promise<T> {
  return apiRequest<T>(sonatypeiqArea, ctx, path, { headers: JSON_HEADERS, timeoutMs: TIMEOUT_MS, ...(params ? { query: params } : {}) });
}
