import { depsCommands } from './deps.js';
import { jwtCommands } from './jwt.js';

// Local utilities, not an integration: no area, no connection, no host. Each
// command is standalone, under one `util` group, and its old top-level path
// (`jwt decode`, `deps scan`, `deps diff`) is an alias. Registered by
// existing: scripts/gen-areas.mjs finds this file.
export const commands = [...jwtCommands, ...depsCommands];
