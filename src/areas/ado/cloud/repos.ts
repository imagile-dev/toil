import { z } from 'zod';
import { adoArea } from '../area.js';
import { IN_PROJECT, IN_REPO, adoc, connectionData, cursorField, enc, exampleCursor, headerPages, limitField, pageOf, pageOptions, projectPath, repoPath } from './client.js';

/**
 * The organization-level reads: who the token belongs to, the projects, and
 * the git repositories in one. The organization itself is the connection, so
 * there is nothing to list above it, which is the first org chart to say so.
 */

const at = { project: 'Imagile' };
// Both group inputs, set on one example of each command so the parity suite covers them; a command that doesn't use one ignores it.
const inRepo = { ...at, repo: 'imagile-api' };

export const whoamiCommand = adoArea.command({
  path: ['ado', 'whoami'],
  description: 'Show the authenticated user',
  toolDescription: "Returns the organization's connectionData for the token: the authenticated user (id, display name), the instance and the deployment. authenticatedUser.id is the identity id the vote commands use.",
  input: z.object({}),
  writes: false,
  examples: [{}, inRepo],
  run: (_input, ctx) => connectionData(ctx),
});

export const projectListCommand = adoArea.command({
  path: ['ado', 'project', 'list'],
  description: 'List projects in the organization',
  toolDescription: 'Lists every project in the organization (id, name, state, visibility), following continuation tokens to the end. With limit, returns at most that many; pass meta.page.nextCursor as cursor for the next page.',
  input: z.object({ limit: limitField('projects'), cursor: cursorField }),
  writes: false,
  options: pageOptions('projects'),
  examples: [{}, { ...inRepo, limit: 1 }, { limit: 1, cursor: exampleCursor('abc12345') }],
  run: (input, ctx) => headerPages(ctx, '/_apis/projects', {}, 'Azure DevOps projects', pageOf(input)),
});

export const projectGetCommand = adoArea.command({
  path: ['ado', 'project', 'get'],
  description: 'Get a project by name',
  toolDescription: 'Returns one project in the organization by name or id.',
  input: z.object({ name: z.string().min(1).describe('Project name or id') }),
  writes: false,
  args: [{ name: 'name', field: 'name', description: 'Project name (Services also takes an id)' }],
  examples: [{ name: 'Imagile' }, { ...inRepo, name: 'Imagile' }],
  run: (input, ctx) => adoc(ctx, `/_apis/projects/${enc(input.name)}`),
});

export const repoListCommand = adoArea.command({
  path: ['ado', 'repo', 'list'],
  description: 'List git repositories in the project',
  toolDescription: 'Lists the git repositories in the project (id, name, default branch, urls). The API returns them in one answer. Needs no repo.',
  input: z.object({}),
  writes: false,
  context: IN_PROJECT,
  examples: [at, inRepo],
  run: async (_input, ctx) => (await adoc<{ value?: unknown[] }>(ctx, `${projectPath(ctx)}/_apis/git/repositories`)).value ?? [],
});

export const repoGetCommand = adoArea.command({
  path: ['ado', 'repo', 'get'],
  description: 'Get a repository',
  toolDescription: 'Returns the repository (id, name, default branch, project, urls).',
  input: z.object({}),
  writes: false,
  context: IN_REPO,
  examples: [inRepo],
  run: (_input, ctx) => adoc(ctx, repoPath(ctx)),
});

export const repoCommands = [whoamiCommand, projectListCommand, projectGetCommand, repoListCommand, repoGetCommand];
