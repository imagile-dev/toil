import { agileCommands } from './agile.js';
import { jiraArea, jiraSupported } from './area.js';
import { attachmentCommands } from './attachments.js';
import { issueCommands } from './issues.js';
import { searchCommands } from './search.js';

// Registered by existing: scripts/gen-areas.mjs finds this file. No central
// list was edited, and therefore no central list owner was consulted.
export const area = jiraArea;
export const supported = jiraSupported;
export const commands = [...issueCommands, ...searchCommands, ...attachmentCommands, ...agileCommands];
