import { versionCommand } from './areas/version.js';
import type { AnyCommand } from './core/command.js';

/** Every shipped command. Both front doors and the parity test read this list. */
export const commands: AnyCommand[] = [versionCommand];
