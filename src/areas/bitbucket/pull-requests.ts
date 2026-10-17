import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { bitbucketArea } from './area.js';
import { API, IN_REPO, bb, bbAll, commaList, createPR, getPR, prPath, projectOf, repoPath, toInt, where, type BitbucketContext, type BitbucketPR } from './client.js';

/**
 * Repositories and pull requests: create a repository, then list, read,
 * create, update, merge and decline pull requests. Every change to a pull
 * request reads it first for its `version`, Bitbucket's optimistic lock, which
 * is a sign-off sheet that at least checks whether anyone else signed first.
 */

/** A number the predecessor read with parseInt: text stays text until then. */
const intText = z.union([z.number(), z.string()]);
const idInput = intText.describe('Pull request ID');
const idOption = { flags: '--id <pr-id>', field: 'id', description: 'Pull request ID' };

/** An ISO 8601 date flag, read with `new Date()` as the predecessor read it. Suspected bug (#76 item 17): a date-time without a zone is local time. */
function parseDate(flag: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ToilError('INVALID_INPUT', `Invalid ${flag} value "${value}". Use an ISO 8601 date such as 2025-01-31 or 2025-01-31T09:00:00Z.`, {
      fix: `Pass ${flag} as an ISO 8601 date, e.g. 2025-01-31 or 2025-01-31T09:00:00Z.`,
    });
  }
  return date;
}

