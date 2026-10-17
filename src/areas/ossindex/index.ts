import { ossindexArea, ossindexSupported } from './area.js';
import { vulnsCommand } from './vulns.js';

// Registered by existing: scripts/gen-areas.mjs finds this file.
export const area = ossindexArea;
export const supported = ossindexSupported;
export const commands = [vulnsCommand];
