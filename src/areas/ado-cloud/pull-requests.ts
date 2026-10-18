import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { adoCloudArea } from './area.js';
import { IN_REPO, adoc, connectionData, cursorField, enc, exampleCursor, limitField, pageOf, pageOptions, repoPath, skipPages, type AdoCloudContext } from './client.js';
import { wiqlInstant } from './wiql.js';

/**
 * Pull requests: list, read, open, edit, complete and abandon them, and vote
 * on them as the token's own user. Completing a pull request is a request to
 * complete it; policies decide later, the way approvals usually do.
 */

export const inRepo = { project: 'Imagile', repo: 'imagile-api' };
const W = { ...inRepo, allowWrite: true };
const prId = z.number().int().positive().describe('Pull request ID');
const idOption = { flags: '--id <n>', field: 'id', description: 'Pull request ID' };
const prOption = { flags: '--pr <n>', field: 'pr', description: 'Pull request ID' };

export interface PullRequest {
  pullRequestId: number;
  sourceRefName?: string;
  lastMergeSourceCommit?: { commitId?: string };
  [key: string]: unknown;
}

export const prPath = (ctx: AdoCloudContext, id: number) => `${repoPath(ctx)}/pullrequests/${id}`;

export const getPR = (ctx: AdoCloudContext, id: number) => adoc<PullRequest>(ctx, prPath(ctx, id));

/** A branch as a full ref: a short name gets refs/heads/, a full ref is kept as given. */
export const ref = (branch: string) => (branch.startsWith('refs/') ? branch : `refs/heads/${branch}`);

const STATES = ['active', 'abandoned', 'completed', 'all'] as const;
const STATE = 'PR state: active|abandoned|completed|all (default: active)';
const PRS_PAGE = 100;

export const repoListPrsCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'list-prs'],
  description: 'List pull requests',
  toolDescription:
    'Lists every pull request in the repository in one state (active by default), optionally by creator or reviewer identity id (a GUID, from ado_cloud_whoami) and by creation date. With limit, returns at most that many; pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({
    state: z.enum(STATES).optional().describe(STATE),
    creator: z.string().min(1).optional().describe('Only PRs created by this identity id'),
    reviewer: z.string().min(1).optional().describe('Only PRs with this reviewer identity id'),
    createdAfter: z.string().optional().describe('Only PRs created at or after this ISO 8601 date or zoned date-time'),
    createdBefore: z.string().optional().describe('Only PRs created before this ISO 8601 date or zoned date-time'),
    limit: limitField('pull requests'),
    cursor: cursorField,
  }),
  writes: false,
  context: IN_REPO,
  options: [
    { flags: '--state <state>', field: 'state', description: STATE },
    { flags: '--creator <id>', field: 'creator', description: 'Only PRs created by this identity id' },
    { flags: '--reviewer <id>', field: 'reviewer', description: 'Only PRs with this reviewer identity id' },
    { flags: '--created-after <date>', field: 'createdAfter', description: 'Only PRs created at or after this ISO 8601 date or zoned date-time' },
    { flags: '--created-before <date>', field: 'createdBefore', description: 'Only PRs created before this ISO 8601 date or zoned date-time' },
    ...pageOptions('pull requests'),
  ],
  examples: [
    inRepo,
    { ...inRepo, state: 'all', creator: 'abc12345-0000-0000-0000-000000000000', reviewer: 'abc12345-0000-0000-0000-000000000001', createdAfter: '2026-09-01', createdBefore: '2026-10-01T00:00:00Z' },
    { ...inRepo, limit: 1 },
    { ...inRepo, limit: 1, cursor: exampleCursor('1', PRS_PAGE) },
  ],
  run: (input, ctx) => {
    const page = pageOf(input);
    const after = input.createdAfter !== undefined ? wiqlInstant(input.createdAfter, '--created-after') : undefined;
    const before = input.createdBefore !== undefined ? wiqlInstant(input.createdBefore, '--created-before') : undefined;
    const query: Record<string, string | number> = {
      'searchCriteria.status': input.state ?? 'active',
      ...(input.creator ? { 'searchCriteria.creatorId': input.creator } : {}),
      ...(input.reviewer ? { 'searchCriteria.reviewerId': input.reviewer } : {}),
      // minTime and maxTime only count alongside queryTimeRangeType.
      ...(after || before ? { 'searchCriteria.queryTimeRangeType': 'created' } : {}),
      ...(after ? { 'searchCriteria.minTime': after } : {}),
      ...(before ? { 'searchCriteria.maxTime': before } : {}),
    };
    return skipPages(ctx, `${repoPath(ctx)}/pullrequests`, query, PRS_PAGE, `Azure DevOps pull requests in ${ctx.context.repo}`, page);
  },
});

