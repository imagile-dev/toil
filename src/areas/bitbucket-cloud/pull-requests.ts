import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { bitbucketCloudArea } from './area.js';
import { parseUpdatedSince } from '../jira/since.js';
import { parseInclude, type Include } from '../bitbucket/client.js';
import { all, bbc, bbcResponse, exampleCursor, getPR, IN_REPO, list, needLimitForCursor, prPath, prSpec, repoPath, reviewerRefs, seg, type BitbucketCloudContext, type PullRequest, type ReviewerRef } from './client.js';

/**
 * Pull requests: list, read, open, edit, merge and decline them, and find the
 * one for the branch you're on. Cloud keeps no version number to lock
 * against, so a change lands on whatever the pull request is by then, which
 * is how most change requests are approved anyway.
 */

const id = z.number().int().positive().describe('Pull request ID');
const prArg = { name: 'id', field: 'id', description: 'Pull request ID' };
const at = { workspace: 'imagile', repo: 'toil' };

export const PR_STATES = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] as const;
const STATES = [...PR_STATES, 'ALL'] as const;

export const MERGE_STRATEGIES = ['merge_commit', 'squash', 'fast_forward', 'squash_fast_forward', 'rebase_fast_forward', 'rebase_merge'] as const;

export const listPrsCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'list'],
  description: 'List pull requests',
  toolDescription:
    'Lists the pull requests in a repository in one state (OPEN by default; ALL for every state), newest activity first as Bitbucket orders them. query is a Bitbucket query (author.account_id = "…", source.branch.name = "…"). updatedSince keeps only pull requests updated at or after an instant, sent to Bitbucket as updated_on >= <instant> in the query. With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    state: z.enum(STATES).optional().describe('PR state: OPEN|MERGED|DECLINED|SUPERSEDED|ALL (default: OPEN)'),
    query: z.string().min(1).optional().describe('Bitbucket query language filter, e.g. author.account_id = "557058:abc12345"'),
    updatedSince: z
      .string()
      .optional()
      .describe('Only PRs updated at or after this instant: an ISO 8601 date (2026-10-01, midnight UTC) or date and time with a zone (2026-10-01T09:30:00Z)'),
    limit: z.number().int().positive().optional().describe('Max total pull requests to return (default: all)'),
    cursor: z.string().min(1).optional().describe('meta.page.nextCursor from the previous call, to carry on from there (with limit)'),
  }),
  writes: false,
  context: IN_REPO,
  options: [
    { flags: '--state <state>', field: 'state', description: 'PR state: OPEN|MERGED|DECLINED|SUPERSEDED|ALL (default: OPEN)' },
    { flags: '--query <bbql>', field: 'query', description: 'Bitbucket query language filter, e.g. author.account_id = "557058:abc12345"' },
    { flags: '--updated-since <iso>', field: 'updatedSince', description: 'Only PRs updated at or after this ISO 8601 instant (2026-10-01 or 2026-10-01T09:30:00Z)' },
    { flags: '--limit <n>', field: 'limit', description: 'Max total pull requests to return (default: all)' },
    { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous call (with --limit)' },
  ],
  examples: [
    at,
    { ...at, state: 'ALL', query: 'author.account_id = "557058:abc12345"', limit: 2 },
    { ...at, limit: 1, cursor: exampleCursor('/repositories/imagile/toil/pullrequests?state=OPEN&pagelen=100&page=2') },
    { ...at, query: 'source.branch.name = "feature/retries"', updatedSince: '2026-10-01T09:30:00Z' },
  ],
  run: async (input, ctx) => {
    needLimitForCursor(input);
    const since = input.updatedSince !== undefined ? bbqlInstant(parseUpdatedSince(input.updatedSince)) : undefined;
    const state = input.state ?? 'OPEN';
    // The caller's query goes in parentheses, so an OR in it can't swallow the date.
    const q = since === undefined ? input.query : `${input.query !== undefined ? `(${input.query}) AND ` : ''}updated_on >= ${since}`;
    // Several states are the state parameter repeated, once per state.
    const query = { state: state === 'ALL' ? [...PR_STATES] : state, ...(q !== undefined ? { q } : {}) };
    return (await list<PullRequest>(ctx, `Bitbucket Cloud pull requests in ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/pullrequests`, query, { cap: input.limit, cursor: input.cursor })).items;
  },
});

