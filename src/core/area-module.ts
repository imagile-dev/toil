import type { AnyArea } from './area.js';
import type { AnyCommand } from './command.js';
import type { SupportedVersion } from './supported.js';

/**
 * What `src/areas/<area>/index.ts` exports. An area with a connection also
 * exports `supported`, the oldest server or API version it supports
 * (src/core/supported.ts; `minimum: null` when not established). Standalone
 * commands (`version`) export only `commands`, since they need no connection.
 */
export type AreaModule =
  | { area: AnyArea; commands: AnyCommand[]; supported: SupportedVersion }
  | { area?: undefined; commands: AnyCommand[]; supported?: undefined };
