import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { adoArea } from './area.js';
import { API, ado, adoAll, adoSkipPages, adoValue, enc, projectPath, repoPath, toInt, where, type AdoContext, type Where } from './client.js';
import { connectionData } from './server.js';
import { AT, intText } from './work.js';

/**
 * Repositories and pull requests: list, read and create repositories, and
 * list, read, create, update, complete and abandon pull requests, with their
 * reviewers, votes, statuses and builds. Completing a pull request is a
 * request to complete it; the server decides later, as approvals do.
 */

export const IN_REPO = AT;
const W = { ...IN_REPO, allowWrite: true };
const prInput = intText.describe('Pull request ID');
const idOption = { flags: '--id <n>', field: 'id', description: 'Pull request ID' };
const prOption = { flags: '--pr <n>', field: 'pr', description: 'Pull request ID' };

/** Well-known policy type id of "Required reviewers". */
const REQUIRED_REVIEWERS_POLICY_TYPE = 'fd2167ab-b0be-447a-8ec8-39368250530e';

export interface PullRequest {
  pullRequestId: number;
  sourceRefName: string;
  reviewers: unknown[];
  lastMergeSourceCommit?: { commitId?: string };
  lastMergeTargetCommit?: { commitId?: string };
  [key: string]: unknown;
}

export const prUrl = (w: Where, id: number) => `${repoPath(w)}/pullrequests/${id}?api-version=${API}`;

export function getPR(ctx: AdoContext, w: Where, id: number): Promise<PullRequest> {
  return ado<PullRequest>(ctx, prUrl(w, id));
}

/** Builds in the project, all of them through continuation tokens, or one request when `top` is set. */
export async function listBuilds(ctx: AdoContext, w: Where, opts: { definitionIds?: number[] | undefined; branchName?: string | undefined; statusFilter?: string | undefined; top?: number | undefined }): Promise<unknown[]> {
  const query: Record<string, string | number> = {
    'api-version': API,
    ...(opts.definitionIds?.length ? { definitions: opts.definitionIds.join(',') } : {}),
    ...(opts.branchName ? { branchName: opts.branchName } : {}),
    ...(opts.statusFilter ? { statusFilter: opts.statusFilter } : {}),
    ...(opts.top ? { $top: opts.top } : {}),
  };
  const path = `${projectPath(w)}/_apis/build/builds`;
  if (opts.top) {
    return (await adoValue(ctx, path, query)).slice(0, opts.top);
  }
  return adoAll(ctx, path, query, `Azure DevOps builds in ${w.project}`);
}

/** An ISO 8601 date flag, read with `new Date()`. Suspected bug (#69 item 26): a date-time without a zone is local time. */
function parseDate(flag: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ToilError('INVALID_INPUT', `Invalid ${flag} value "${value}". Use an ISO 8601 date such as 2025-01-31 or 2025-01-31T09:00:00Z.`, { fix: `Pass ${flag} as an ISO 8601 date, e.g. 2025-01-31 or 2025-01-31T09:00:00Z.` });
  }
  return date;
}

export const repoListCommand = adoArea.command({
  path: ['ado', 'repo', 'list'],
  description: 'List git repositories in the project',
  toolDescription: 'Lists the git repositories in the project (id, name, default branch, urls). Needs no repo.',
  input: z.object({}),
  writes: false,
  examples: [AT],
  run: async (_input, ctx) => {
    const result = await ado<{ value?: unknown[] }>(ctx, `${projectPath(where(ctx))}/_apis/git/repositories?api-version=${API}`);
    return result.value ?? [];
  },
});

export const repoCreateCommand = adoArea.command({
  path: ['ado', 'repo', 'create'],
  description: 'Create a new git repository in the project',
  toolDescription: 'Creates an empty git repository in the project and returns it. Needs no repo.',
  input: z.object({ name: z.string().describe('Repository name'), ...allowWriteField }),
  writes: true,
  options: [{ flags: '--name <name>', field: 'name', description: 'Repository name' }],
  examples: [{ ...AT, name: 'imagile-new', allowWrite: true }],
  run: async (input, ctx) => ado(ctx, `${projectPath(where(ctx))}/_apis/git/repositories?api-version=${API}`, { method: 'POST', json: { name: input.name } }),
});

