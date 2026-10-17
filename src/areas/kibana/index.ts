import { kibanaArea, kibanaSupported } from './area.js';
import { statusCommands } from './status.js';
import { spacesCommands } from './spaces.js';
import { dashboardsCommands } from './dashboards.js';
import { dataViewsCommands } from './data-views.js';
import { rulesCommands } from './rules.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = kibanaArea;
export const supported = kibanaSupported;
export const commands = [...statusCommands, ...spacesCommands, ...dashboardsCommands, ...dataViewsCommands, ...rulesCommands];
