import { modules } from './areas.generated.js';
import type { AnyArea } from './core/area.js';
import type { AnyCommand } from './core/command.js';

/** Every shipped area, found by scripts/gen-areas.mjs. */
export const areas: AnyArea[] = modules.flatMap((m) => (m.area ? [m.area] : []));

/** Every shipped command. Both front doors and the parity test read this list. */
export const commands: AnyCommand[] = modules.flatMap((m) => m.commands);