export const repoGetCommand = adoArea.command({
  path: ['ado', 'repo', 'get'],
  description: 'Get a specific repository',
  toolDescription: 'Returns the repository (id, name, default branch, project, urls).',
  input: z.object({}),
  writes: false,
  examples: [IN_REPO],
  run: async (_input, ctx) => ado(ctx, `${repoPath(where(ctx, true))}?api-version=${API}`),
});

const STATE = 'PR state: active|abandoned|completed|all (default: "active")';

export const repoListPrsCommand = adoArea.command({
  path: ['ado', 'repo', 'list-prs'],
  description: 'List pull requests',
  toolDescription:
    'Lists every pull request in the repository in one state (active by default), optionally by creator or reviewer identity id (a GUID, from ado_whoami), and by creation date.',
  input: z.object({
    state: z.string().optional().describe(STATE),
    creator: z.string().optional().describe('Filter by creator (sent as the identity id filter)'),
    reviewer: z.string().optional().describe('Filter by reviewer (sent as the identity id filter)'),
    createdAfter: z.string().optional().describe('Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)'),
    createdBefore: z.string().optional().describe('Only PRs created before this ISO 8601 date'),
  }),
  writes: false,
  options: [
    { flags: '--state <state>', field: 'state', description: STATE },
    { flags: '--creator <alias>', field: 'creator', description: 'Filter by creator' },
    { flags: '--reviewer <alias>', field: 'reviewer', description: 'Filter by reviewer' },
    { flags: '--created-after <date>', field: 'createdAfter', description: 'Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)' },
    { flags: '--created-before <date>', field: 'createdBefore', description: 'Only PRs created before this ISO 8601 date' },
  ],
  examples: [
    IN_REPO,
    { ...IN_REPO, state: 'all', creator: 'abc12345-0000-0000-0000-000000000000', reviewer: 'abc12345-0000-0000-0000-000000000001', createdAfter: '2026-09-01', createdBefore: '2026-10-01' },
  ],
  run: async (input, ctx) => {
    // Dates are checked before the context, as the predecessor checked them.
    const after = input.createdAfter ? parseDate('--created-after', input.createdAfter) : undefined;
    const before = input.createdBefore ? parseDate('--created-before', input.createdBefore) : undefined;
    const w = where(ctx, true);
    // Suspected bug (#69 item 6): an alias goes in as an identity GUID filter.
    const query: Record<string, string | number> = {
      'api-version': API,
      'searchCriteria.status': input.state ?? 'active',
      ...(input.creator ? { 'searchCriteria.creatorId': input.creator } : {}),
      ...(input.reviewer ? { 'searchCriteria.reviewerId': input.reviewer } : {}),
      // minTime and maxTime only count alongside queryTimeRangeType.
      ...(after || before ? { 'searchCriteria.queryTimeRangeType': 'created' } : {}),
      ...(after ? { 'searchCriteria.minTime': after.toISOString() } : {}),
      ...(before ? { 'searchCriteria.maxTime': before.toISOString() } : {}),
    };
    return adoSkipPages(ctx, `${repoPath(w)}/pullrequests`, query, 100, `Azure DevOps pull requests in ${w.repo}`);
  },
});

export const repoGetPrCommand = adoArea.command({
  path: ['ado', 'repo', 'get-pr'],
  description: 'Get a pull request by ID',
  toolDescription: 'Returns one pull request by id: title, description, status, refs, reviewers and votes, merge commits.',
  input: z.object({ id: prInput }),
  writes: false,
  options: [idOption],
  examples: [{ ...IN_REPO, id: '42' }],
  run: async (input, ctx) => getPR(ctx, where(ctx, true), toInt(input.id)),
});

const TARGET = 'Target branch (default: main) (default: "main")';

