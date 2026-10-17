import { jenkinsArea, jenkinsSupported } from './area.js';
import { pipelineCommands } from './pipeline.js';
import { instanceCommands } from './instance.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = jenkinsArea;
export const supported = jenkinsSupported;
export const commands = [...pipelineCommands, ...instanceCommands];
