import { z } from 'zod';
import { githubArea } from './area.js';
import { github, githubAll, target } from './client.js';

/**
 * Commit statuses and check runs for a ref. The ref goes into the path as
 * typed, unencoded (suspected bug, #72 item 13). Two systems report whether
 * the build passed, which is one more than most status meetings have.
 */

const refInput = z.string().describe('Git ref (branch, tag, or commit SHA)');
const refOption = { flags: '--ref <ref>', field: 'ref', description: 'Git ref (branch, tag, or commit SHA)' } as const;

export const getStatusCommand = githubArea.command({
  path: ['github', 'get-status'],
  description: 'Get combined commit status for a ref (branch, tag, or SHA)',
  input: z.object({ ref: refInput }),
  writes: false,
  options: [refOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', ref: 'main' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // One request: the server's first 30 statuses (suspected bug, #72 item 5).
    return github(ctx, `/repos/${owner}/${repo}/commits/${input.ref}/status`);
  },
});

export const listChecksCommand = githubArea.command({
  path: ['github', 'list-checks'],
  description: 'List check runs for a ref (branch, tag, or SHA)',
  input: z.object({ ref: refInput }),
  writes: false,
  options: [refOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', ref: 'abc1234' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // The list sits inside { total_count, check_runs }, so the pages are unwrapped here.
    return githubAll(ctx, `/repos/${owner}/${repo}/commits/${input.ref}/check-runs`, `GitHub check runs for ${input.ref}`, {}, (body) => {
      const runs = (body as { check_runs?: unknown } | undefined)?.check_runs;
      return Array.isArray(runs) ? runs : [];
    });
  },
});

export const statusCommands = [getStatusCommand, listChecksCommand];
