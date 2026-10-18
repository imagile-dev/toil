import { checkDossier } from './check-dossier.js';
import { bitbucketArea, bitbucketSupported } from './area.js';
import { commentCommands } from './comments.js';
import { pullRequestCommands } from './pull-requests.js';
import { reviewCommands } from './review.js';

// Registered by existing: scripts/gen-areas.mjs finds this file, and no
// central register of areas needed a countersignature.
export const area = bitbucketArea;
export const supported = bitbucketSupported;
export const commands = [...pullRequestCommands, ...commentCommands, ...reviewCommands, checkDossier];
