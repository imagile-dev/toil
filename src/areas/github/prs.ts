import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { githubArea } from './area.js';
import { exampleCursor, github, githubList, githubText, target, type GitHubContext } from './client.js';
import { bodyOf, inDateRange, pageFields, pageOptions, parseDateOption, parseIntText, prNumber, prNumberOption } from './input.js';

/**
 * Pull requests themselves: list, read, open, edit, merge, close, reopen, and
 * the diff and file list. `data` is GitHub's answer as it came, apart from
 * `list-prs`'s client-side author and date filters and `diff`'s wrapper.
 * Merging is done by request, like every other approval worth having.
 */

interface PullRequest {
  created_at: string;
  user?: { login?: string };
}

const prPath = (owner: string, repo: string, number: number) => `/repos/${owner}/${repo}/pulls/${number}`;

export const listPrsCommand = githubArea.command({
  path: ['github', 'list-prs'],
  description: 'List pull requests',
  input: z.object({
    state: z.enum(['open', 'closed', 'all']).optional().describe('PR state (choices: "open", "closed", "all", default: "open")'),
    head: z.string().optional().describe('Filter by head branch (user:branch)'),
    base: z.string().optional().describe('Filter by base branch'),
    author: z.string().optional().describe('Filter by author login'),
    createdAfter: z.string().optional().describe('Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)'),
    createdBefore: z.string().optional().describe('Only PRs created before this ISO 8601 date'),
    ...pageFields('pull requests'),
  }),
  writes: false,
  options: [
    { flags: '--state <state>', field: 'state', description: 'PR state (choices: "open", "closed", "all", default: "open")' },
    { flags: '--head <branch>', field: 'head', description: 'Filter by head branch (user:branch)' },
    { flags: '--base <branch>', field: 'base', description: 'Filter by base branch' },
    { flags: '--author <login>', field: 'author', description: 'Filter by author login' },
    { flags: '--created-after <date>', field: 'createdAfter', description: 'Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)' },
    { flags: '--created-before <date>', field: 'createdBefore', description: 'Only PRs created before this ISO 8601 date' },
    ...pageOptions('pull requests'),
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe' },
    { owner: 'imagile', repo: 'toil-probe', state: 'all', head: 'imagile:feature', base: 'main', author: 'OCTO-DEV', createdAfter: '2025-01-01', createdBefore: '2025-02-01T00:00:00Z' },
    { owner: 'imagile', repo: 'toil-probe', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    // Dates are checked before anything else, so a bad date fails even with no repo.
    const createdAfter = input.createdAfter ? parseDateOption('--created-after', input.createdAfter) : undefined;
    const createdBefore = input.createdBefore ? parseDateOption('--created-before', input.createdBefore) : undefined;
    const { owner, repo } = target(ctx);
    // The pulls endpoint has no author or date filter, so both apply to each page as it
    // comes in, and --limit counts the pull requests that pass them.
    const author = input.author?.toLowerCase();
    return githubList<PullRequest>(
      ctx,
      `/repos/${owner}/${repo}/pulls`,
      `GitHub pull requests in ${owner}/${repo}`,
      { state: input.state ?? 'open', ...(input.head ? { head: input.head } : {}), ...(input.base ? { base: input.base } : {}) },
      { limit: input.limit, cursor: input.cursor, keep: (pr) => (!author || pr.user?.login?.toLowerCase() === author) && inDateRange(Date.parse(pr.created_at), createdAfter, createdBefore) },
    );
  },
});

export const getPrCommand = githubArea.command({
  path: ['github', 'get-pr'],
  description: 'Get a pull request by number',
  input: z.object({ number: prNumber }),
  writes: false,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    return github(ctx, prPath(owner, repo, parseIntText(input.number)));
  },
});

