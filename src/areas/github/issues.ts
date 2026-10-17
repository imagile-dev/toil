import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { githubArea } from './area.js';
import { github, target, type GitHubContext } from './client.js';
import { bodyOf, itemNumber, itemNumberOption, parseIntText, repeatable } from './input.js';

/**
 * Repositories, issues, and the labels and assignees GitHub shares between
 * issues and pull requests. A label is the cheapest form of governance, and
 * the hardest to remove.
 */

export const createRepoCommand = githubArea.command({
  path: ['github', 'create-repo'],
  description: 'Create a new repository (personal or org)',
  input: z.object({
    name: z.string().describe('Repository name'),
    description: z.string().optional().describe('Repository description'),
    private: z.boolean().optional().describe('Create as a private repository'),
    autoInit: z.boolean().optional().describe('Initialize with a README'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--name <name>', field: 'name', description: 'Repository name' },
    { flags: '--description <desc>', field: 'description', description: 'Repository description' },
    { flags: '--private', field: 'private', description: 'Create as a private repository' },
    { flags: '--auto-init', field: 'autoInit', description: 'Initialize with a README' },
  ],
  examples: [
    { name: 'toil-probe', allowWrite: true },
    { owner: 'imagile', repo: 'unused', name: 'toil-probe', description: 'A probe', private: true, autoInit: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    // Only an explicit --owner counts, and always as an org (suspected bug,
    // #72 item 6); the git remote and defaults.github are never read, so the
    // report drops whatever core found there.
    const inputs = ctx.resolved.inputs ?? {};
    const org = inputs.owner?.source === 'input' ? ctx.context.owner : undefined;
    if (inputs.owner?.source !== 'input') delete inputs.owner;
    delete inputs.repo;
    return github(ctx, org ? `/orgs/${org}/repos` : '/user/repos', {
      method: 'POST',
      json: {
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.private !== undefined ? { private: input.private } : {}),
        ...(input.autoInit !== undefined ? { auto_init: input.autoInit } : {}),
      },
    });
  },
});

export const createIssueCommand = githubArea.command({
  path: ['github', 'create-issue'],
  description: 'Create a GitHub issue',
  input: z.object({
    title: z.string().describe('Issue title'),
    body: z.string().optional().describe('Issue body (markdown)'),
    bodyFile: z.string().optional().describe('Read issue body from a file (use - for stdin); overridden by --body'),
    label: repeatable('Label to apply (repeatable) (default: [])'),
    assignee: repeatable('Assignee login (repeatable) (default: [])'),
    ...allowWriteField,
  }),
  writes: true,
  options: [
    { flags: '--title <title>', field: 'title', description: 'Issue title' },
    { flags: '--body <body>', field: 'body', description: 'Issue body (markdown)' },
    { flags: '--body-file <path>', field: 'bodyFile', description: 'Read issue body from a file (use - for stdin); overridden by --body' },
    { flags: '--label <label>', field: 'label', description: 'Label to apply (repeatable) (default: [])' },
    { flags: '--assignee <login>', field: 'assignee', description: 'Assignee login (repeatable) (default: [])' },
  ],
  examples: [
    { owner: 'imagile', repo: 'toil-probe', title: 'Probe failed', body: 'Details.', label: ['bug', 'area/api'], assignee: ['octo-dev'], allowWrite: true },
    { owner: 'imagile', repo: 'toil-probe', title: 'Probe failed', bodyFile: 'issue-body.md', allowWrite: true },
  ],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    const body = bodyOf(ctx, input.body, input.bodyFile);
    return github(ctx, `/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      json: {
        title: input.title,
        ...(body !== undefined ? { body } : {}),
        ...(input.label?.length ? { labels: input.label } : {}),
        ...(input.assignee?.length ? { assignees: input.assignee } : {}),
      },
    });
  },
});

export const addLabelsCommand = githubArea.command({
  path: ['github', 'add-labels'],
  description: 'Add labels to a pull request or issue',
  input: z.object({ number: itemNumber, label: repeatable('Label to add (repeatable) (default: [])'), ...allowWriteField }),
  writes: true,
  options: [itemNumberOption, { flags: '--label <label>', field: 'label', description: 'Label to add (repeatable) (default: [])' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', label: ['bug', 'needs-review'], allowWrite: true }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    if (!input.label?.length) throw new ToilError('INVALID_INPUT', 'At least one --label is required', { fix: 'Pass --label <label>; repeat it for more than one.' });
    return github(ctx, `/repos/${owner}/${repo}/issues/${parseIntText(input.number)}/labels`, { method: 'POST', json: { labels: input.label } });
  },
});

export const removeLabelCommand = githubArea.command({
  path: ['github', 'remove-label'],
  description: 'Remove a label from a pull request or issue',
  input: z.object({ number: itemNumber, label: z.string().describe('Label name to remove'), ...allowWriteField }),
  writes: true,
  options: [itemNumberOption, { flags: '--label <label>', field: 'label', description: 'Label name to remove' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', label: 'needs review', allowWrite: true }],
  run: async (input, ctx) => {
    const { owner, repo } = target(ctx);
    // The label goes into the path unencoded: URL parsing escapes a space but
    // leaves `/`, `?`, `#` and `%` their URL meaning (suspected bug, #72 item 4).
    await github(ctx, `/repos/${owner}/${repo}/issues/${parseIntText(input.number)}/labels/${input.label}`, { method: 'DELETE' });
    return { removed: true, label: input.label };
  },
});

function assignees(ctx: GitHubContext, number: number | string, assignee: string[] | undefined, method: 'POST' | 'DELETE') {
  const { owner, repo } = target(ctx);
  if (!assignee?.length) throw new ToilError('INVALID_INPUT', 'At least one --assignee is required', { fix: 'Pass --assignee <login>; repeat it for more than one.' });
  return github(ctx, `/repos/${owner}/${repo}/issues/${parseIntText(number)}/assignees`, { method, json: { assignees: assignee } });
}

export const addAssigneesCommand = githubArea.command({
  path: ['github', 'add-assignees'],
  description: 'Add assignees to a pull request or issue',
  input: z.object({ number: itemNumber, assignee: repeatable('Assignee login (repeatable) (default: [])'), ...allowWriteField }),
  writes: true,
  options: [itemNumberOption, { flags: '--assignee <login>', field: 'assignee', description: 'Assignee login (repeatable) (default: [])' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', assignee: ['octo-dev', 'octo-ops'], allowWrite: true }],
  run: async (input, ctx) => assignees(ctx, input.number, input.assignee, 'POST'),
});

export const removeAssigneesCommand = githubArea.command({
  path: ['github', 'remove-assignees'],
  description: 'Remove assignees from a pull request or issue',
  input: z.object({ number: itemNumber, assignee: repeatable('Assignee login to remove (repeatable) (default: [])'), ...allowWriteField }),
  writes: true,
  options: [itemNumberOption, { flags: '--assignee <login>', field: 'assignee', description: 'Assignee login to remove (repeatable) (default: [])' }],
  examples: [{ owner: 'imagile', repo: 'toil-probe', number: '7', assignee: ['octo-ops'], allowWrite: true }],
  run: async (input, ctx) => assignees(ctx, input.number, input.assignee, 'DELETE'),
});

export const issueCommands = [createRepoCommand, createIssueCommand, addLabelsCommand, removeLabelCommand, addAssigneesCommand, removeAssigneesCommand];
