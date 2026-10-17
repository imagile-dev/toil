import { artifactoryArea, artifactorySupported } from './area.js';
import { artifactoryCommands } from './commands.js';
import { dependencyCommands } from './dependencies.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = artifactoryArea;
export const supported = artifactorySupported;
export const commands = [...artifactoryCommands, ...dependencyCommands];
