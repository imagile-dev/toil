import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { githubArea } from './area.js';
import { exampleCursor, github, githubGraphql, githubList, target, type GitHubContext } from './client.js';
import { pageFields, pageOptions, parseIntText, prNumber, prNumberArg } from './input.js';
import { repeatedFlag } from '../../core/schema.js';

/**
 * Reviews, requested reviewers and review threads. Approving and requesting
 * changes are both a POSTed review with a different `event`; threads come
 * from GraphQL, since REST has no thread ids to resolve. A review is the one
 * sign-off here that someone has, in principle, read.
 */

export const listReviewsCommand = githubArea.command({
  path: ['github', 'pr', 'reviews'],
  description: 'List reviews on a pull request',
  input: z.object({ number: prNumber, ...pageFields('reviews') }),
  writes: false,
  args: [prNumberArg],
  options: [...pageOptions('reviews')],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7' },
    { owner: 'imagile', repo: 'toil-probe', number: '7', limit: 1, cursor: exampleCursor() },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const number = parseIntText(input.number);
    return githubList(ctx, `/repos/${owner}/${repo}/pulls/${number}/reviews`, `reviews on GitHub PR #${number}`, {}, { limit: input.limit, cursor: input.cursor });
  },
});

function submitReview(ctx: GitHubContext, number: number | string, event: 'APPROVE' | 'REQUEST_CHANGES', body: string | undefined) {
  const { owner, repo } = target(ctx);
  return github(ctx, `/repos/${owner}/${repo}/pulls/${parseIntText(number)}/reviews`, { method: 'POST', json: { event, ...(body !== undefined ? { body } : {}) } });
}

export const approveCommand = githubArea.command({
  path: ['github', 'pr', 'approve'],
  description: 'Approve a pull request',
  input: z.object({ number: prNumber, body: z.string().optional().describe('Review body text'), ...allowWriteField }),
  writes: true,
  args: [prNumberArg],
  options: [{ flags: '--body <text>', field: 'body', description: 'Review body text' }],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', number: '7', body: 'Ship it.', allowWrite: true },
  ],
  run: async (input, ctx) => submitReview(ctx, input.number, 'APPROVE', input.body),
});

export const requestChangesCommand = githubArea.command({
  path: ['github', 'pr', 'request-changes'],
  description: 'Request changes on a pull request',
  input: z.object({ number: prNumber, body: z.string().describe('Review feedback text'), ...allowWriteField }),
  writes: true,
  args: [prNumberArg],
  options: [{ flags: '--body <text>', field: 'body', description: 'Review feedback text' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', body: 'Please add a test.', allowWrite: true }],
  run: async (input, ctx) => submitReview(ctx, input.number, 'REQUEST_CHANGES', input.body),
});

export const listReviewersCommand = githubArea.command({
  path: ['github', 'pr', 'reviewers'],
  description: 'List requested reviewers for a pull request',
  input: z.object({ number: prNumber }),
  writes: false,
  args: [prNumberArg],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    return github(ctx, `/repos/${owner}/${repo}/pulls/${parseIntText(input.number)}/requested_reviewers`);
  },
});

const reviewerInputs = {
  number: prNumber,
  reviewer: repeatedFlag('User reviewer login (repeatable) (default: [])'),
  teamReviewer: repeatedFlag('Team slug (repeatable) (default: [])'),
  ...allowWriteField,
};

/** `reviewers` and `team_reviewers`, each only when given; at least one of them is required. */
function reviewersBody(reviewer: string[] | undefined, teamReviewer: string[] | undefined): Record<string, unknown> {
  if (!reviewer?.length && !teamReviewer?.length) {
    throw new ToilError('INVALID_INPUT', 'At least one --reviewer or --team-reviewer is required', { fix: 'Pass --reviewer <login> or --team-reviewer <slug>; either may be repeated.' });
  }
  return { ...(reviewer?.length ? { reviewers: reviewer } : {}), ...(teamReviewer?.length ? { team_reviewers: teamReviewer } : {}) };
}

export const addReviewersCommand = githubArea.command({
  path: ['github', 'pr', 'add-reviewers'],
  description: 'Request reviewers on a pull request',
  input: z.object(reviewerInputs),
  writes: true,
  args: [prNumberArg],
  options: [
    { flags: '--reviewer <login>', field: 'reviewer', description: 'User reviewer login (repeatable)' },
    { flags: '--team-reviewer <slug>', field: 'teamReviewer', description: 'Team slug to request (repeatable)' },
  ],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', reviewer: ['octo-dev', 'octo-ops'], teamReviewer: ['platform'], allowWrite: true }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const json = reviewersBody(input.reviewer, input.teamReviewer);
    return github(ctx, `/repos/${owner}/${repo}/pulls/${parseIntText(input.number)}/requested_reviewers`, { method: 'POST', json });
  },
});

