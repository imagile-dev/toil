import { checkmarxArea, checkmarxSupported } from './area.js';
import { checkmarxCommands } from './commands.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = checkmarxArea;
export const supported = checkmarxSupported;
export const commands = [...checkmarxCommands];
