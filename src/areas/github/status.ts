import { apiPath } from '../../core/api-path.js';
import { z } from 'zod';
import { githubArea } from './area.js';
import { exampleCursor, github, githubList, target } from './client.js';
import { pageFields, pageOptions } from './input.js';

/**
 * Commit statuses and check runs for a ref. The ref goes into the path as
 * typed, unencoded (suspected bug, #72 item 13). Two systems report whether
 * the build passed, which is one more than most status meetings have.
 */

/** The list inside a check-runs page, which GitHub wraps in { total_count, check_runs }. */
export function checkRunItems(body: unknown): unknown[] {
  const runs = (body as { check_runs?: unknown } | undefined)?.check_runs;
  return Array.isArray(runs) ? runs : [];
}

const refInput = z.string().describe('Git ref (branch, tag, or commit SHA)');
const refArg = { name: 'ref', field: 'ref', description: 'Git ref (branch, tag, or commit SHA)' };

export const getStatusCommand = githubArea.command({
  path: ['github', 'commit', 'status'],
  description: 'Get combined commit status for a ref (branch, tag, or SHA)',
  input: z.object({ ref: refInput }),
  writes: false,
  args: [refArg],
  examples: [{ owner: 'imagile', repo: 'toil-probe', ref: 'main' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // One request: the server's first 30 statuses (suspected bug, #72 item 5).
    return github(ctx, apiPath`/repos/${owner}/${repo}/commits/${input.ref}/status`);
  },
});

export const listChecksCommand = githubArea.command({
  path: ['github', 'commit', 'checks'],
  description: 'List check runs for a ref (branch, tag, or SHA)',
  input: z.object({ ref: refInput, ...pageFields('check runs') }),
  writes: false,
  args: [refArg],
  options: [...pageOptions('check runs')],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', ref: 'abc1234' },
    { owner: 'imagile', repo: 'toil-probe', ref: 'abc1234', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // The list sits inside { total_count, check_runs }, so the pages are unwrapped here.
    return githubList(ctx, apiPath`/repos/${owner}/${repo}/commits/${input.ref}/check-runs`, `GitHub check runs for ${input.ref}`, {}, {
      limit: input.limit,
      cursor: input.cursor,
      items: checkRunItems,
    });
  },
});

export const statusCommands = [getStatusCommand, listChecksCommand];
