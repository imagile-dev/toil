import { alationArea, alationSupported } from './area.js';
import { catalogCommands } from './catalog.js';
import { documentCommands } from './documents.js';
import { tokenCommands } from './token.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = alationArea;
export const supported = alationSupported;
export const commands = [...tokenCommands, ...catalogCommands, ...documentCommands];
