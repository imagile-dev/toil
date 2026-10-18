import { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest, type ApiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import type { QueryParam } from '../../core/rest.js';
import { saucelabsArea } from './area.js';

/**
 * Every request toil sends to Sauce Labs, and the input parsing the canonical
 * implementation did before sending one: integers, timestamps and enums are
 * checked here, case-insensitively for enums, and refused with the same
 * words before any request goes out. Several API families share the host
 * (`/rest/v1`, `/rdc/v2`, `/v2/builds`, `/team-management/v1`, `/v1/storage`),
 * and the Django-style ones keep their trailing slash, as their routing
 * table insists in triplicate.
 */

export type SauceConnection = Connection<z.output<typeof saucelabsArea.connection>>;
export type SauceContext = CommandContext<SauceConnection>;

/** Real Device Access API (device catalog, sessions, device actions). */
export const RDA = '/rdc/v2';
/** Team Management API. Its routes are Django-style: keep the trailing slash. */
export const TEAM_MGMT = '/team-management/v1';

/** The per-request timeout the contract specifies. */
const TIMEOUT_MS = 30_000;
/** What every call sends besides the Basic header, sent exactly as the contract specifies. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

export interface SauceRequest {
  method?: ApiRequest['method'];
  query?: Record<string, QueryParam>;
  body?: unknown;
  timeoutMs?: number;
}

export function sauce<T>(ctx: SauceContext, path: string, req: SauceRequest = {}): Promise<T> {
  return apiRequest<T>(saucelabsArea, ctx, path, {
    method: req.method ?? 'GET',
    headers: JSON_HEADERS,
    timeoutMs: req.timeoutMs ?? TIMEOUT_MS,
    ...(req.query ? { query: req.query } : {}),
    ...(req.body !== undefined ? { json: req.body } : {}),
  });
}

/** A path segment: trimmed, then encoded, as the contract specifies for every id. */
export const id = (value: string): string => encodeURIComponent(value.trim());

/** `/rest/v1/<username>`, the configured username's own corner of the v1 API. */
export const userPath = (ctx: SauceContext): string => `/rest/v1/${id(ctx.connection.username)}`;

/** The length of `data` (or of `data[key]`) when it's an array; otherwise undefined, so `count` drops out of the JSON. */
export function countOf(data: unknown, key?: string): number | undefined {
  const list = key ? (data as Record<string, unknown> | undefined)?.[key] : data;
  return Array.isArray(list) ? list.length : undefined;
}

/** A usage error the contract specifies before any request, with its specified wording. */
export function invalid(message: string, fix = 'Correct the flag and run the command again.'): ToilError {
  return new ToilError('INVALID_INPUT', message, { fix });
}

/** A number the contract reads as text: the CLI's string, or MCP's number, checked the same way. */
export const intText = z.union([z.number(), z.string()]);
export type IntText = z.output<typeof intText>;

/** Non-negative integers only, as text: `25`, never `-1` or `2.5`. */
export function parseIntOption(value: IntText | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const text = String(value);
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) throw invalid(`Invalid ${flag} "${text}". Expected a non-negative integer.`, `Pass ${flag} as a whole number, 0 or more.`);
  return Number(trimmed);
}

/**
 * Unix seconds as-is, or any date `Date.parse` understands, floored to seconds.
 * Suspected bug (#71 item 4): a date-time with no offset is read in the
 * machine's local time zone, so the same value selects a different window on
 * a UTC runner than on a laptop. Kept until a live run says otherwise.
 */
export function parseUnixTime(value: IntText | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const text = String(value);
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw invalid(`Invalid ${flag} "${text}". Expected Unix seconds or an ISO 8601 date such as 2026-09-01T00:00:00Z.`, `Pass ${flag} as Unix seconds or an ISO 8601 date with an offset, e.g. 2026-09-01T00:00:00Z.`);
  }
  return Math.floor(ms / 1000);
}

/** Case-insensitive match against an enum; returns the canonical spelling. */
export function parseChoice<T extends string>(value: string | undefined, choices: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  const match = choices.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  if (!match) throw invalid(`Invalid ${flag} "${value}". Expected one of: ${choices.join(', ')}.`, `Pass ${flag} as one of: ${choices.join(', ')}.`);
  return match;
}

/** `--flag a,b --flag c` → ['a', 'b', 'c']: repeatable, and each value split on commas. */
export function splitList(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values.flatMap((v) => v.split(',').map((s) => s.trim()).filter(Boolean));
}

export function passedFlag(input: { passed?: boolean | undefined; failed?: boolean | undefined }): boolean | undefined {
  if (input.passed && input.failed) throw invalid('Pass only one of --passed or --failed.', 'Drop one of --passed and --failed.');
  if (input.passed) return true;
  if (input.failed) return false;
  return undefined;
}

export function requireBody(body: Record<string, unknown>, hint: string): Record<string, unknown> {
  if (Object.keys(body).length === 0) throw invalid(`Nothing to update. ${hint}`, hint);
  return body;
}

/** A repeatable list flag: the CLI repeats it, MCP takes an array; each value may hold commas. */
export const listField = (description: string) => z.array(z.string()).optional().describe(description);