export const repoGetPrCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'get-pr'],
  description: 'Get a pull request by ID',
  toolDescription: 'Returns one pull request by id: title, description, status, refs, reviewers and votes, merge commits.',
  input: z.object({ id: prId }),
  writes: false,
  context: IN_REPO,
  options: [idOption],
  examples: [{ ...inRepo, id: 42 }],
  run: (input, ctx) => getPR(ctx, input.id),
});

const TARGET = 'Target branch (default: main)';

export const repoCreatePrCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'create-pr'],
  description: 'Create a pull request',
  toolDescription:
    'Opens a pull request from a source branch to a target (main by default) and returns it. A branch name gets refs/heads/; a full ref (refs/...) is sent as given. reviewers are identity ids, comma-separated.',
  input: z.object({
    title: z.string().min(1).describe('PR title'),
    source: z.string().min(1).describe('Source branch'),
    target: z.string().min(1).optional().describe(TARGET),
    description: z.string().optional().describe('PR description (Markdown)'),
    reviewers: z.string().optional().describe('Comma-separated reviewer identity ids'),
    draft: z.boolean().optional().describe('Create as a draft pull request'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    { flags: '--title <title>', field: 'title', description: 'PR title' },
    { flags: '--source <branch>', field: 'source', description: 'Source branch' },
    { flags: '--target <branch>', field: 'target', description: TARGET },
    { flags: '--description <text>', field: 'description', description: 'PR description (Markdown)' },
    { flags: '--reviewers <ids>', field: 'reviewers', description: 'Comma-separated reviewer identity ids' },
    { flags: '--draft', field: 'draft', description: 'Create as a draft pull request' },
  ],
  examples: [
    { ...W, title: 'Add retries', source: 'feature/retries' },
    { ...W, title: 'Tidy up', source: 'refs/heads/tidy', target: 'develop', description: 'Small things', reviewers: 'abc12345-0000-0000-0000-000000000000, abc12345-0000-0000-0000-000000000001', draft: true },
  ],
  run: (input, ctx) => {
    const reviewers = (input.reviewers ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
    const body = {
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      sourceRefName: ref(input.source),
      targetRefName: ref(input.target ?? 'main'),
      ...(reviewers.length > 0 ? { reviewers } : {}),
      ...(input.draft !== undefined ? { isDraft: input.draft } : {}),
    };
    return adoc(ctx, `${repoPath(ctx)}/pullrequests`, { method: 'POST', json: body });
  },
});

export const repoUpdatePrCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'update-pr'],
  description: 'Update a pull request',
  toolDescription: "Changes a pull request's title, description, target branch or draft state in one PATCH and returns it. Reviewers aren't changed this way; the vote commands set the token's own vote.",
  input: z.object({
    id: prId,
    title: z.string().min(1).optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    target: z.string().min(1).optional().describe('New target branch'),
    draft: z.boolean().optional().describe('Set draft status: true|false'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    idOption,
    { flags: '--title <title>', field: 'title', description: 'New title' },
    { flags: '--description <text>', field: 'description', description: 'New description' },
    { flags: '--target <branch>', field: 'target', description: 'New target branch' },
    { flags: '--draft <bool>', field: 'draft', description: 'Set draft status: true|false' },
  ],
  examples: [
    { ...W, id: 42, title: 'Add retries, properly' },
    { ...W, id: 42, description: '', target: 'release/1.2', draft: false },
  ],
  run: (input, ctx) => {
    const body = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.target !== undefined ? { targetRefName: ref(input.target) } : {}),
      ...(input.draft !== undefined ? { isDraft: input.draft } : {}),
    };
    return adoc(ctx, prPath(ctx, input.id), { method: 'PATCH', json: body });
  },
});

const STRATEGIES = ['noFastForward', 'squash', 'rebase', 'rebaseMerge'] as const;
const STRATEGY = 'Merge strategy: noFastForward|squash|rebase|rebaseMerge (default: noFastForward)';

