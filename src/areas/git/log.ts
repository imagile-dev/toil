import { z } from 'zod';
import { gitArea } from './area.js';
import { execOutput, requireRepo, runGit, swallowGitFailure } from './runner.js';

/**
 * `git log`: recent commits as hash, author, date and subject. Fields are
 * split on the ASCII unit separator, a character that has waited since 1963
 * for a form to be filed in.
 */

const SEP = '\x1F';

export interface CommitEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export function parseLog(output: string): CommitEntry[] {
  if (!output) return [];
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(SEP);
      return { hash: parts[0] ?? '', author: parts[1] ?? '', date: parts[2] ?? '', message: parts[3] ?? '' };
    });
}

export const logCommand = gitArea.command({
  path: ['git', 'log'],
  kind: 'area-local',
  description: 'Show recent commits as JSON',
  toolDescription:
    'Recent commits of the git repository in the workspace, newest first: [{ hash, author, date (ISO 8601, author date), message (the subject line) }]. count defaults to 10; since takes anything git accepts ("2 weeks ago", 2024-01-31). Runs the git on PATH; a failing git gives an empty list.',
  // Text, read with parseInt as the contract specifies: "abc" and "0" both mean no limit (#74 item 6).
  input: z.object({
    count: z.union([z.number(), z.string()]).optional().describe('Number of commits to show (default: "10")'),
    since: z.string().optional().describe('Show commits since date (e.g. "2 weeks ago")'),
  }),
  writes: false,
  options: [
    { flags: '--count <n>', field: 'count', description: 'Number of commits to show (default: "10")' },
    { flags: '--since <date>', field: 'since', description: 'Show commits since date (e.g. "2 weeks ago")' },
  ],
  examples: [{}, { count: '5', since: '2 weeks ago' }],
  run: async (input, ctx) => {
    await requireRepo(ctx);
    const count = parseInt(String(input.count ?? '10'), 10);
    const options = [`--format=%H${SEP}%an${SEP}%aI${SEP}%s`];
    // NaN would give `-n NaN`, but NaN is falsy, so it never gets that far.
    if (count) options.push(`-n${count}`);
    if (input.since) options.push(`--since=${input.since}`);
    return swallowGitFailure(
      async () => parseLog(execOutput('git log', await runGit(ctx, { subcommand: 'log', options }))),
      () => [],
    );
  },
});

export const logCommands = [logCommand];
