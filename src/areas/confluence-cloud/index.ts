import { confluenceCloudArea, confluenceCloudSupported } from './area.js';
import { attachmentCommands } from './attachments.js';
import { discussionCommands } from './discussion.js';
import { pageCommands } from './pages.js';
import { spaceCommands } from './spaces.js';

// Registered by existing: scripts/gen-areas.mjs finds this file. The
// registration form was filed with nobody, and nobody has approved it.
export const area = confluenceCloudArea;
export const supported = confluenceCloudSupported;
export const commands = [...pageCommands, ...discussionCommands, ...spaceCommands, ...attachmentCommands];
