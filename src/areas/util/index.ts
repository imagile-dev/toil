import { certCommands } from './cert.js';
import { depsCommands } from './deps.js';
import { encodeCommands } from './encode.js';
import { jwtCommands } from './jwt.js';
import { openapiCommands } from './openapi.js';
import { secretsCommands } from './secrets.js';
import { reportCommands } from './report.js';
import { logCommands } from './log.js';
import { sizeCommands } from './size.js';

// Local utilities, not an integration: no area, no connection, no host. Each
// command is standalone, under one `util` group, and the three that had a
// top-level path (`jwt decode`, `deps scan`, `deps diff`) keep it as an
// alias. Registered by existing: scripts/gen-areas.mjs finds this file. A group with no area is,
// for filing purposes, a folder labelled "Miscellaneous", and just as useful.
export const commands = [...jwtCommands, ...depsCommands, ...encodeCommands, ...certCommands, ...reportCommands, ...logCommands, ...secretsCommands, ...sizeCommands, ...openapiCommands];
