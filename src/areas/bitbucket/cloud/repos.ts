import { z } from 'zod';
import { allowWriteField } from '../../../core/run.js';
import { bitbucketArea } from '../area.js';
import { all, bbc, exampleCursor, filePath, IN_REPO, IN_WORKSPACE, list, needLimitForCursor, repoPath, resolveRef, seg } from './client.js';

/**
 * Repositories and what is in them: list and read repositories, create one,
 * list and create branches and tags, read the commit history and one commit,
 * and read a file or a folder at any ref. A repository here belongs to a
 * workspace and, inside it, a project, which is one more level of filing than
 * Data Center has and exactly one fewer than the org chart.
 */

const limit = (what: string, fallback?: number) =>
  z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Max total ${what} to return (default: ${fallback ?? 'all'})`);
const cursor = z.string().min(1).optional().describe('meta.page.nextCursor from the previous call, to carry on from there');
const limitOption = (what: string, fallback?: number) => ({ flags: '--limit <n>', field: 'limit', description: `Max total ${what} to return (default: ${fallback ?? 'all'})` });
const cursorOption = { flags: '--cursor <cursor>', field: 'cursor', description: 'meta.page.nextCursor from the previous call' };
const filter = z.string().min(1).optional().describe('Bitbucket query language filter, e.g. name ~ "release"');
const filterOption = { flags: '--filter <bbql>', field: 'filter', description: 'Bitbucket query language filter, e.g. name ~ "release"' };
const at = { workspace: 'imagile', repo: 'toil' };

/** Commits are a history, not a list: without --limit, the newest 100. */
export const COMMIT_LIMIT = 100;

export const listReposCommand = bitbucketArea.command({
  path: ['bitbucket', 'repo', 'list'],
  description: 'List repositories in a workspace',
  toolDescription: 'Lists the repositories in a Bitbucket Cloud workspace that the credential can see (slug, name, project, mainbranch, is_private). filter is a Bitbucket query (project.key = "TOIL"). With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ filter, limit: limit('repositories'), cursor }),
  writes: false,
  context: IN_WORKSPACE,
  options: [filterOption, limitOption('repositories'), cursorOption],
  examples: [{ workspace: 'imagile' }, { workspace: 'imagile', repo: 'ignored', filter: 'project.key = "TOIL"', limit: 1 }, { workspace: 'imagile', limit: 1, cursor: exampleCursor('/repositories/imagile?pagelen=100&page=2') }],
  run: async (input, ctx) => {
    needLimitForCursor(input);
    const query = input.filter ? { q: input.filter } : {};
    return (await list(ctx, `Bitbucket Cloud repositories in ${ctx.context.workspace}`, `/repositories/${seg(ctx.context.workspace!)}`, query, { cap: input.limit, cursor: input.cursor })).items;
  },
});

export const getRepoCommand = bitbucketArea.command({
  path: ['bitbucket', 'repo', 'get'],
  description: 'Get a repository',
  toolDescription: 'Returns one Bitbucket Cloud repository as the API does: slug, name, description, project, mainbranch, is_private, size, links.',
  input: z.object({}),
  writes: false,
  context: IN_REPO,
  examples: [at],
  run: (_input, ctx) => bbc(ctx, repoPath(ctx)),
});

export const createRepoCommand = bitbucketArea.command({
  path: ['bitbucket', 'repo', 'create'],
  description: 'Create a new repository in a workspace',
  toolDescription:
    'Creates a private git repository in a Bitbucket Cloud workspace (public with public true) and returns it. name becomes the repository slug. project is the project key; without it Bitbucket puts the repository in the workspace\'s oldest project.',
  input: z.object({
    name: z.string().min(1).describe('Repository name (slug)'),
    description: z.string().optional().describe('Repository description'),
    public: z.boolean().optional().describe('Make the repository public (default: private)'),
    ...allowWriteField,
  }),
  writes: true,
  // The one Cloud command that takes --project: a project inside the workspace to put the repository in.
  context: { ...IN_WORKSPACE, project: 'optional' },
  options: [
    { flags: '--name <name>', field: 'name', description: 'Repository name (slug)' },
    { flags: '--description <desc>', field: 'description', description: 'Repository description' },
    { flags: '--public', field: 'public', description: 'Make the repository public (default: private)' },
  ],
  examples: [
    { workspace: 'imagile', repo: 'ignored', name: 'scratch', allowWrite: true },
    { workspace: 'imagile', name: 'scratch', description: 'Somewhere to try things', project: 'TOIL', public: true, allowWrite: true },
  ],
  run: (input, ctx) =>
    bbc(ctx, `/repositories/${seg(ctx.context.workspace!)}/${seg(input.name)}`, {
      method: 'POST',
      json: {
        scm: 'git',
        is_private: !input.public,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(ctx.context.project ? { project: { key: ctx.context.project } } : {}),
      },
    }),
});

export const listBranchesCommand = bitbucketArea.command({
  path: ['bitbucket', 'branch', 'list'],
  description: 'List branches in a repository',
  toolDescription: 'Lists the open branches of a Bitbucket Cloud repository, each with its target commit. filter is a Bitbucket query (name ~ "release"). With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ filter, limit: limit('branches'), cursor }),
  writes: false,
  context: IN_REPO,
  options: [filterOption, limitOption('branches'), cursorOption],
  examples: [at, { ...at, filter: 'name ~ "release"', limit: 1 }, { ...at, limit: 1, cursor: exampleCursor('/repositories/imagile/toil/refs/branches?pagelen=100&page=2') }],
  run: async (input, ctx) => {
    needLimitForCursor(input);
    return (await list(ctx, `Bitbucket Cloud branches in ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/refs/branches`, input.filter ? { q: input.filter } : {}, { cap: input.limit, cursor: input.cursor })).items;
  },
});

export const createBranchCommand = bitbucketArea.command({
  path: ['bitbucket', 'branch', 'create'],
  description: 'Create a branch at a commit',
  toolDescription: 'Creates a branch pointing at a commit hash (a full hash is safest; a short one may be ambiguous) and returns it. The name has no refs/heads/ prefix.',
  input: z.object({ name: z.string().min(1).describe('Branch name, without refs/heads/'), commit: z.string().min(1).describe('Commit hash the branch points at'), ...allowWriteField }),
  writes: true,
  context: IN_REPO,
  options: [
    { flags: '--name <branch>', field: 'name', description: 'Branch name, without refs/heads/' },
    { flags: '--commit <sha>', field: 'commit', description: 'Commit hash the branch points at' },
  ],
  examples: [{ ...at, name: 'feature/retries', commit: 'abc12345def67890abc12345def67890abc12345', allowWrite: true }],
  run: (input, ctx) => bbc(ctx, `${repoPath(ctx)}/refs/branches`, { method: 'POST', json: { name: input.name, target: { hash: input.commit } } }),
});

export const listTagsCommand = bitbucketArea.command({
  path: ['bitbucket', 'tag', 'list'],
  description: 'List tags in a repository',
  toolDescription: 'Lists the tags of a Bitbucket Cloud repository, each with its target commit. filter is a Bitbucket query (name ~ "v1."). With limit, pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ filter, limit: limit('tags'), cursor }),
  writes: false,
  context: IN_REPO,
  options: [filterOption, limitOption('tags'), cursorOption],
  examples: [at, { ...at, filter: 'name ~ "v1."', limit: 1, cursor: exampleCursor('/repositories/imagile/toil/refs/tags?q=name+~+%22v1.%22&pagelen=100&page=2') }],
  run: async (input, ctx) => {
    needLimitForCursor(input);
    return (await list(ctx, `Bitbucket Cloud tags in ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/refs/tags`, input.filter ? { q: input.filter } : {}, { cap: input.limit, cursor: input.cursor })).items;
  },
});

export const createTagCommand = bitbucketArea.command({
  path: ['bitbucket', 'tag', 'create'],
  description: 'Create an annotated tag at a commit',
  toolDescription: 'Creates an annotated tag pointing at a commit hash and returns it. message is the tag message; without one Bitbucket writes its own.',
  input: z.object({
    name: z.string().min(1).describe('Tag name'),
    commit: z.string().min(1).describe('Commit hash the tag points at'),
    message: z.string().optional().describe('Tag message'),
    ...allowWriteField,
  }),
  writes: true,
  context: IN_REPO,
  options: [
    { flags: '--name <tag>', field: 'name', description: 'Tag name' },
    { flags: '--commit <sha>', field: 'commit', description: 'Commit hash the tag points at' },
    { flags: '--message <text>', field: 'message', description: 'Tag message' },
  ],
  examples: [{ ...at, name: 'v1.2.0', commit: 'abc12345def67890abc12345def67890abc12345', message: 'Release 1.2.0', allowWrite: true }],
  run: (input, ctx) =>
    bbc(ctx, `${repoPath(ctx)}/refs/tags`, { method: 'POST', json: { name: input.name, target: { hash: input.commit }, ...(input.message !== undefined ? { message: input.message } : {}) } }),
});

export const listCommitsCommand = bitbucketArea.command({
  path: ['bitbucket', 'commit', 'list'],
  description: 'List commits, newest first',
  toolDescription: `Lists commits newest first: on branch (a branch, tag or hash) when given, else across every branch, optionally only those touching path. Without limit it returns the newest ${COMMIT_LIMIT}; pass meta.page.nextCursor as cursor for more.`,
  input: z.object({
    branch: z.string().min(1).optional().describe('Branch, tag or commit to list from (default: every branch)'),
    path: z.string().min(1).optional().describe('Only commits that touch this file or folder'),
    limit: limit('commits', COMMIT_LIMIT),
    cursor,
  }),
  writes: false,
  context: IN_REPO,
  options: [
    { flags: '--branch <ref>', field: 'branch', description: 'Branch, tag or commit to list from (default: every branch)' },
    { flags: '--path <path>', field: 'path', description: 'Only commits that touch this file or folder' },
    limitOption('commits', COMMIT_LIMIT),
    cursorOption,
  ],
  examples: [at, { ...at, branch: 'feature/retries', path: 'src/retry.ts', limit: 1 }, { ...at, branch: 'feature/retries', path: 'src/retry.ts', limit: 1, cursor: exampleCursor('/repositories/imagile/toil/commits?include=feature%2Fretries&path=src%2Fretry.ts&pagelen=100&page=2') }],
  run: async (input, ctx) => {
    // include=<ref> rather than commits/<ref>, so a branch with a / never goes in a path.
    const query = { ...(input.branch ? { include: input.branch } : {}), ...(input.path ? { path: input.path } : {}) };
    return (await list(ctx, `Bitbucket Cloud commits in ${ctx.context.workspace}/${ctx.context.repo}`, `${repoPath(ctx)}/commits`, query, { cap: input.limit ?? COMMIT_LIMIT, cursor: input.cursor })).items;
  },
});

export const getCommitCommand = bitbucketArea.command({
  path: ['bitbucket', 'commit', 'get'],
  description: 'Get a commit by hash',
  toolDescription: 'Returns one commit: hash, date, author, message, parents and links. Use bitbucket_pr_diff with spec for its changes.',
  input: z.object({ commit: z.string().min(1).describe('Commit hash') }),
  writes: false,
  context: IN_REPO,
  args: [{ name: 'commit', field: 'commit', description: 'Commit hash' }],
  examples: [{ ...at, commit: 'abc12345def67890abc12345def67890abc12345' }],
  run: (input, ctx) => bbc(ctx, `${repoPath(ctx)}/commit/${seg(input.commit)}`),
});

const refInput = z.string().min(1).optional().describe('Branch, tag or commit to read at (default: the main branch)');
const refOption = { flags: '--ref <ref>', field: 'ref', description: 'Branch, tag or commit to read at (default: the main branch)' };

export const getFileCommand = bitbucketArea.command({
  path: ['bitbucket', 'file', 'get'],
  description: "Get a file's contents at a ref",
  toolDescription:
    "Returns { path, commit, content }: a file's raw contents as text, at ref (a branch, tag or hash; default the main branch). A branch or tag is first resolved to its newest commit. Use bitbucket_file_list for a folder.",
  input: z.object({ path: z.string().min(1).describe('File path in the repository'), ref: refInput }),
  writes: false,
  context: IN_REPO,
  args: [{ name: 'path', field: 'path', description: 'File path in the repository' }],
  options: [refOption],
  examples: [
    { ...at, path: 'README.md' },
    { ...at, path: 'src/retry.ts', ref: 'feature/retries' },
  ],
  run: async (input, ctx) => {
    const commit = await resolveRef(ctx, input.ref);
    const content = await bbc<string>(ctx, `${repoPath(ctx)}/src/${seg(commit)}/${filePath(input.path)}`, { as: 'text' });
    return { path: input.path, commit, content };
  },
});

export const listDirCommand = bitbucketArea.command({
  path: ['bitbucket', 'file', 'list'],
  description: "List a folder's entries at a ref",
  toolDescription: "Lists one folder's files and subfolders at ref (default the main branch; the repository root without path), each with its path, type (commit_file or commit_directory) and, for a file, its size.",
  input: z.object({ path: z.string().optional().describe('Folder path (default: the repository root)'), ref: refInput }),
  writes: false,
  context: IN_REPO,
  args: [{ name: 'path', field: 'path', description: 'Folder path (default: the repository root)', required: false }],
  options: [refOption],
  examples: [at, { ...at, path: 'src', ref: 'abc12345def67890abc12345def67890abc12345' }],
  run: async (input, ctx) => {
    const commit = await resolveRef(ctx, input.ref);
    const folder = filePath(input.path ?? '');
    return all(ctx, `Bitbucket Cloud folder ${input.path || '/'} at ${commit}`, `${repoPath(ctx)}/src/${seg(commit)}/${folder ? `${folder}/` : ''}`);
  },
});

export const repoCommands = [listReposCommand, getRepoCommand, createRepoCommand, listBranchesCommand, createBranchCommand, listTagsCommand, createTagCommand, listCommitsCommand, getCommitCommand, getFileCommand, listDirCommand];
