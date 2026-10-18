import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { bitbucketCloudArea } from './area.js';
import { all, bbc, getPR, IN_REPO, prPath, repoPath, seg, type BitbucketCloudContext } from './client.js';

/**
 * Reviewing a pull request: its diff and changed files, approving,
 * withdrawing approval, requesting changes, its reviewers, the repository's
 * default reviewers, and build statuses. Requesting changes is a single POST,
 * which is the only form in the building that takes one step to send back.
 */

const pr = z.number().int().positive().describe('Pull request ID');
const prOption = { flags: '--pr <pr-id>', field: 'pr', description: 'Pull request ID' };
const at = { workspace: 'imagile', repo: 'toil' };
const example = { ...at, pr: 42 };

/**
 * A pull request's changes as a two-commit spec, `source..destination`, read
 * with `topic=true`: the three-dot diff Bitbucket shows on the pull request.
 * Built from the pull request rather than following its /diff redirect, so
 * the path and context parameters reach the diff itself.
 */
async function prSpec(ctx: BitbucketCloudContext, id: number): Promise<string> {
  const found = await getPR(ctx, id);
  const source = found.source?.commit?.hash;
  const destination = found.destination?.commit?.hash;
  if (!source || !destination) {
    throw new ToilError('NOT_FOUND', `Pull request ${id} has no source or destination commit to diff.`, { fix: 'Check the pull request still has both branches: toil bitbucket-cloud get-pr --id <id>.' });
  }
  return `${source}..${destination}`;
}

export const diffCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'diff'],
  description: 'Get the unified diff of a pull request or a commit spec',
  toolDescription:
    "Returns { diff }: unified git diff text, for a pull request (pr: its changes against the target, as Bitbucket shows them) or a commit spec (one commit against its first parent, or a..b). file limits it to one path; contextLines sets the lines of context.",
  input: z.object({
    pr: pr.optional(),
    spec: z.string().min(1).optional().describe('A commit, or two as a..b, instead of a pull request'),
    file: z.string().min(1).optional().describe('Limit diff to a specific file'),
    contextLines: z.number().int().nonnegative().optional().describe('Lines of context around changes'),
  }),
  writes: false,
  context: IN_REPO,
  options: [
    prOption,
    { flags: '--spec <a..b>', field: 'spec', description: 'A commit, or two as a..b, instead of a pull request' },
    { flags: '--file <path>', field: 'file', description: 'Limit diff to a specific file' },
    { flags: '--context-lines <n>', field: 'contextLines', description: 'Lines of context around changes' },
  ],
  examples: [example, { ...at, spec: 'abc12345def67890abc12345def67890abc12345', file: 'src/retry.ts', contextLines: 0 }],
  run: async (input, ctx) => {
    if ((input.pr === undefined) === (input.spec === undefined)) {
      throw new ToilError('INVALID_INPUT', 'Pass exactly one of --pr and --spec.', { fix: 'Use --pr <id> for a pull request, or --spec <commit> (or <a>..<b>) for commits.' });
    }
    const spec = input.spec ?? (await prSpec(ctx, input.pr!));
    const query = { ...(input.pr !== undefined ? { topic: true } : {}), ...(input.file ? { path: input.file } : {}), ...(input.contextLines !== undefined ? { context: input.contextLines } : {}) };
    return { diff: await bbc<string>(ctx, `${repoPath(ctx)}/diff/${seg(spec)}`, { query, as: 'text' }) };
  },
});

interface Diffstat {
  status?: string;
  old?: { path?: string } | null;
  new?: { path?: string } | null;
}

export const listFilesCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'list-files'],
  description: 'List files changed in a pull request',
  toolDescription: "Lists the paths a pull request changes, as strings: each change's new path, or its old path for a deletion. Every page of Bitbucket's diffstat is read.",
  input: z.object({ pr }),
  writes: false,
  context: IN_REPO,
  options: [prOption],
  examples: [example],
  run: async (input, ctx) => {
    const spec = await prSpec(ctx, input.pr);
    const stats = await all<Diffstat>(ctx, `Bitbucket Cloud files changed in pull request ${input.pr}`, `${repoPath(ctx)}/diffstat/${seg(spec)}`, { topic: true });
    return stats.flatMap((s) => {
      const path = s.new?.path ?? s.old?.path;
      return path ? [path] : [];
    });
  },
});

