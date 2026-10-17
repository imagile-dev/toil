import { z } from 'zod';
import { allowWriteField } from '../../core/run.js';
import { githubArea } from './area.js';
import { githubGraphql, target } from './client.js';
import { graphqlMethod, parseIntText, prNodeId, prNumber, prNumberOption } from './input.js';

/**
 * What REST can't do and GraphQL can: auto-merge, the merge queue, draft
 * state, and one aggregated status. Each mutation first GETs the PR for its
 * node id. Auto-merge is a standing approval that acts when nobody is
 * looking, which is how most standing approvals work.
 */

const AUTO_MERGE_FIELDS = `pullRequest {
            number
            autoMergeRequest {
              mergeMethod
              enabledAt
              enabledBy { login }
            }
          }`;

const methodInput = z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method (choices: "merge", "squash", "rebase")');
const methodOption = { flags: '--method <method>', field: 'method', description: 'Merge method (choices: "merge", "squash", "rebase")' } as const;

export const enableAutoMergeCommand = githubArea.command({
  path: ['github', 'enable-auto-merge'],
  description: 'Enable auto-merge on a pull request (merges automatically when all requirements are met)',
  input: z.object({
    number: prNumber,
    method: methodInput,
    matchHeadCommit: z.string().optional().describe('Only enable if the PR head matches this SHA (prevents race conditions)'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    prNumberOption,
    methodOption,
    { flags: '--match-head-commit <sha>', field: 'matchHeadCommit', description: 'Only enable if the PR head matches this SHA (prevents race conditions)' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', number: '7', method: 'squash', matchHeadCommit: 'abc1234', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const pullRequestId = await prNodeId(ctx, owner, repo, parseIntText(input.number));
    const mutation = `
      mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod, $expectedHeadOid: GitObjectID) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId
          mergeMethod: $mergeMethod
          expectedHeadOid: $expectedHeadOid
        }) {
          ${AUTO_MERGE_FIELDS}
        }
      }
    `;
    const variables: Record<string, unknown> = { pullRequestId };
    if (input.method) variables.mergeMethod = graphqlMethod(input.method);
    if (input.matchHeadCommit) variables.expectedHeadOid = input.matchHeadCommit;
    const data = await githubGraphql<{ enablePullRequestAutoMerge: { pullRequest: unknown } }>(ctx, mutation, variables);
    return data.enablePullRequestAutoMerge.pullRequest;
  },
});

export const disableAutoMergeCommand = githubArea.command({
  path: ['github', 'disable-auto-merge'],
  description: 'Disable auto-merge on a pull request',
  input: z.object({ number: prNumber, ...allowWriteField }),
  writes: true,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const pullRequestId = await prNodeId(ctx, owner, repo, parseIntText(input.number));
    const mutation = `
      mutation($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
          ${AUTO_MERGE_FIELDS}
        }
      }
    `;
    const data = await githubGraphql<{ disablePullRequestAutoMerge: { pullRequest: unknown } }>(ctx, mutation, { pullRequestId });
    return data.disablePullRequestAutoMerge.pullRequest;
  },
});

export const enqueuePrCommand = githubArea.command({
  path: ['github', 'enqueue-pr'],
  description: 'Add a pull request to the repository merge queue',
  input: z.object({
    number: prNumber,
    method: methodInput,
    matchHeadCommit: z.string().optional().describe('Only enqueue if the PR head matches this SHA (prevents race conditions)'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    prNumberOption,
    methodOption,
    { flags: '--match-head-commit <sha>', field: 'matchHeadCommit', description: 'Only enqueue if the PR head matches this SHA (prevents race conditions)' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', number: '7', method: 'rebase', matchHeadCommit: 'abc1234', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const pullRequestId = await prNodeId(ctx, owner, repo, parseIntText(input.number));
    const mutation = `
      mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID, $mergeMethod: PullRequestMergeMethod) {
        addPullRequestToMergeQueue(input: {
          pullRequestId: $pullRequestId
          expectedHeadOid: $expectedHeadOid
          mergeMethod: $mergeMethod
        }) {
          mergeQueue {
            url
          }
        }
      }
    `;
    const variables: Record<string, unknown> = { pullRequestId };
    if (input.matchHeadCommit) variables.expectedHeadOid = input.matchHeadCommit;
    if (input.method) variables.mergeMethod = graphqlMethod(input.method);
    const data = await githubGraphql<{ addPullRequestToMergeQueue: { mergeQueue: { url: string } } }>(ctx, mutation, variables);
    return { mergeQueueUrl: data.addPullRequestToMergeQueue.mergeQueue.url };
  },
});

/** One draft toggle: the mutation's name differs, the shape doesn't. */
function draftCommand(name: 'convert-to-draft' | 'ready-for-review', description: string, mutationName: 'convertPullRequestToDraft' | 'markPullRequestReadyForReview') {
  return githubArea.command({
    path: ['github', name],
    description,
    input: z.object({ number: prNumber, ...allowWriteField }),
    writes: true,
    options: [prNumberOption],
    examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', allowWrite: true }],
    run: async (input, ctx) => {
      const { owner, repo } = target(ctx);
      const pullRequestId = await prNodeId(ctx, owner, repo, parseIntText(input.number));
      const mutation = `
      mutation($pullRequestId: ID!) {
        ${mutationName}(input: { pullRequestId: $pullRequestId }) {
          pullRequest { number isDraft }
        }
      }
    `;
      const data = await githubGraphql<Record<string, { pullRequest: { number: number; isDraft: boolean } }>>(ctx, mutation, { pullRequestId });
      return data[mutationName]!.pullRequest;
    },
  });
}

export const convertToDraftCommand = draftCommand('convert-to-draft', 'Convert an open pull request to a draft', 'convertPullRequestToDraft');
export const readyForReviewCommand = draftCommand('ready-for-review', 'Mark a draft pull request as ready for review', 'markPullRequestReadyForReview');

const PR_STATUS_QUERY = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            number
            title
            state
            isDraft
            merged
            mergeable
            mergeStateStatus
            reviewDecision
            autoMergeRequest {
              mergeMethod
              enabledAt
              enabledBy { login }
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first: 100) {
                      nodes {
                        ... on CheckRun {
                          __typename
                          name
                          status
                          conclusion
                        }
                        ... on StatusContext {
                          __typename
                          context
                          state
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

type CheckNode = { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null } | { __typename: 'StatusContext'; context: string; state: string };

interface StatusPr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  merged: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  autoMergeRequest: { mergeMethod: string; enabledAt: string; enabledBy: { login: string } } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { contexts: { nodes: CheckNode[] } } | null } }> };
}

export const prStatusCommand = githubArea.command({
  path: ['github', 'pr-status'],
  description: 'Aggregated PR status: review decision, checks, mergeability, draft state, and auto-merge',
  input: z.object({ number: prNumber }),
  writes: false,
  // A GraphQL query, sent as POST like every GraphQL call; it changes nothing.
  queryByPost: true,
  options: [prNumberOption],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7' }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const data = await githubGraphql<{ repository: { pullRequest: StatusPr } }>(ctx, PR_STATUS_QUERY, { owner, repo, number: parseIntText(input.number) });
    const pr = data.repository.pullRequest;
    // Only the first 100 contexts, with no warning (suspected bug, #72 item 2).
    const nodes = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
    const details = nodes.map((n) => (n.__typename === 'CheckRun' ? { name: n.name, status: n.status, conclusion: n.conclusion } : { name: n.context, status: n.state, conclusion: null }));
    // Lowercase comparisons against GraphQL's uppercase enums, so real checks
    // all land in `other` (suspected bug, #72 item 1).
    const passed = details.filter((d) => d.conclusion === 'success' || d.status === 'success').length;
    const failed = details.filter((d) => d.conclusion === 'failure' || d.conclusion === 'timed_out' || d.conclusion === 'action_required' || d.status === 'failure' || d.status === 'error').length;
    const pending = details.filter((d) => d.status === 'queued' || d.status === 'in_progress' || d.status === 'pending').length;
    const other = details.length - passed - failed - pending;
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.isDraft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      reviewDecision: pr.reviewDecision,
      autoMergeRequest: pr.autoMergeRequest ? { mergeMethod: pr.autoMergeRequest.mergeMethod, enabledAt: pr.autoMergeRequest.enabledAt, enabledBy: pr.autoMergeRequest.enabledBy.login } : null,
      checks: { total: details.length, passed, failed, pending, other, details },
    };
  },
});

export const mergingCommands = [enableAutoMergeCommand, disableAutoMergeCommand, enqueuePrCommand, convertToDraftCommand, readyForReviewCommand, prStatusCommand];
