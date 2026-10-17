import { sdeArea, sdeSupported } from './area.js';
import { sdeCommands } from './commands.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = sdeArea;
export const supported = sdeSupported;
export const commands = [...sdeCommands];
