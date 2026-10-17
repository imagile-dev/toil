import { gitArea, gitSupported } from './area.js';
import { branchCommands } from './branch.js';
import { diffCommands } from './diff.js';
import { logCommands } from './log.js';
import { reportCommands } from './report.js';
import { statusCommands } from './status.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = gitArea;
export const supported = gitSupported;
export const commands = [...statusCommands, ...diffCommands, ...logCommands, ...branchCommands, ...reportCommands];
