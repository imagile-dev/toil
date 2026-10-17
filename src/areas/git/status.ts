import { z } from 'zod';
import { gitArea } from './area.js';
import { execOutput, requireRepo, runGit } from './runner.js';

/**
 * `git status`: the working tree as three lists, from `git status
 * --porcelain` (v1). A file can be both staged and unstaged, much like a
 * request that is both approved and pending review.
 */

export interface GitStatusResult {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Columns X and Y, then the path from column 3, read from output that was
 * trimmed whole first. That trim takes the first line's leading space, so an
 * unstaged-only first file loses a character of its path (#74 item 1,
 * pinned). Renames stay `old -> new` and quoted paths stay quoted (item 2).
 */
export function parseStatus(output: string): GitStatusResult {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  if (!output) return { staged, unstaged, untracked };
  for (const line of output.split('\n')) {
    if (!line) continue;
    const x = line[0]!;
    const y = line[1]!;
    const file = line.slice(3);
    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }
  return { staged, unstaged, untracked };
}

export const statusCommand = gitArea.command({
  path: ['git', 'status'],
  kind: 'area-local',
  description: 'Show staged, unstaged, and untracked files as JSON',
  toolDescription:
    'The working tree of the git repository in the workspace, from git status --porcelain: { staged, unstaged, untracked }, each a list of paths relative to the repository root. A file with staged and unstaged changes is in both. Runs the git on PATH.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    await requireRepo(ctx);
    // A failing git is an error here, unlike diff and log: the predecessor never caught it.
    return parseStatus(execOutput('git status --porcelain', await runGit(ctx, { subcommand: 'status', options: ['--porcelain'] })));
  },
});

export const statusCommands = [statusCommand];
