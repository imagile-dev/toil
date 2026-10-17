import { jenkinsArea, jenkinsSupported } from './area.js';
import { pipelineCommands } from './pipeline.js';

// Registered by existing: scripts/gen-areas.mjs finds this file. The instance
// commands are core's connections commands, through coreAliases in area.ts.
export const area = jenkinsArea;
export const supported = jenkinsSupported;
export const commands = [...pipelineCommands];
