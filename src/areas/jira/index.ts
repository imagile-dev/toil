import { apiCommand } from '../../core/passthrough.js';
import { agileCommands } from './agile.js';
import { jiraArea, jiraSupported } from './area.js';
import { attachmentCommands } from './attachments.js';
import { issueCommands } from './issues.js';
import { searchCommands } from './search.js';

/** `jira api`: any /rest/api/2 or Agile endpoint, through the same request hook as every other jira command. */
const jiraApi = apiCommand(jiraArea, {
  service: 'Jira Data Center',
  examplePath: '/rest/api/2/issue/PAY-1042',
  examples: [
    { method: 'GET', path: '/rest/api/2/issue/PROJ-123' },
    { method: 'GET', path: 'rest/api/2/issue/PROJ-123', query: ['fields=attachment'] },
    { method: 'POST', path: '/rest/api/2/issue/PROJ-123/comment', bodyFile: 'comment.json', contentType: 'application/json', allowWrite: true },
  ],
});

// Registered by existing: scripts/gen-areas.mjs finds this file. No central
// list was edited, and therefore no central list owner was consulted.
export const area = jiraArea;
export const supported = jiraSupported;
export const commands = [...issueCommands, ...searchCommands, ...attachmentCommands, ...agileCommands, jiraApi];