/** An instant as a BBQL datetime: ISO 8601 in UTC, unquoted, without milliseconds when there are none. */
const bbqlInstant = (at: Date): string => at.toISOString().replace('.000Z', 'Z');

/** Activity entries that are a reviewer's verdict: an approval, or changes requested. */
const isReview = (entry: Record<string, unknown>): boolean => 'approval' in entry || 'changes_requested' in entry;

/** One --include list, read in full: every page, the records as Bitbucket sent them. */
function includedList(ctx: BitbucketCloudContext, id: number, pr: PullRequest, name: Include): Promise<unknown[]> {
  const path = prPath(ctx, id);
  switch (name) {
    case 'reviews':
      return all<Record<string, unknown>>(ctx, `Bitbucket Cloud activity on pull request ${id}`, `${path}/activity`).then((entries) => entries.filter(isReview));
    case 'checks':
      // What pr builds reads.
      return all(ctx, `Bitbucket Cloud build statuses on pull request ${id}`, `${path}/statuses`);
    case 'commits':
      return all(ctx, `Bitbucket Cloud commits on pull request ${id}`, `${path}/commits`);
    case 'files':
      // What pr files reads, before it keeps only the paths.
      return all(ctx, `Bitbucket Cloud files changed in pull request ${id}`, `${repoPath(ctx)}/diffstat/${seg(prSpec(pr))}`, { topic: true });
  }
}

export const getPrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'get'],
  description: 'Get a pull request by ID',
  toolDescription:
    'Returns one pull request: title, description, state, author, source and destination branches and commits, reviewers, participants with their approval state, and links. include adds an `included` object holding only the lists asked for, each as Bitbucket returns them with every page read: reviews (the activity entries holding an approval or changes_requested), checks (the build statuses, as pr builds reads them), commits, and files (the diffstat entries, with lines_added and lines_removed). Each list costs more requests.',
  input: z.object({
    id,
    include: z.string().optional().describe('Comma-separated extras to add under included: reviews, checks, commits, files'),
  }),
  writes: false,
  context: IN_REPO,
  args: [prArg],
  options: [{ flags: '--include <list>', field: 'include', description: 'Comma-separated extras to add under included: reviews, checks, commits, files' }],
  examples: [
    { ...at, id: 42 },
    { ...at, id: 42, include: 'reviews,checks,commits,files' },
  ],
  run: async (input, ctx) => {
    // Refused before anything is sent, so a typo costs no requests.
    const lists = input.include !== undefined ? parseInclude(input.include) : undefined;
    const pr = await getPR(ctx, input.id);
    if (!lists) return pr;
    const included: Partial<Record<Include, unknown[]>> = {};
    // One list at a time, in the order included lists them.
    for (const name of lists) included[name] = await includedList(ctx, input.id, pr, name);
    return { ...pr, included };
  },
});