export const removeReviewersCommand = githubArea.command({
  path: ['github', 'pr', 'remove-reviewers'],
  description: 'Remove requested reviewers from a pull request',
  input: z.object(reviewerInputs),
  writes: true,
  // A delete: never served over MCP (CLAUDE.md, Writes).
  mcp: false,
  args: [prNumberArg],
  options: [
    { flags: '--reviewer <login>', field: 'reviewer', description: 'User reviewer login to remove (repeatable)' },
    { flags: '--team-reviewer <slug>', field: 'teamReviewer', description: 'Team slug to remove (repeatable)' },
  ],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', reviewer: ['octo-dev'], teamReviewer: ['platform'], allowWrite: true }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const json = reviewersBody(input.reviewer, input.teamReviewer);
    // A DELETE with a JSON body, which GitHub requires here.
    await github(ctx, `/repos/${owner}/${repo}/pulls/${parseIntText(input.number)}/requested_reviewers`, { method: 'DELETE', json });
    return { removed: true };
  },
});

/** A thread as both GraphQL calls ask for it: 10 comments at most, with no paging (suspected bug, #72 item 3). */
const THREAD_FIELDS = `id
                isResolved
                isOutdated
                path
                line
                comments(first: 10) {
                  nodes {
                    id
                    databaseId
                    body
                    author { login }
                    createdAt
                  }
                }`;

export const listReviewThreadsCommand = githubArea.command({
  path: ['github', 'pr', 'threads'],
  description: 'List review threads on a pull request (includes thread node IDs for pr resolve)',
  input: z.object({ number: prNumber }),
  writes: false,
  queryByPost: true,
  args: [prNumberArg],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const number = parseIntText(input.number);
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              pageInfo { hasNextPage }
              nodes {
                ${THREAD_FIELDS}
              }
            }
          }
        }
      }
    `;
    const data = await githubGraphql<{ repository: { pullRequest: { reviewThreads: { pageInfo?: { hasNextPage: boolean }; nodes: unknown[] } } } }>(ctx, query, { owner, repo, number });
    const threads = data.repository.pullRequest.reviewThreads;
    if (threads.pageInfo?.hasNextPage) {
      ctx.warn({ code: 'GITHUB_REVIEW_THREADS_TRUNCATED', message: `more than ${threads.nodes.length} review threads on PR #${number}; only showing the first ${threads.nodes.length}` });
    }
    return threads.nodes;
  },
});

export const resolveThreadCommand = githubArea.command({
  path: ['github', 'pr', 'resolve'],
  description: 'Mark a review thread as resolved (use pr threads to get the thread id)',
  input: z.object({ threadId: z.string().describe('GraphQL node ID of the review thread (e.g. PRT_kwDO...)'), ...allowWriteField }),
  writes: true,
  args: [{ name: 'thread-id', field: 'threadId', description: 'GraphQL node ID of the review thread (e.g. PRT_kwDO...)' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', threadId: 'PRT_kwDOabc12345', allowWrite: true }],
  run: async (input, ctx) => {
    // Owner and repo are required though the mutation never uses them (suspected bug, #72 item 8).
    target(ctx);
    const mutation = `
      mutation($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread {
            ${THREAD_FIELDS}
          }
        }
      }
    `;
    const data = await githubGraphql<{ resolveReviewThread: { thread: unknown } }>(ctx, mutation, { threadId: input.threadId });
    return data.resolveReviewThread.thread;
  },
});

export const reviewCommands = [listReviewsCommand, approveCommand, requestChangesCommand, listReviewersCommand, listReviewThreadsCommand, resolveThreadCommand, addReviewersCommand, removeReviewersCommand];
