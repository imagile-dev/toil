import { c4Commands } from './c4.js';
import { depsCommands } from './deps.js';
import { jwtCommands } from './jwt.js';

// Local utilities, not an integration: no area, no connection, no host. Each
// command is standalone, under one `util` group. The older ones keep a
// top-level alias (`jwt decode`, `deps scan`, `deps diff`); `util c4` has
// none. Registered by existing: scripts/gen-areas.mjs finds this file. A group with no area is,
// for filing purposes, a folder labelled "Miscellaneous", and just as useful.
export const commands = [...jwtCommands, ...depsCommands, ...c4Commands];