export const createPrCommand = githubArea.command({
  path: ['github', 'create-pr'],
  description: 'Create a pull request',
  input: z.object({
    title: z.string().describe('PR title'),
    head: z.string().describe('Source branch (or user:branch for forks)'),
    base: z.string().optional().describe('Target branch (defaults to config or main)'),
    body: z.string().optional().describe('PR description'),
    bodyFile: z.string().optional().describe('Read PR description from a file (use - for stdin); overridden by --body'),
    draft: z.boolean().optional().describe('Create as draft PR'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--title <title>', field: 'title', description: 'PR title' },
    { flags: '--head <branch>', field: 'head', description: 'Source branch (or user:branch for forks)' },
    { flags: '--base <branch>', field: 'base', description: 'Target branch (defaults to config or main)' },
    { flags: '--body <body>', field: 'body', description: 'PR description' },
    { flags: '--body-file <path>', field: 'bodyFile', description: 'Read PR description from a file (use - for stdin); overridden by --body' },
    { flags: '--draft', field: 'draft', description: 'Create as draft PR' },
    // The same inputs as the group's --owner/--repo, also accepted after the leaf, where they win.
    { flags: '--owner <owner>', field: 'owner', description: 'GitHub owner (overrides parent --owner)' },
    { flags: '--repo <repo>', field: 'repo', description: 'GitHub repository name (overrides parent --repo)' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', title: 'Add the probe', head: 'feature', body: 'Adds it.', draft: true, base: 'develop', allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', title: 'Add the probe', head: 'imagile:feature', bodyFile: 'pr-body.md', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const base = input.base ?? ctx.connection.targetBranch ?? 'main';
    const body = bodyOf(ctx, input.body, input.bodyFile);
    return github(ctx, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      json: { title: input.title, head: input.head, base, ...(body !== undefined ? { body } : {}), ...(input.draft !== undefined ? { draft: input.draft } : {}) },
    });
  },
});

/** A PATCH of the PR with only the fields given; `{}` when none are. */
function updatePr(ctx: GitHubContext, number: number, fields: { title?: string | undefined; body?: string | undefined; state?: 'open' | 'closed'; base?: string | undefined }) {
  const { owner, repo } = target(ctx);
  const json: Record<string, unknown> = {};
  if (fields.title !== undefined) json.title = fields.title;
  if (fields.body !== undefined) json.body = fields.body;
  if (fields.state !== undefined) json.state = fields.state;
  if (fields.base !== undefined) json.base = fields.base;
  return github(ctx, prPath(owner, repo, number), { method: 'PATCH', json });
}

export const updatePrCommand = githubArea.command({
  path: ['github', 'update-pr'],
  description: 'Update a pull request',
  input: z.object({
    number: prNumber,
    title: z.string().optional().describe('New title'),
    body: z.string().optional().describe('New description'),
    base: z.string().optional().describe('New base branch'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    prNumberOption,
    { flags: '--title <title>', field: 'title', description: 'New title' },
    { flags: '--body <body>', field: 'body', description: 'New description' },
    { flags: '--base <branch>', field: 'base', description: 'New base branch' },
  ],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', title: 'Renamed', body: 'Updated.', base: 'develop', allowWrite: true }],
  run: async (input, ctx) => updatePr(ctx, parseIntText(input.number), { title: input.title, body: input.body, base: input.base }),
});

export const closePrCommand = githubArea.command({
  path: ['github', 'close-pr'],
  description: 'Close a pull request',
  input: z.object({ number: prNumber, ...allowWriteField }),
  writes: true,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true }],
  run: async (input, ctx) => updatePr(ctx, parseIntText(input.number), { state: 'closed' }),
});

export const reopenPrCommand = githubArea.command({
  path: ['github', 'reopen-pr'],
  description: 'Reopen a closed pull request',
  input: z.object({ number: prNumber, ...allowWriteField }),
  writes: true,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true }],
  run: async (input, ctx) => updatePr(ctx, parseIntText(input.number), { state: 'open' }),
});

export const mergePrCommand = githubArea.command({
  path: ['github', 'merge-pr'],
  description: 'Merge a pull request (immediate merge — use enable-auto-merge for auto-merge)',
  input: z.object({
    number: prNumber,
    method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method (choices: "merge", "squash", "rebase", default: "merge")'),
    commitTitle: z.string().optional().describe('Commit title for merge/squash'),
    commitMessage: z.string().optional().describe('Commit message for merge/squash'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    prNumberOption,
    { flags: '--method <method>', field: 'method', description: 'Merge method (choices: "merge", "squash", "rebase", default: "merge")' },
    { flags: '--commit-title <title>', field: 'commitTitle', description: 'Commit title for merge/squash' },
    { flags: '--commit-message <msg>', field: 'commitMessage', description: 'Commit message for merge/squash' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', number: '7', method: 'squash', commitTitle: 'Add the probe (#7)', commitMessage: 'Squashed.', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const json: Record<string, unknown> = {};
    if (input.commitTitle) json.commit_title = input.commitTitle;
    if (input.commitMessage) json.commit_message = input.commitMessage;
    // Always sent, defaulting to merge, even on a squash-only repository (suspected bug, #72 item 12).
    json.merge_method = input.method ?? 'merge';
    return github(ctx, `${prPath(owner, repo, parseIntText(input.number))}/merge`, { method: 'PUT', json });
  },
});

export const diffCommand = githubArea.command({
  path: ['github', 'diff'],
  description: 'Get unified diff for a pull request',
  input: z.object({ number: prNumber }),
  writes: false,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // The PR's own path; the diff media type is what turns it into a diff.
    return { diff: await githubText(ctx, prPath(owner, repo, parseIntText(input.number))) };
  },
});

export const listFilesCommand = githubArea.command({
  path: ['github', 'list-files'],
  description: 'List files changed in a pull request',
  input: z.object({ number: prNumber, ...pageFields('files') }),
  writes: false,
  options: [prNumberOption, ...pageOptions('files')],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7' },
    { owner: 'imagile', repo: 'toil-probe', number: '7', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const number = parseIntText(input.number);
    return githubList(ctx, `${prPath(owner, repo, number)}/files`, `files in GitHub PR #${number}`, {}, { limit: input.limit, cursor: input.cursor });
  },
});

export const prCommands = [listPrsCommand, getPrCommand, createPrCommand, updatePrCommand, mergePrCommand, closePrCommand, reopenPrCommand, diffCommand, listFilesCommand];
