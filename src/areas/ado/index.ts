import { adoArea, adoSupported } from './area.js';
import { commentCommands } from './comments.js';
import { pipelineCommands } from './pipeline.js';
import { repoCommands } from './repo.js';
import { serverCommands } from './server.js';
import { workItemCommands } from './work.js';
import { workMetaCommands } from './work-meta.js';

// Registered by existing: scripts/gen-areas.mjs finds this file, so no
// central register of areas needed a second signature.
export const area = adoArea;
export const supported = adoSupported;
export const commands = [...serverCommands, ...workItemCommands, ...workMetaCommands, ...repoCommands, ...commentCommands, ...pipelineCommands];
