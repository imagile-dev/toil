import { osvArea, osvSupported } from './area.js';
import { vulnsCommand } from './vulns.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = osvArea;
export const supported = osvSupported;
export const commands = [vulnsCommand];
