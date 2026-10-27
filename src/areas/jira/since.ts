import { z } from 'zod';
import { ToilError } from '../../core/errors.js';

/**
 * `--updated-since` for JQL search, shared by both Jira deployments: one
 * instant, written into the caller's JQL as `updated >= "…"`.
 *
 * JQL has no way to say an instant. An absolute date is "yyyy-MM-dd HH:mm" in
 * the time zone of the user's Jira profile, read through /myself, so the
 * instant is written in that zone. Minutes are the finest JQL goes, so the
 * instant is rounded down: a sync gets an issue twice rather than not at all.
 * The clause goes in front of any ORDER BY, and the caller's JQL is wrapped in
 * parentheses so an OR in it can't swallow the condition. Every reader gets the
 * same clock; whether they read it in the same zone is a matter for the profile.
 */

/** A date (midnight UTC) or a date and time with its zone, so the instant never depends on the machine's own zone. */
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/;

export const updatedSinceField = z
  .string()
  .optional()
  .describe('Only issues updated at or after this instant: an ISO 8601 date (2026-10-01, midnight UTC) or date and time with a zone (2026-10-01T09:30:00Z)');

export const updatedSinceOption = {
  flags: '--updated-since <iso>',
  field: 'updatedSince',
  description: 'Only issues updated at or after this ISO 8601 instant (2026-10-01 or 2026-10-01T09:30:00Z)',
};

/** The instant `--updated-since` names, or INVALID_INPUT saying what it accepts. */
export function parseUpdatedSince(raw: string): Date {
  const at = ISO.test(raw) ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(at.getTime())) {
    throw new ToilError('INVALID_INPUT', `--updated-since must be an ISO 8601 date or date and time with a zone, got "${raw}".`, {
      fix: 'Pass a date such as 2026-10-01 (midnight UTC), or a date and time with a zone such as 2026-10-01T09:30:00Z or 2026-10-01T09:30:00+02:00.',
    });
  }
  return at;
}

/**
 * The instant as JQL's "yyyy-MM-dd HH:mm" in `timeZone`, rounded down to the
 * minute. An unknown or missing zone falls back to UTC, and `warn` says so,
 * because an hour off in a sync is a gap nobody notices.
 */
export function jqlInstant(at: Date, timeZone: string | undefined, warn: (zone: string | undefined) => void): string {
  let zone = timeZone ?? 'UTC';
  let format: Intl.DateTimeFormat;
  try {
    format = formatter(zone);
  } catch {
    zone = 'UTC';
    format = formatter(zone);
  }
  if (zone !== timeZone) warn(timeZone);
  const part = Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
  // hourCycle h23 still prints midnight as 24 on some ICU builds.
  const hour = part.hour === '24' ? '00' : part.hour;
  return `${part.year}-${part.month}-${part.day} ${hour}:${part.minute}`;
}

const formatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * `jql` with `updated >= "<instant>"` added: before a top-level ORDER BY, and
 * with the caller's own condition in parentheses. Quoted strings and
 * parentheses are skipped, so `summary ~ "order by"` stays a search term.
 * With no JQL, the clause is the whole query.
 */
export function withUpdatedSince(jql: string | undefined, instant: string): string {
  const clause = `updated >= "${instant}"`;
  if (jql === undefined) return clause;
  const at = topLevelOrderBy(jql);
  const where = (at === -1 ? jql : jql.slice(0, at)).trim();
  const order = at === -1 ? '' : ` ${jql.slice(at).trim()}`;
  return `${where ? `(${where}) AND ${clause}` : clause}${order}`;
}

/** Where the top-level ORDER BY starts in `jql`, or -1. */
export function topLevelOrderBy(jql: string): number {
  let depth = 0;
  for (let i = 0; i < jql.length; i++) {
    const c = jql[i]!;
    if (c === '"' || c === "'") {
      // A quoted string: skip to its closing quote, past backslash escapes.
      for (i++; i < jql.length && jql[i] !== c; i++) if (jql[i] === '\\') i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /^order\s+by\b/i.test(jql.slice(i)) && (i === 0 || /\s|\)/.test(jql[i - 1]!))) return i;
  }
  return -1;
}
