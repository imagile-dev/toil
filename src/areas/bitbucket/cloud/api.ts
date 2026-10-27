import { apiCommand } from '../../../core/passthrough.js';
import { bitbucketArea } from '../area.js';

/** `bitbucket api`: any Bitbucket Cloud REST API 2.0 endpoint, through the same request hook as every other bitbucket command. Cloud only. */
export const bitbucketApi = apiCommand(bitbucketArea, {
  service: 'Bitbucket Cloud',
  examplePath: '/repositories/imagile/toil',
  examples: [
    { method: 'GET', path: '/repositories/imagile/toil', workspace: 'imagile', repo: 'toil' },
    { method: 'GET', path: 'repositories/imagile/toil/refs/branches', query: ['q=name ~ "release"', 'pagelen=10'] },
    { method: 'POST', path: '/repositories/imagile/toil/pullrequests/42/comments', bodyFile: 'comment.json', contentType: 'application/json', allowWrite: true },
  ],
});
