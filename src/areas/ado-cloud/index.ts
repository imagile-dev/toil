import { apiCommand } from '../../core/passthrough.js';
import { adoCloudArea, adoCloudSupported } from './area.js';
import { commentCommands } from './comments.js';
import { pullRequestCommands } from './pull-requests.js';
import { repoCommands } from './repos.js';
import { workCommands } from './work.js';

/** `ado-cloud api`: any Azure DevOps Services REST endpoint in the organization, through the same request hook as every other ado-cloud command. */
const adoCloudApi = apiCommand(adoCloudArea, {
  service: 'Azure DevOps Services',
  examplePath: '/_apis/projects?api-version=7.1',
  examples: [
    { method: 'GET', path: '/_apis/projects', query: ['api-version=7.1'], project: 'Imagile', repo: 'imagile-api' },
    { method: 'GET', path: 'Imagile/_apis/wit/workitemtypes', query: ['api-version=7.1', '$expand=states'] },
    { method: 'PATCH', path: '/_apis/wit/workitems/42', query: ['api-version=7.1'], bodyFile: 'patch.json', contentType: 'application/json-patch+json', allowWrite: true },
  ],
});

// Registered by existing: scripts/gen-areas.mjs finds this file, so the
// second Azure DevOps needed no change request against the first.
export const area = adoCloudArea;
export const supported = adoCloudSupported;
export const commands = [...repoCommands, ...workCommands, ...pullRequestCommands, ...commentCommands, adoCloudApi];