export const approveCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'approve'],
  description: 'Approve a pull request',
  toolDescription: "Approves a pull request as the credential's user and returns Bitbucket's participant record.",
  input: z.object({ pr, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [prOption],
  examples: [{ ...example, allowWrite: true }],
  run: (input, ctx) => bbc(ctx, `${prPath(ctx, input.pr)}/approve`, { method: 'POST' }),
});

export const unapproveCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'unapprove'],
  description: 'Remove approval from a pull request',
  toolDescription: "Withdraws the credential's user's approval of a pull request. Returns { unapproved: true }.",
  input: z.object({ pr, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [prOption],
  examples: [{ ...example, allowWrite: true }],
  run: async (input, ctx) => {
    await bbc(ctx, `${prPath(ctx, input.pr)}/approve`, { method: 'DELETE' });
    return { unapproved: true };
  },
});

export const requestChangesCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'request-changes'],
  description: 'Request changes on a pull request',
  toolDescription: "Marks a pull request as changes requested by the credential's user (Data Center calls this needs-work) and returns Bitbucket's participant record.",
  input: z.object({ pr, ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [prOption],
  examples: [{ ...example, allowWrite: true }],
  run: (input, ctx) => bbc(ctx, `${prPath(ctx, input.pr)}/request-changes`, { method: 'POST' }),
});

export const listReviewersCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'list-reviewers'],
  description: 'List reviewers of a pull request',
  toolDescription: "Lists a pull request's reviewers as participants: each one's user, approved, and state (approved, changes_requested or null).",
  input: z.object({ pr }),
  writes: false,
  context: IN_REPO,
  options: [prOption],
  examples: [example],
  run: async (input, ctx) => ((await getPR(ctx, input.pr)).participants ?? []).filter((p) => p.role === 'REVIEWER'),
});

export const listDefaultReviewersCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'list-default-reviewers'],
  description: "List the repository's default reviewers",
  toolDescription: "Lists the users Bitbucket Cloud adds as reviewers to every new pull request in the repository (the repository's own list, not those inherited from its project).",
  input: z.object({}),
  writes: false,
  context: IN_REPO,
  examples: [at],
  run: (_input, ctx) => all(ctx, `Bitbucket Cloud default reviewers of ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/default-reviewers`),
});

export const listBuildsCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'list-builds'],
  description: 'List build statuses for a pull request',
  toolDescription: "Lists every build status reported on a pull request's commits (key, name, state, url, description, created_on, updated_on).",
  input: z.object({ pr }),
  writes: false,
  context: IN_REPO,
  options: [prOption],
  examples: [example],
  run: (input, ctx) => all(ctx, `Bitbucket Cloud build statuses on pull request ${input.pr}`, `${prPath(ctx, input.pr)}/statuses`),
});

export const getBuildStatusCommand = bitbucketCloudArea.command({
  path: ['bitbucket-cloud', 'get-build-status'],
  description: 'Get build statuses for a commit SHA',
  toolDescription: 'Lists every build status reported for one commit (key, name, state, url, description, created_on, updated_on).',
  input: z.object({ commit: z.string().min(1).describe('Commit SHA') }),
  writes: false,
  context: IN_REPO,
  options: [{ flags: '--commit <sha>', field: 'commit', description: 'Commit SHA' }],
  examples: [{ ...at, commit: 'abc12345def67890abc12345def67890abc12345' }],
  run: (input, ctx) => all(ctx, `Bitbucket Cloud build statuses on commit ${input.commit}`, `${repoPath(ctx)}/commit/${seg(input.commit)}/statuses`),
});

export const reviewCommands = [diffCommand, listFilesCommand, approveCommand, unapproveCommand, requestChangesCommand, listReviewersCommand, listDefaultReviewersCommand, listBuildsCommand, getBuildStatusCommand];
