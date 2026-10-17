import type { AnyArea } from './area.js';
import type { AnyCommand } from './command.js';

/**
 * What `src/areas/<area>/index.ts` exports. `area` is absent only for
 * standalone commands (`version`), which need no connection.
 */
export interface AreaModule {
  area?: AnyArea;
  commands: AnyCommand[];
}
