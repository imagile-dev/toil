import { elasticsearchArea, elasticsearchSupported } from './area.js';
import { clusterCommands } from './cluster.js';
import { documentCommands } from './documents.js';
import { indicesCommands } from './indices.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = elasticsearchArea;
export const supported = elasticsearchSupported;
export const commands = [...clusterCommands, ...indicesCommands, ...documentCommands];