export const repoCreatePrCommand = adoArea.command({
  path: ['ado', 'repo', 'create-pr'],
  description: 'Create a pull request',
  toolDescription:
    'Opens a pull request from a source branch to a target (main by default) and returns it. Give branch names without refs/heads/, which toil adds. Reviewers are identity ids, comma-separated.',
  input: z.object({
    title: z.string().describe('PR title'),
    source: z.string().describe('Source branch'),
    target: z.string().optional().describe(TARGET),
    description: z.string().optional().describe('PR description'),
    reviewers: z.string().optional().describe('Comma-separated reviewer IDs or display names'),
    draft: z.boolean().optional().describe('Create as a draft pull request'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--title <title>', field: 'title', description: 'PR title' },
    { flags: '--source <branch>', field: 'source', description: 'Source branch' },
    { flags: '--target <branch>', field: 'target', description: TARGET },
    { flags: '--description <text>', field: 'description', description: 'PR description' },
    { flags: '--reviewers <ids>', field: 'reviewers', description: 'Comma-separated reviewer IDs or display names' },
    { flags: '--draft', field: 'draft', description: 'Create as a draft pull request' },
  ],
  examples: [
    { ...W, title: 'Add retries', source: 'feature/retries' },
    { ...W, title: 'Tidy up', source: 'tidy', target: 'develop', description: 'Small things', reviewers: 'abc12345-0000-0000-0000-000000000000, abc12345-0000-0000-0000-000000000001', draft: true },
  ],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    // Suspected bugs (#69 items 7 and 8): a full ref is prefixed again, and a display name is sent as an id.
    const reviewers = input.reviewers ? input.reviewers.split(',').map((id) => ({ id: id.trim() })) : [];
    const body = {
      title: input.title,
      description: input.description,
      sourceRefName: `refs/heads/${input.source}`,
      targetRefName: `refs/heads/${input.target ?? 'main'}`,
      reviewers,
      ...(input.draft !== undefined ? { isDraft: input.draft } : {}),
    };
    return ado(ctx, `${repoPath(w)}/pullrequests?api-version=${API}`, { method: 'POST', json: body });
  },
});

export const repoUpdatePrCommand = adoArea.command({
  path: ['ado', 'repo', 'update-pr'],
  description: 'Update a pull request',
  toolDescription: 'Changes a pull request\'s title, description, reviewers or draft state in one PATCH and returns it. draft is the text "true" or anything else for false.',
  input: z.object({
    id: prInput,
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    reviewers: z.string().optional().describe('Comma-separated reviewer IDs'),
    draft: z.string().optional().describe('Set draft status: true|false'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    idOption,
    { flags: '--title <title>', field: 'title', description: 'New title' },
    { flags: '--description <text>', field: 'description', description: 'New description' },
    { flags: '--reviewers <ids>', field: 'reviewers', description: 'Comma-separated reviewer IDs' },
    { flags: '--draft <bool>', field: 'draft', description: 'Set draft status: true|false' },
  ],
  examples: [
    { ...W, id: '42', title: 'Add retries, properly' },
    { ...W, id: '42', description: '', reviewers: 'abc12345-0000-0000-0000-000000000000', draft: 'false' },
  ],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    const body: Record<string, unknown> = {};
    if (input.title) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    // Suspected bug (#69 item 9): reviewers aren't an updatable property of this endpoint.
    if (input.reviewers) body.reviewers = input.reviewers.split(',').map((id) => ({ id: id.trim() }));
    if (input.draft !== undefined) body.isDraft = input.draft === 'true';
    return ado(ctx, prUrl(w, toInt(input.id)), { method: 'PATCH', json: body });
  },
});

const STRATEGY = 'Merge strategy: noFastForward|squash|rebase|rebaseMerge (default: "noFastForward")';

export const repoMergePrCommand = adoArea.command({
  path: ['ado', 'repo', 'merge-pr'],
  description: 'Complete (merge) a pull request',
  toolDescription:
    "Asks the server to complete a pull request with a merge strategy (noFastForward by default), optionally deleting the source branch, and returns the pull request. Completion is asynchronous: check data.status, which stays active when policies or conflicts block it.",
  input: z.object({
    id: prInput,
    strategy: z.string().optional().describe(STRATEGY),
    deleteSource: z.boolean().optional().describe('Delete source branch after merge'),
    ...allowWriteField,
  }),
  writes: true,
  options: [idOption, { flags: '--strategy <s>', field: 'strategy', description: STRATEGY }, { flags: '--delete-source', field: 'deleteSource', description: 'Delete source branch after merge' }],
  examples: [
    { ...W, id: '42' },
    { ...W, id: '43', strategy: 'squash', deleteSource: true },
  ],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    const id = toInt(input.id);
    const pr = await getPR(ctx, w, id);
    // Suspected bug (#69 item 24): success whatever the server then does.
    const body = {
      status: 'completed',
      lastMergeSourceCommit: { commitId: pr.lastMergeSourceCommit?.commitId ?? '' },
      completionOptions: { mergeStrategy: input.strategy ?? 'noFastForward', deleteSourceBranch: input.deleteSource ?? false },
    };
    return ado(ctx, prUrl(w, id), { method: 'PATCH', json: body });
  },
});

export const repoAbandonPrCommand = adoArea.command({
  path: ['ado', 'repo', 'abandon-pr'],
  description: 'Abandon a pull request',
  toolDescription: 'Abandons a pull request and returns it.',
  input: z.object({ id: prInput, ...allowWriteField }),
  writes: true,
  options: [idOption],
  examples: [{ ...W, id: '42' }],
  run: async (input, ctx) => ado(ctx, prUrl(where(ctx, true), toInt(input.id)), { method: 'PATCH', json: { status: 'abandoned' } }),
});

export const repoListFilesCommand = adoArea.command({
  path: ['ado', 'repo', 'list-files'],
  description: 'List files changed in a pull request',
  toolDescription: "Lists the files changed in a pull request's latest iteration (path, change type), as the server's first page of changes (100).",
  input: z.object({ pr: prInput }),
  writes: false,
  options: [prOption],
  examples: [{ ...IN_REPO, pr: '42' }],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    const pr = toInt(input.pr);
    const iterations = await ado<{ value?: Array<{ id: number }> }>(ctx, `${repoPath(w)}/pullrequests/${pr}/iterations?api-version=${API}`);
    const latest = (iterations.value ?? []).at(-1)?.id;
    if (!latest) return [];
    // Suspected bug (#69 item 14): one page of at most 100 changes.
    const changes = await ado<{ changeEntries?: unknown[] }>(ctx, `${repoPath(w)}/pullrequests/${pr}/iterations/${latest}/changes?api-version=${API}`);
    return changes.changeEntries ?? [];
  },
});