export const repoMergePrCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'merge-pr'],
  description: 'Complete (merge) a pull request',
  toolDescription:
    'Asks the server to complete a pull request with a merge strategy (noFastForward by default), optionally deleting the source branch, and returns the pull request. It reads the pull request first, to send the source commit the completion is for. Completion is asynchronous: check data.status and data.mergeStatus, which stay active and queued while policies or conflicts hold it.',
  input: z.object({
    id: prId,
    strategy: z.enum(STRATEGIES).optional().describe(STRATEGY),
    deleteSource: z.boolean().optional().describe('Delete source branch after merge'),
    message: z.string().optional().describe('Merge commit message'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    idOption,
    { flags: '--strategy <s>', field: 'strategy', description: STRATEGY },
    { flags: '--delete-source', field: 'deleteSource', description: 'Delete source branch after merge' },
    { flags: '--message <text>', field: 'message', description: 'Merge commit message' },
  ],
  examples: [
    { ...W, id: 42 },
    { ...W, id: 42, strategy: 'squash', deleteSource: true, message: 'Add retries (#42)' },
  ],
  run: async (input, ctx) => {
    const pr = await getPR(ctx, input.id);
    const body = {
      status: 'completed',
      lastMergeSourceCommit: { commitId: pr.lastMergeSourceCommit?.commitId ?? '' },
      completionOptions: { mergeStrategy: input.strategy ?? 'noFastForward', deleteSourceBranch: input.deleteSource ?? false, ...(input.message !== undefined ? { mergeCommitMessage: input.message } : {}) },
    };
    return adoc(ctx, prPath(ctx, input.id), { method: 'PATCH', json: body });
  },
});

export const repoAbandonPrCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'abandon-pr'],
  description: 'Abandon a pull request',
  toolDescription: 'Abandons a pull request and returns it.',
  input: z.object({ id: prId, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [idOption],
  examples: [{ ...W, id: 42 }],
  run: (input, ctx) => adoc(ctx, prPath(ctx, input.id), { method: 'PATCH', json: { status: 'abandoned' } }),
});

/** A vote cast as the token's own identity, read from connectionData first. */
function voteCommand(name: 'approve' | 'unapprove' | 'wait-for-author', description: string, vote: number, toolDescription: string) {
  return adoCloudArea.command({
    path: ['ado-cloud', 'repo', name],
    description,
    toolDescription,
    input: z.object({ pr: prId, ...allowWriteField }),
    writes: true,
    context: IN_REPO,
    options: [prOption],
    examples: [{ ...W, pr: 42 }],
    run: async (input, ctx) => {
      const me = await connectionData(ctx);
      return adoc(ctx, `${prPath(ctx, input.pr)}/reviewers/${enc(me.authenticatedUser.id)}`, { method: 'PUT', json: { vote } });
    },
  });
}

export const repoApproveCommand = voteCommand('approve', 'Approve a pull request', 10, "Votes 10 (approve) on a pull request as the token's own user, and returns the reviewer entry.");
export const repoUnapproveCommand = voteCommand('unapprove', 'Remove your vote from a pull request', 0, "Resets the token's own vote on a pull request to 0 (no vote), and returns the reviewer entry.");
export const repoWaitForAuthorCommand = voteCommand('wait-for-author', 'Mark a pull request as waiting for author', -5, "Votes -5 (waiting for author) on a pull request as the token's own user, and returns the reviewer entry.");

export const repoListReviewersCommand = adoCloudArea.command({
  path: ['ado-cloud', 'repo', 'list-reviewers'],
  description: 'List reviewers on a pull request',
  toolDescription: 'Lists the reviewers on a pull request with their votes (10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected).',
  input: z.object({ pr: prId }),
  writes: false,
  context: IN_REPO,
  options: [prOption],
  examples: [{ ...inRepo, pr: 42 }],
  run: async (input, ctx) => (await adoc<{ value?: unknown[] }>(ctx, `${prPath(ctx, input.pr)}/reviewers`)).value ?? [],
});

export const pullRequestCommands = [
  repoListPrsCommand,
  repoGetPrCommand,
  repoCreatePrCommand,
  repoUpdatePrCommand,
  repoMergePrCommand,
  repoAbandonPrCommand,
  repoListReviewersCommand,
  repoApproveCommand,
  repoUnapproveCommand,
  repoWaitForAuthorCommand,
];