export const createPrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'create'],
  description: 'Create a pull request',
  toolDescription:
    "Opens a pull request from source to target (default: the repository's main branch) and returns it. reviewers are comma-separated Atlassian account ids, or {uuid}s in braces; without them, the repository's default reviewers apply. closeSourceBranch deletes the source branch when it merges.",
  input: z.object({
    title: z.string().min(1).describe('PR title'),
    source: z.string().min(1).describe('Source branch'),
    target: z.string().min(1).optional().describe("Target branch (default: the repository's main branch)"),
    description: z.string().optional().describe('PR description (Markdown)'),
    reviewers: z.string().optional().describe('Comma-separated reviewer account ids, or {uuid}s'),
    closeSourceBranch: z.boolean().optional().describe('Delete the source branch when the PR merges'),
    draft: z.boolean().optional().describe('Open it as a draft'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    { flags: '--title <title>', field: 'title', description: 'PR title' },
    { flags: '--source <branch>', field: 'source', description: 'Source branch' },
    { flags: '--target <branch>', field: 'target', description: "Target branch (default: the repository's main branch)" },
    { flags: '--description <desc>', field: 'description', description: 'PR description (Markdown)' },
    { flags: '--reviewers <ids>', field: 'reviewers', description: 'Comma-separated reviewer account ids, or {uuid}s' },
    { flags: '--close-source-branch', field: 'closeSourceBranch', description: 'Delete the source branch when the PR merges' },
    { flags: '--draft', field: 'draft', description: 'Open it as a draft' },
  ],
  examples: [
    { ...at, title: 'Add retries', source: 'feature/retries', allowWrite: true },
    {
      ...at,
      title: 'Tidy up',
      source: 'tidy',
      target: 'develop',
      description: 'Small things',
      reviewers: '557058:abc12345, {abc12345-0000-0000-0000-000000000000}',
      closeSourceBranch: true,
      draft: true,
      allowWrite: true,
    },
  ],
  run: (input, ctx) => {
    const reviewers = input.reviewers !== undefined ? reviewerRefs(input.reviewers) : [];
    return bbc<PullRequest>(ctx, `${repoPath(ctx)}/pullrequests`, {
      method: 'POST',
      json: {
        title: input.title,
        source: { branch: { name: input.source } },
        ...(input.target ? { destination: { branch: { name: input.target } } } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        // Left out rather than [], so the repository's default reviewers still apply.
        ...(reviewers.length > 0 ? { reviewers } : {}),
        ...(input.closeSourceBranch !== undefined ? { close_source_branch: input.closeSourceBranch } : {}),
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
      },
    });
  },
});

export const updatePrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'update'],
  description: 'Update a pull request',
  toolDescription:
    "Changes an open pull request's title, description, reviewers or target branch and returns it. Reads the PR first and sends the current title, description and reviewers for anything not given, so nothing is cleared by omission. reviewers replaces the whole list.",
  input: z.object({
    id,
    title: z.string().min(1).optional().describe('New title'),
    description: z.string().optional().describe('New description (Markdown)'),
    reviewers: z.string().optional().describe('Comma-separated reviewer account ids, or {uuid}s; replaces the list'),
    target: z.string().min(1).optional().describe('New target branch'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  args: [prArg],
  options: [
    { flags: '--title <title>', field: 'title', description: 'New title' },
    { flags: '--description <desc>', field: 'description', description: 'New description (Markdown)' },
    { flags: '--reviewers <ids>', field: 'reviewers', description: 'Comma-separated reviewer account ids, or {uuid}s; replaces the list' },
    { flags: '--target <branch>', field: 'target', description: 'New target branch' },
  ],
  examples: [
    { ...at, id: 42, title: 'Add retries, with backoff', allowWrite: true },
    { ...at, id: 42, description: '', reviewers: '557058:abc12345', target: 'develop', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const pr = await getPR(ctx, input.id);
    // What the PUT leaves out may be cleared, so the current values go back.
    const current = (pr.reviewers ?? []).flatMap((r): ReviewerRef[] => (r.uuid ? [{ uuid: r.uuid }] : r.account_id ? [{ account_id: r.account_id }] : []));
    const reviewers = input.reviewers !== undefined ? reviewerRefs(input.reviewers) : current;
    return bbc<PullRequest>(ctx, prPath(ctx, input.id), {
      method: 'PUT',
      json: {
        title: input.title ?? pr.title,
        description: input.description ?? pr.description ?? '',
        reviewers,
        ...(input.target ? { destination: { branch: { name: input.target } } } : {}),
      },
    });
  },
});

export const mergePrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'merge'],
  description: 'Merge a pull request',
  toolDescription:
    "Merges a pull request and returns it. strategy is one of Bitbucket Cloud's merge strategies (default: the repository's). deleteBranch deletes the source branch after the merge. When Bitbucket queues the merge or takes too long (202), data is { pending: true, taskStatus } with the task-status path to read with bitbucket_cloud_api, and a BITBUCKET_CLOUD_MERGE_PENDING warning.",
  input: z.object({
    id,
    strategy: z.enum(MERGE_STRATEGIES).optional().describe(`Merge strategy: ${MERGE_STRATEGIES.join('|')}`),
    message: z.string().min(1).optional().describe('Merge commit message'),
    deleteBranch: z.boolean().optional().describe('Delete source branch after merge'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  args: [prArg],
  options: [
    { flags: '--strategy <strategy>', field: 'strategy', description: `Merge strategy: ${MERGE_STRATEGIES.join('|')}` },
    { flags: '--message <text>', field: 'message', description: 'Merge commit message' },
    { flags: '--delete-branch', field: 'deleteBranch', description: 'Delete source branch after merge' },
  ],
  examples: [
    { ...at, id: 42, allowWrite: true },
    { ...at, id: 43, strategy: 'squash', message: 'Add retries (#43)', deleteBranch: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const response = await bbcResponse<unknown>(ctx, `${prPath(ctx, input.id)}/merge`, {
      method: 'POST',
      json: {
        ...(input.strategy ? { merge_strategy: input.strategy } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.deleteBranch !== undefined ? { close_source_branch: input.deleteBranch } : {}),
      },
    });
    if (response.status !== 202) return response.data;
    const location = response.headers.get('location');
    // The poll link, as a path under baseUrl for bitbucket-cloud api; never followed blind.
    const basePath = new URL(ctx.connection.baseUrl).pathname.replace(/\/+$/, '');
    const polled = location ? new URL(location, ctx.connection.baseUrl).pathname : null;
    const taskStatus = polled && basePath && polled.startsWith(`${basePath}/`) ? polled.slice(basePath.length) : polled;
    ctx.warn({
      code: 'BITBUCKET_CLOUD_MERGE_PENDING',
      message: `Bitbucket Cloud accepted the merge of pull request ${input.id} but hasn't finished it (a merge queue, or a slow merge).${taskStatus ? ` Read toil bitbucket-cloud api GET ${taskStatus} until task_status is SUCCESS.` : ' Check the pull request in Bitbucket before trying again.'}`,
    });
    return { pending: true, taskStatus };
  },
});

export const declinePrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'decline'],
  description: 'Decline a pull request',
  toolDescription: 'Declines an open pull request and returns it.',
  input: z.object({ id, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  args: [prArg],
  examples: [{ ...at, id: 42, allowWrite: true }],
  run: (input, ctx) => bbc(ctx, `${prPath(ctx, input.id)}/decline`, { method: 'POST' }),
});

export const currentPrCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'pr', 'current'],
  description: 'Find the open PR for the current branch',
  toolDescription: "Returns the open pull request whose source branch is the workspace's current git branch, or null when there is none. The repository comes from --ws and --repo (or the connection), not from the git remote.",
  input: z.object({}),
  writes: false,
  context: IN_REPO,
  examples: [at],
  run: async (_input, ctx) => {
    const repository = ctx.repo();
    if (!repository) throw new ToilError('INVALID_INPUT', 'Not a git repository', { fix: 'Run it inside a git clone, or point --workspace at one.' });
    if (repository.branch === 'unknown') throw new ToilError('INVALID_INPUT', 'Could not determine current branch', { fix: 'Check out a branch with at least one commit, then try again.' });
    // A double quote would end the query's string early; Bitbucket's query language escapes it with a backslash.
    const branch = repository.branch.replace(/["\\]/g, '\\$&');
    const page = await bbc<{ values?: PullRequest[] }>(ctx, `${repoPath(ctx)}/pullrequests`, { query: { state: 'OPEN', q: `source.branch.name = "${branch}"`, pagelen: 1 } });
    return page.values?.[0] ?? null;
  },
});

export const pullRequestCommands = [listPrsCommand, getPrCommand, createPrCommand, updatePrCommand, mergePrCommand, declinePrCommand, currentPrCommand];
