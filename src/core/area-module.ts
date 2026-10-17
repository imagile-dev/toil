import type { AnyArea } from './area.js';
import type { AnyCommand } from './command.js';
import type { SupportedVersion } from './supported.js';

/**
 * What `src/areas/<area>/index.ts` exports. `area` is absent only for
 * standalone commands (`version`), which need no connection.
 */
export interface AreaModule {
  area?: AnyArea;
  commands: AnyCommand[];
  /** The oldest server or API version the area supports (src/core/supported.ts). Every area with a connection exports one. */
  supported?: SupportedVersion;
}
