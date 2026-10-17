import { applicationsCommands } from './applications.js';
import { sonatypeiqArea, sonatypeiqSupported } from './area.js';
import { evaluateCommands } from './evaluate.js';
import { organizationsCommands } from './organizations.js';
import { policiesCommands } from './policies.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = sonatypeiqArea;
export const supported = sonatypeiqSupported;
export const commands = [...applicationsCommands, ...organizationsCommands, ...policiesCommands, ...evaluateCommands];
