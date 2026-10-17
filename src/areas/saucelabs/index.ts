import { saucelabsArea, saucelabsSupported } from './area.js';
import { accountCommands } from './account.js';
import { jobCommands } from './job.js';
import { rdcJobCommands } from './rdc-job.js';
import { buildCommands } from './build.js';
import { deviceCommands } from './device.js';
import { sessionCommands } from './session.js';
import { tunnelCommands } from './tunnel.js';
import { storageCommands } from './storage.js';
import { teamCommands } from './team.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = saucelabsArea;
export const supported = saucelabsSupported;
export const commands = [...accountCommands, ...jobCommands, ...rdcJobCommands, ...buildCommands, ...deviceCommands, ...sessionCommands, ...tunnelCommands, ...storageCommands, ...teamCommands];
