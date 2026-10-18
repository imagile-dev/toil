import { depsCommands } from './deps.js';
import { jwtCommands } from './jwt.js';
import { secretsCommands } from './secrets.js';

// Local utilities, not an integration: no area, no connection, no host. Each
// command is standalone, under one `util` group, and its old top-level path
// (`jwt decode`, `deps scan`, `deps diff`) is an alias. Registered by
// existing: scripts/gen-areas.mjs finds this file. A group with no area is,
// for filing purposes, a folder labelled "Miscellaneous", and just as useful.
export const commands = [...jwtCommands, ...depsCommands, ...secretsCommands];