export const repoDiffCommand = adoArea.command({
  path: ['ado', 'repo', 'diff'],
  description: 'Show files changed in a pull request with change types and commit metadata',
  toolDescription:
    "Diffs a pull request's last merge target commit against its last merge source commit: the changed files with change types, and ahead/behind counts. path keeps only that file (a leading / is added). At most the server's first 100 changes.",
  input: z.object({ pr: prInput, path: z.string().optional().describe('Filter diff to a specific file path') }),
  writes: false,
  options: [prOption, { flags: '--path <p>', field: 'path', description: 'Filter diff to a specific file path' }],
  examples: [
    { ...IN_REPO, pr: '42' },
    { ...IN_REPO, pr: '42', path: 'src/app.ts' },
  ],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    const pr = await getPR(ctx, w, toInt(input.pr));
    const source = pr.lastMergeSourceCommit?.commitId;
    const target = pr.lastMergeTargetCommit?.commitId;
    // Suspected bug (#69 item 13): tip against tip, one page.
    const data: { changes?: Array<{ item: { path: string } }>; [key: string]: unknown } =
      !source || !target
        ? { changes: [], aheadCount: 0, behindCount: 0 }
        : await ado(ctx, `${repoPath(w)}/diffs/commits?baseVersion=${enc(target)}&baseVersionType=commit&targetVersion=${enc(source)}&targetVersionType=commit&api-version=${API}`);
    if (input.path) {
      const needle = input.path.startsWith('/') ? input.path : `/${input.path}`;
      data.changes = (data.changes ?? []).filter((c) => c.item.path === needle);
    }
    return data;
  },
});

export const repoGetBuildStatusCommand = adoArea.command({
  path: ['ado', 'repo', 'get-build-status'],
  description: 'Get CI/build statuses posted to a commit',
  toolDescription: 'Lists the statuses CI posted to a commit in the repository (state, context, description, target url).',
  input: z.object({ commit: z.string().describe('Commit SHA') }),
  writes: false,
  options: [{ flags: '--commit <sha>', field: 'commit', description: 'Commit SHA' }],
  examples: [{ ...IN_REPO, commit: 'abc12345def67890abc12345def67890abc12345' }],
  run: async (input, ctx) => {
    const result = await ado<{ value?: unknown[] }>(ctx, `${repoPath(where(ctx, true))}/commits/${enc(input.commit)}/statuses?api-version=${API}`);
    return result.value ?? [];
  },
});

