import { z } from 'zod';
import { gitArea } from './area.js';
import { execOutput, requireRepo, runGit } from './runner.js';

/** `git branch`: the current branch and every local and remote one, as `git branch -a` lists them. */

export interface BranchResult {
  current: string;
  local: string[];
  remote: string[];
}

/**
 * A leading `*` marks the current branch; `remotes/` entries go to `remote`
 * with that prefix taken off. Anything else git prints on a branch line
 * stays: a worktree's `+ `, `(HEAD detached at …)` as the current branch, and
 * `origin/HEAD -> origin/main` as a remote (#74 item 7, pinned). Every label
 * is accepted at the counter, whether or not it is a branch.
 */
export function parseBranches(output: string): BranchResult {
  const local: string[] = [];
  const remote: string[] = [];
  let current = '';
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();
    if (name.startsWith('remotes/')) {
      remote.push(name.replace('remotes/', ''));
    } else {
      if (isCurrent) current = name;
      local.push(name);
    }
  }
  return { current, local, remote };
}

export const branchCommand = gitArea.command({
  path: ['git', 'branch'],
  kind: 'area-local',
  description: 'Show current branch and all local/remote branches',
  toolDescription:
    'The branches of the git repository in the workspace, from git branch -a: { current, local, remote }, remote names without the remotes/ prefix (origin/main). Runs the git on PATH.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    await requireRepo(ctx);
    return parseBranches(execOutput('git branch -a', await runGit(ctx, { subcommand: 'branch', options: ['-a'] })));
  },
});

export const branchCommands = [branchCommand];
