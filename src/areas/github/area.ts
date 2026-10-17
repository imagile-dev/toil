import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { GitRemote } from '../../core/call-context.js';
import { parseGitHubRemote } from '../../core/git-remote.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * GitHub and GitHub Enterprise Server: pull requests, reviews, comments,
 * checks, labels, assignees and issues, over the REST API and, for what REST
 * can't do, GraphQL. The two products differ only in host, so they are one
 * area with a configurable base URL. Two forms that ask the same questions
 * are, against all precedent, one form.
 */

/**
 * The remote's host, as each of the three remote shapes the parser accepts
 * spells it. An HTTPS remote with userinfo yields `user@host`, which then
 * matches nothing: that's the parser's own behaviour (#72 item 10).
 */
function remoteHost(url: string): string | undefined {
  return (url.match(/^git@([^:]+):/) ?? url.match(/^ssh:\/\/git@([^/:]+)/) ?? url.match(/^https?:\/\/([^/:]+)/))?.[1];
}

/**
 * What the git step hands over for owner and repo: the remote, rebuilt as a
 * plain `https://<host>/<owner>/<repo>` with any userinfo gone. Core reads
 * the remote before it knows the connection, so it can't check the host
 * against the connection's base URL here; `target()` in client.ts does that
 * with the same parser once the connection is known. Kit gap: when core hands
 * the connection to a git reader, this becomes parseGitHubRemote(url, baseUrl).
 */
export function gitRemoteValue(remote: GitRemote): string | undefined {
  const host = remoteHost(remote.url);
  if (!host) return undefined;
  const parsed = parseGitHubRemote(remote.url, `https://${host}`);
  return parsed ? `https://${host}/${parsed.owner}/${parsed.repo}` : undefined;
}

export const githubArea = defineArea({
  name: 'github',
  description: 'GitHub and GitHub Enterprise Server: pull requests, reviews, comments, checks, labels, assignees and issues',
  connection: z.object({
    baseUrl: z.url().describe('REST API root: https://api.github.com, or https://ghe.imagile.dev/api/v3 for Enterprise Server'),
    token: z.string().min(1).describe('Fine-grained personal access token'),
    // Shared defaults, usually set once under defaults.github for every connection.
    owner: z.string().min(1).optional().describe('Default owner (user or org)'),
    repo: z.string().min(1).optional().describe('Default repository name'),
    targetBranch: z.string().min(1).optional().describe('Default base branch for create-pr (main when unset)'),
  }),
  secrets: ['token'],
  // GitHub Actions sets both on every runner, so a workflow needs no toil-specific setup.
  fallbacks: { token: ['GITHUB_TOKEN'], baseUrl: ['GITHUB_API_URL'] },
  context: {
    owner: {
      description: 'GitHub owner (user or org)',
      flags: '--owner <owner>',
      setting: 'owner',
      git: gitRemoteValue,
      // Any string, as before: an empty --owner still gets the "Could not determine" error.
      schema: z.string(),
    },
    repo: {
      description: 'GitHub repository name',
      flags: '--repo <repo>',
      setting: 'repo',
      git: gitRemoteValue,
      schema: z.string(),
    },
  },
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.token}` },
    service: 'GitHub',
    authFix: `GitHub rejected the token on connection "${connection.name}", or it lacks the permission this needs. Create a fine-grained personal access token under Settings → Developer settings → Personal access tokens → Fine-grained tokens, with access to the repository, then set token (${area.envName('token')}, or GITHUB_TOKEN, for the default connection).`,
  }),
});

/** Not established: the commands pin REST API version 2022-11-28 and use GraphQL. The skill file and the site's integration data say the same. */
export const githubSupported: SupportedVersion = {
  product: 'GitHub Enterprise Server',
  minimum: null,
  api: 'REST API 2022-11-28 and the GraphQL API',
  note: 'toil pins REST API version 2022-11-28 and uses GraphQL for review threads, PR status, auto-merge, the merge queue and drafts. GitHub.com is always current; no Enterprise Server release has been verified yet, and the auto-merge and merge-queue commands need a release that has those features.',
};
