import { agileCommands } from './agile.js';
import { jiraCloudArea, jiraCloudSupported } from './area.js';
import { attachmentCommands } from './attachments.js';
import { issueCommands } from './issues.js';
import { projectCommands } from './projects.js';
import { searchCommands } from './search.js';

// Registered by existing: scripts/gen-areas.mjs finds this file. The register
// of registers was not amended, there being none.
export const area = jiraCloudArea;
export const supported = jiraCloudSupported;
export const commands = [...issueCommands, ...searchCommands, ...attachmentCommands, ...projectCommands, ...agileCommands];