export const createRepoCommand = bitbucketArea.command({
  path: ['bitbucket', 'create-repo'],
  description: 'Create a new repository in a project',
  toolDescription: 'Creates a git repository in a Bitbucket project and returns it as Bitbucket stores it. Needs only the project, not a repo.',
  input: z.object({
    name: z.string().describe('Repository name (slug)'),
    description: z.string().optional().describe('Repository description'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--name <name>', field: 'name', description: 'Repository name (slug)' },
    { flags: '--description <desc>', field: 'description', description: 'Repository description' },
  ],
  examples: [
    { project: 'PROJ', repo: 'ignored', name: 'imagile-new', description: 'A new service', allowWrite: true },
    { project: 'PROJ', name: 'imagile-bare', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const project = projectOf(ctx);
    return bb(ctx, `${API}/projects/${project}/repos`, {
      method: 'POST',
      json: { name: input.name, scmId: 'git', ...(input.description !== undefined ? { description: input.description } : {}) },
    });
  },
});

export const listPrsCommand = bitbucketArea.command({
  path: ['bitbucket', 'list-prs'],
  description: 'List pull requests',
  toolDescription:
    'Lists every pull request in a repository in one state (OPEN by default), optionally by author or reviewer username, and by creation date (filtered after fetching every page).',
  input: z.object({
    state: z.string().optional().describe('PR state: OPEN|MERGED|DECLINED|ALL (default: "OPEN")'),
    author: z.string().optional().describe('Filter by author username'),
    reviewer: z.string().optional().describe('Filter by reviewer username'),
    createdAfter: z.string().optional().describe('Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)'),
    createdBefore: z.string().optional().describe('Only PRs created before this ISO 8601 date'),
  }),
  writes: false,
  context: IN_REPO,
  options: [
    { flags: '--state <state>', field: 'state', description: 'PR state: OPEN|MERGED|DECLINED|ALL (default: "OPEN")' },
    { flags: '--author <username>', field: 'author', description: 'Filter by author username' },
    { flags: '--reviewer <username>', field: 'reviewer', description: 'Filter by reviewer username' },
    { flags: '--created-after <date>', field: 'createdAfter', description: 'Only PRs created on/after this ISO 8601 date (e.g. 2025-01-31)' },
    { flags: '--created-before <date>', field: 'createdBefore', description: 'Only PRs created before this ISO 8601 date' },
  ],
  examples: [
    { project: 'PROJ', repo: 'imagile-api' },
    { project: 'PROJ', repo: 'imagile-api', state: 'ALL', author: 'jdoe', reviewer: 'asmith', createdAfter: '2026-09-01', createdBefore: '2026-10-01' },
  ],
  run: async (input, ctx) => {
    const createdAfter = input.createdAfter ? parseDate('--created-after', input.createdAfter) : undefined;
    const createdBefore = input.createdBefore ? parseDate('--created-before', input.createdBefore) : undefined;
    const { project, repo } = where(ctx);
    return listPRs(ctx, project, repo, { state: input.state, author: input.author, reviewer: input.reviewer, createdAfter, createdBefore });
  },
});

export interface ListPRs {
  state?: string | undefined;
  author?: string | undefined;
  reviewer?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

/** Every page of a repository's pull requests; dates are filtered here, since Bitbucket has no date filter. */
export async function listPRs(ctx: BitbucketContext, project: string, repo: string, opts: ListPRs): Promise<BitbucketPR[]> {
  // Users are filtered with indexed username.N / role.N pairs, not repeated keys.
  const users: Record<string, string> = {};
  let n = 1;
  if (opts.author) {
    users[`username.${n}`] = opts.author;
    users[`role.${n}`] = 'AUTHOR';
    n++;
  }
  if (opts.reviewer) {
    users[`username.${n}`] = opts.reviewer;
    users[`role.${n}`] = 'REVIEWER';
  }
  const prs = await bbAll<BitbucketPR>(ctx, `${repoPath(project, repo)}/pull-requests`, { state: opts.state ?? 'OPEN', ...users }, `Bitbucket pull requests in ${project}/${repo}`);
  const { createdAfter: after, createdBefore: before } = opts;
  if (!after && !before) return prs;
  return prs.filter((pr) => !(after && pr.createdDate < after.getTime()) && !(before && pr.createdDate >= before.getTime()));
}

export const getPrCommand = bitbucketArea.command({
  path: ['bitbucket', 'get-pr'],
  description: 'Get a pull request by ID',
  toolDescription: 'Returns one pull request by ID: title, description, state, author, reviewers and their status, source and target refs, and version.',
  input: z.object({ id: idInput }),
  writes: false,
  context: IN_REPO,
  options: [idOption],
  examples: [{ project: 'PROJ', repo: 'imagile-api', id: '42' }],
  run: async (input, ctx) => {
    const { project, repo } = where(ctx);
    return getPR(ctx, project, repo, toInt(input.id));
  },
});

export const createPrCommand = bitbucketArea.command({
  path: ['bitbucket', 'create-pr'],
  description: 'Create a pull request',
  toolDescription:
    "Opens a pull request from source to target (the connection's targetBranch, then main) and returns it. Without reviewers, Bitbucket's default-reviewer conditions apply. For a personal repository, the project is ~username.",
  input: z.object({
    title: z.string().describe('PR title'),
    source: z.string().describe('Source branch'),
    target: z.string().optional().describe('Target branch (defaults to config)'),
    description: z.string().optional().describe('PR description'),
    reviewers: z.string().optional().describe('Comma-separated reviewer usernames'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    { flags: '--title <title>', field: 'title', description: 'PR title' },
    { flags: '--source <branch>', field: 'source', description: 'Source branch' },
    { flags: '--target <branch>', field: 'target', description: 'Target branch (defaults to config)' },
    { flags: '--description <desc>', field: 'description', description: 'PR description' },
    { flags: '--reviewers <users>', field: 'reviewers', description: 'Comma-separated reviewer usernames' },
  ],
  examples: [
    { project: 'PROJ', repo: 'imagile-api', title: 'Add retries', source: 'feature/retries', allowWrite: true },
    { project: '~jdoe', repo: 'scratch', title: 'Tidy up', source: 'tidy', target: 'develop', description: 'Small things', reviewers: 'asmith, bkhan', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { project, repo } = where(ctx);
    const target = input.target ?? ctx.connection.targetBranch ?? 'main';
    const reviewers = input.reviewers ? commaList(input.reviewers) : undefined;
    return createPR(ctx, { project, repo, title: input.title, source: input.source, target, description: input.description, reviewers });
  },
});

type RepoResult = { repo: string; status: 'created'; pr: BitbucketPR } | { repo: string; status: 'nothing_to_promote' } | { repo: string; status: 'error'; error: string };

export const createPrsCommand = bitbucketArea.command({
  path: ['bitbucket', 'create-prs'],
  description: 'Create pull requests for multiple repositories in a project',
  toolDescription:
    'Opens a pull request from one branch to another in each listed repository of a project, one repository at a time, skipping any with nothing to promote. Never fails as a whole: each repository reports created, nothing_to_promote or error, with counts in summary, and a BITBUCKET_ALL_FAILED warning when every repository failed.',
  input: z.object({
    from: z.string().describe('Source branch'),
    to: z.string().describe('Target branch'),
    repos: z.string().describe('Comma-separated repository slugs'),
    title: z.string().optional().describe('PR title (defaults to "Promote <from> to <to>")'),
    description: z.string().optional().describe('PR description'),
    reviewers: z.string().optional().describe('Comma-separated reviewer usernames'),
    ...allowWriteField,
  }),
  writes: true,
  // One repository at a time, each recorded whatever happens to it: a batch
  // across many repositories gets half an hour, not the default two minutes.
  timeLimitMs: 30 * 60_000,
  options: [
    { flags: '--from <branch>', field: 'from', description: 'Source branch' },
    { flags: '--to <branch>', field: 'to', description: 'Target branch' },
    { flags: '--repos <slugs>', field: 'repos', description: 'Comma-separated repository slugs' },
    { flags: '--title <title>', field: 'title', description: 'PR title (defaults to "Promote <from> to <to>")' },
    { flags: '--description <desc>', field: 'description', description: 'PR description' },
    { flags: '--reviewers <users>', field: 'reviewers', description: 'Comma-separated reviewer usernames' },
  ],
  examples: [
    { project: 'PROJ', from: 'develop', to: 'main', repos: 'imagile-api, imagile-web,,imagile-gone', allowWrite: true },
    { project: 'PROJ', repo: 'ignored', from: 'develop', to: 'release', repos: 'imagile-api', title: 'Release 2026.10', description: 'Monthly promotion', reviewers: 'asmith', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const project = projectOf(ctx);
    const repos = input.repos
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (repos.length === 0) {
      throw new ToilError('INVALID_INPUT', '--repos must contain at least one repository slug', { fix: 'Pass --repos as a comma-separated list of repository slugs, e.g. --repos api,web.' });
    }
    const title = input.title ?? `Promote ${input.from} to ${input.to}`;
    const reviewers = input.reviewers ? commaList(input.reviewers) : undefined;

    const results: RepoResult[] = [];
    let created = 0;
    let nothingToPromote = 0;
    let errors = 0;
    // One repository at a time, and one failure never stops the rest. Suspected
    // bug (#76 item 15): the command succeeds even when every repository failed.
    for (const repo of repos) {
      try {
        // Commits on `from` that `to` doesn't have; none means nothing to promote.
        const ahead = await bb<{ values?: unknown[] }>(ctx, `${repoPath(project, repo)}/commits`, { query: { until: input.from, since: input.to, limit: 1 } });
        if ((ahead.values?.length ?? 0) === 0) {
          results.push({ repo, status: 'nothing_to_promote' });
          nothingToPromote++;
          continue;
        }
        const pr = await createPR(ctx, { project, repo, title, source: input.from, target: input.to, description: input.description, reviewers });
        results.push({ repo, status: 'created', pr });
        created++;
      } catch (err) {
        results.push({ repo, status: 'error', error: err instanceof Error ? err.message : String(err) });
        errors++;
      }
    }
    if (errors === repos.length) {
      // Additive only: the envelope stays the success it always was.
      ctx.warn({ code: 'BITBUCKET_ALL_FAILED', message: `No pull request was created: all ${errors} repositories failed. See each one's error in results.` });
    }
    return { results, summary: { created, nothing_to_promote: nothingToPromote, error: errors } };
  },
});

export const updatePrCommand = bitbucketArea.command({
  path: ['bitbucket', 'update-pr'],
  description: 'Update a pull request',
  toolDescription:
    "Changes a pull request's title, description or reviewers and returns it. Reads the PR first and resends the current values for anything not given, since Bitbucket clears what a PUT leaves out. reviewers replaces the whole list.",
  input: z.object({
    id: idInput,
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    reviewers: z.string().optional().describe('Comma-separated reviewer usernames'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    idOption,
    { flags: '--title <title>', field: 'title', description: 'New title' },
    { flags: '--description <desc>', field: 'description', description: 'New description' },
    { flags: '--reviewers <users>', field: 'reviewers', description: 'Comma-separated reviewer usernames' },
  ],
  examples: [
    { project: 'PROJ', repo: 'imagile-api', id: '42', title: 'Add retries, with backoff', allowWrite: true },
    { project: 'PROJ', repo: 'imagile-api', id: '42', description: '', reviewers: 'asmith,bkhan', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { project, repo } = where(ctx);
    const id = toInt(input.id);
    const pr = await getPR(ctx, project, repo, id);
    // A PUT without reviewers is an empty list, which wipes reviewers and
    // their approvals, and a missing description clears it: resend both.
    const reviewers = input.reviewers ? commaList(input.reviewers) : (pr.reviewers ?? []).map((r) => r.user.name);
    const title = input.title ?? pr.title;
    const description = input.description ?? pr.description;
    const body: Record<string, unknown> = { version: pr.version };
    if (title) body.title = title;
    if (description !== undefined) body.description = description;
    body.reviewers = reviewers.map((name) => ({ user: { name } }));
    return bb(ctx, prPath(project, repo, id), { method: 'PUT', json: body });
  },
});

export const mergePrCommand = bitbucketArea.command({
  path: ['bitbucket', 'merge-pr'],
  description: 'Merge a pull request',
  toolDescription:
    "Merges a pull request at its current version and returns it. strategy is sent to Bitbucket as its merge strategy id (squash and ff are Bitbucket ids). deleteBranch does not delete the source branch; it sets Bitbucket's autoSubject, and a BITBUCKET_BRANCH_NOT_DELETED warning says so.",
  input: z.object({
    id: idInput,
    strategy: z.string().optional().describe('Merge strategy: merge|squash|ff'),
    deleteBranch: z.boolean().optional().describe('Delete source branch after merge'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [idOption, { flags: '--strategy <strategy>', field: 'strategy', description: 'Merge strategy: merge|squash|ff' }, { flags: '--delete-branch', field: 'deleteBranch', description: 'Delete source branch after merge' }],
  examples: [
    { project: 'PROJ', repo: 'imagile-api', id: '42', allowWrite: true },
    { project: 'PROJ', repo: 'imagile-api', id: '42', strategy: 'squash', deleteBranch: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { project, repo } = where(ctx);
    const id = toInt(input.id);
    const pr = await getPR(ctx, project, repo, id);
    const body: Record<string, unknown> = {};
    // Suspected bugs (#76 items 2 and 1): the strategy goes out verbatim, so
    // `merge` isn't a Bitbucket id, and --delete-branch sets autoSubject,
    // which governs the commit message and deletes nothing.
    if (input.strategy) body.strategyId = input.strategy;
    if (input.deleteBranch) body.autoSubject = true;
    const merged = await bb(ctx, `${prPath(project, repo, id)}/merge`, { method: 'POST', query: { version: pr.version }, json: body });
    if (input.deleteBranch) {
      ctx.warn({ code: 'BITBUCKET_BRANCH_NOT_DELETED', message: `--delete-branch didn't delete the source branch: it set Bitbucket's autoSubject. Delete ${pr.fromRef?.displayId ?? 'the source branch'} yourself if it should go.` });
    }
    return merged;
  },
});

export const declinePrCommand = bitbucketArea.command({
  path: ['bitbucket', 'decline-pr'],
  description: 'Decline a pull request',
  toolDescription: 'Declines an open pull request at its current version and returns it.',
  input: z.object({ id: idInput, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [idOption],
  examples: [{ project: 'PROJ', repo: 'imagile-api', id: '42', allowWrite: true }],
  run: async (input, ctx) => {
    const { project, repo } = where(ctx);
    const id = toInt(input.id);
    const pr = await getPR(ctx, project, repo, id);
    return bb(ctx, `${prPath(project, repo, id)}/decline`, { method: 'POST', query: { version: pr.version } });
  },
});

export const pullRequestCommands = [createRepoCommand, listPrsCommand, getPrCommand, createPrCommand, createPrsCommand, updatePrCommand, mergePrCommand, declinePrCommand];