export const repoListReviewersCommand = adoArea.command({
  path: ['ado', 'repo', 'list-reviewers'],
  description: 'List reviewers on a pull request',
  toolDescription: 'Lists the reviewers on a pull request with their votes (10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected).',
  input: z.object({ pr: prInput }),
  writes: false,
  options: [prOption],
  examples: [{ ...IN_REPO, pr: '42' }],
  run: async (input, ctx) => (await getPR(ctx, where(ctx, true), toInt(input.pr))).reviewers,
});

export const repoListDefaultReviewersCommand = adoArea.command({
  path: ['ado', 'repo', 'list-default-reviewers'],
  description: 'List required-reviewer branch policies (default reviewers) that apply to the repository',
  toolDescription: "Lists the project's Required reviewers policy configurations whose scope covers the repository (or the whole project), from the server's first page of policies, disabled ones included.",
  input: z.object({}),
  writes: false,
  examples: [IN_REPO],
  run: async (_input, ctx) => {
    const w = where(ctx, true);
    const repo = await ado<{ id: string }>(ctx, `${repoPath(w)}?api-version=${API}`);
    // Suspected bug (#69 item 21): one page, disabled policies included.
    const result = await ado<{ value?: Array<{ type?: { id?: string }; settings?: { scope?: Array<{ repositoryId?: string | null }> } }> }>(ctx, `${projectPath(w)}/_apis/policy/configurations?api-version=${API}`);
    return (result.value ?? []).filter((c) => c.type?.id === REQUIRED_REVIEWERS_POLICY_TYPE && (c.settings?.scope ?? []).some((s) => !s.repositoryId || s.repositoryId === repo.id));
  },
});

/** A vote cast as the token's own identity, read from connectionData first. */
function voteCommand(name: 'approve' | 'unapprove' | 'wait-for-author', description: string, vote: number, toolDescription: string) {
  return adoArea.command({
    path: ['ado', 'repo', name],
    description,
    toolDescription,
    input: z.object({ pr: prInput, ...allowWriteField }),
    writes: true,
    options: [prOption],
    examples: [{ ...W, pr: '42' }],
    run: async (input, ctx) => {
      const w = where(ctx, true);
      const me = await connectionData(ctx, w.collection);
      return ado(ctx, `${repoPath(w)}/pullrequests/${toInt(input.pr)}/reviewers/${enc(me.authenticatedUser.id)}?api-version=${API}`, { method: 'PUT', json: { vote } });
    },
  });
}

export const repoApproveCommand = voteCommand('approve', 'Approve a pull request', 10, 'Votes 10 (approve) on a pull request as the token\'s own user, and returns the reviewer entry.');
export const repoUnapproveCommand = voteCommand('unapprove', 'Remove approval from a pull request', 0, "Resets the token's own vote on a pull request to 0 (no vote), and returns the reviewer entry.");
export const repoWaitForAuthorCommand = voteCommand('wait-for-author', 'Mark a pull request as waiting for author', -5, "Votes -5 (waiting for author) on a pull request as the token's own user, and returns the reviewer entry.");

export const repoListBuildsCommand = adoArea.command({
  path: ['ado', 'repo', 'list-builds'],
  description: 'List builds associated with a pull request',
  toolDescription: "Lists every build of the pull request's source branch (refs/heads/<source>), following continuation tokens. Builds of the PR merge ref (refs/pull/<id>/merge) aren't included.",
  input: z.object({ pr: prInput }),
  writes: false,
  options: [prOption],
  examples: [{ ...IN_REPO, pr: '42' }],
  run: async (input, ctx) => {
    const w = where(ctx, true);
    const pr = await getPR(ctx, w, toInt(input.pr));
    // Suspected bug (#69 items 11 and 27): PR validation builds run on the merge ref and are missed.
    return listBuilds(ctx, w, { branchName: pr.sourceRefName });
  },
});

export const repoCommands = [
  repoListCommand,
  repoCreateCommand,
  repoGetCommand,
  repoListPrsCommand,
  repoGetPrCommand,
  repoCreatePrCommand,
  repoUpdatePrCommand,
  repoMergePrCommand,
  repoAbandonPrCommand,
  repoListFilesCommand,
  repoDiffCommand,
  repoGetBuildStatusCommand,
  repoListReviewersCommand,
  repoListDefaultReviewersCommand,
  repoApproveCommand,
  repoUnapproveCommand,
  repoWaitForAuthorCommand,
  repoListBuildsCommand,
];
