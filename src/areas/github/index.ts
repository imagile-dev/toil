import { githubArea, githubSupported } from './area.js';
import { commentCommands } from './comments.js';
import { issueCommands } from './issues.js';
import { mergingCommands } from './merging.js';
import { prCommands } from './prs.js';
import { reviewCommands } from './reviews.js';
import { statusCommands } from './status.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = githubArea;
export const supported = githubSupported;
export const commands = [...issueCommands, ...prCommands, ...mergingCommands, ...commentCommands, ...reviewCommands, ...statusCommands];
