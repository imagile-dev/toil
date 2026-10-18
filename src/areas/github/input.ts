import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { github, type GitHubContext } from './client.js';

/**
 * Inputs several GitHub commands share, read the way the contract specifies.
 * Numbers stay text until `parseInt`, so `12abc` is PR 12 and `abc` is
 * `NaN` in the path (suspected bug, #72 item 9). The form accepts whatever is
 * written in the box; the department behind it decides what it meant.
 */

/** A number read with parseInt: text stays text until then. */
export const intText = z.union([z.number(), z.string()]);
export const parseIntText = (value: number | string): number => parseInt(String(value), 10);

export const prNumber = intText.describe('Pull request number');
export const prNumberOption = { flags: '--number <n>', field: 'number', description: 'Pull request number' } as const;
export const itemNumber = intText.describe('PR or issue number');
export const itemNumberOption = { flags: '--number <n>', field: 'number', description: 'PR or issue number' } as const;

/** A date flag as `new Date()` reads it: date-only is UTC midnight, a zone-less date-time local time (#72 item 14). */
export function parseDateOption(flag: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ToilError('INVALID_INPUT', `Invalid ${flag} value "${value}". Use an ISO 8601 date such as 2025-01-31 or 2025-01-31T09:00:00Z.`, {
      fix: `Pass ${flag} as an ISO 8601 date, e.g. 2025-01-31 or 2025-01-31T09:00:00Z.`,
    });
  }
  return date;
}

/** True when `time` (epoch ms) falls within [after, before). Either bound may be omitted. */
export function inDateRange(time: number, after?: Date, before?: Date): boolean {
  if (after && time < after.getTime()) return false;
  if (before && time >= before.getTime()) return false;
  return true;
}

/** A body from `--body`, else `--body-file` (`-` is stdin), else nothing. */
export function bodyOf(ctx: GitHubContext, body: string | undefined, bodyFile: string | undefined): string | undefined {
  if (body !== undefined) return body;
  return bodyFile === undefined ? undefined : ctx.files.readText(bodyFile);
}

/** The PR's GraphQL node id, which every mutation needs, read with a plain GET first. */
export async function prNodeId(ctx: GitHubContext, owner: string, repo: string, number: number): Promise<string> {
  const pr = await github<{ node_id: string }>(ctx, `/repos/${owner}/${repo}/pulls/${number}`);
  return pr.node_id;
}

/** A merge method as GraphQL spells it: `--method squash` is `SQUASH`. */
export const graphqlMethod = (method: string | undefined) => method?.toUpperCase();

/** A list flag the user may repeat; empty means "not given", as with the contract's `[]` default. */
export const repeatable = (description: string) => z.array(z.string()).optional().describe(description);
