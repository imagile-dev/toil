import { contrastArea, contrastSupported } from './area.js';
import { appsCommands } from './apps.js';
import { findingsCommands } from './findings.js';
import { librariesCommands } from './libraries.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = contrastArea;
export const supported = contrastSupported;
export const commands = [...appsCommands, ...findingsCommands, ...librariesCommands];
