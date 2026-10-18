import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import { parseBitbucketRemote } from '../../core/git-remote.js';
import type { SupportedVersion } from '../../core/supported.js';

/** The 'Could not determine' error when project or repo is nowhere, less its pointer to a setup command toil doesn't have. */
const BOTH_MISSING = 'Could not determine Bitbucket project/repo. Pass --project and --repo, or set project and repo on the connection.';

/**
 * Bitbucket Data Center: repositories, pull requests, comments, reviews and
 * build statuses, over REST API 1.0. Pull requests are the one review process
 * in the building with a defined end state, so they get the most commands.
 */
export const bitbucketArea = defineArea({
  name: 'bitbucket',
  description: 'Bitbucket Data Center: repositories, pull requests, comments, reviewers and build statuses',
  connection: z.object({
    baseUrl: z.url().describe('Bitbucket server root, e.g. https://bitbucket.imagile.dev'),
    pat: z.string().min(1).describe('HTTP access token'),
    // Shared defaults, usually set once under defaults.bitbucket for every connection.
    project: z.string().min(1).optional().describe('Default project key'),
    repo: z.string().min(1).optional().describe('Default repository slug'),
    targetBranch: z.string().min(1).optional().describe('Default target branch for create-pr (main when unset)'),
  }),
  secrets: ['pat'],
  // Most commands require both and say so in the contract's specified wording; the
  // project-only commands check their own. The git remote counts only when
  // it's on the connection's own host, so a clone of something else never
  // names a Bitbucket project.
  context: {
    project: {
      description: 'Bitbucket project key',
      flags: '--project <key>',
      setting: 'project',
      git: (remote, connection) => parseBitbucketRemote(remote.url, connection?.baseUrl)?.project,
      missing: { message: BOTH_MISSING },
    },
    repo: {
      description: 'Bitbucket repository slug',
      flags: '--repo <slug>',
      setting: 'repo',
      git: (remote, connection) => parseBitbucketRemote(remote.url, connection?.baseUrl)?.repo,
      missing: { message: BOTH_MISSING },
    },
  },
  examples: { baseUrl: 'https://bitbucket.imagile.dev' },
  // Recent repositories are the signed-in user's own, so an anonymous or revoked token gets a 401.
  probe: () => ({ path: '/rest/api/1.0/profile/recent/repos', query: { limit: 1 } }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.pat}` },
    service: 'Bitbucket',
    authFix: `Bitbucket rejected the HTTP access token on connection "${connection.name}". Create a new one under your profile picture → Manage account → HTTP access tokens, then set pat (${area.envName('pat')} for the default connection).`,
  }),
});

/** Not established: toil speaks REST API 1.0, which every Bitbucket Data Center release serves. The skill file and the site's integration data say the same. */
export const bitbucketSupported: SupportedVersion = {
  product: 'Bitbucket Data Center',
  minimum: null,
  api: 'REST API 1.0',
  note: 'toil calls REST API 1.0 (/rest/api/1.0, /rest/build-status/1.0 and /rest/default-reviewers/1.0) with an HTTP access token sent as a Bearer header. No release has been verified yet.',
};
