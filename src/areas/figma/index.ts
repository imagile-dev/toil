import { figmaArea, figmaSupported } from './area.js';
import { figmaCommands } from './commands.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = figmaArea;
export const supported = figmaSupported;
export const commands = [...figmaCommands];
