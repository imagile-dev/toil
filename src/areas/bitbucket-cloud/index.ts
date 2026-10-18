import { apiCommand } from '../../core/passthrough.js';
import { bitbucketCloudArea, bitbucketCloudSupported } from './area.js';
import { commentCommands } from './comments.js';
import { pipelineCommands } from './pipelines.js';
import { pullRequestCommands } from './pull-requests.js';
import { repoCommands } from './repos.js';
import { reviewCommands } from './review.js';

/** `bitbucket-cloud api`: any REST API 2.0 endpoint, through the same request hook as every other bitbucket-cloud command. */
const bitbucketCloudApi = apiCommand(bitbucketCloudArea, {
  service: 'Bitbucket Cloud',
  examplePath: '/repositories/imagile/toil',
  examples: [
    { method: 'GET', path: '/repositories/imagile/toil', workspace: 'imagile', repo: 'toil' },
    { method: 'GET', path: 'repositories/imagile/toil/refs/branches', query: ['q=name ~ "release"', 'pagelen=10'] },
    { method: 'POST', path: '/repositories/imagile/toil/pullrequests/42/comments', bodyFile: 'comment.json', contentType: 'application/json', allowWrite: true },
  ],
});

// Registered by existing: scripts/gen-areas.mjs finds this file, so no
// register of areas needed a cover sheet for the second Bitbucket.
export const area = bitbucketCloudArea;
export const supported = bitbucketCloudSupported;
export const commands = [...repoCommands, ...pullRequestCommands, ...reviewCommands, ...commentCommands, ...pipelineCommands, bitbucketCloudApi];
