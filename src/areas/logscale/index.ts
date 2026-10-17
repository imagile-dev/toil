import { logscaleArea, logscaleSupported } from './area.js';
import { repositoriesCommands } from './repositories.js';
import { queryCommands } from './query.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = logscaleArea;
export const supported = logscaleSupported;
export const commands = [...repositoriesCommands, ...queryCommands];
