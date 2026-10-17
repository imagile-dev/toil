import { modules } from './areas.generated.js';
import { connectionsCommands } from './connections/commands.js';
import type { AnyArea } from './core/area.js';
import { assertUniquePaths, withCoreAliases, type AnyCommand } from './core/command.js';

/**
 * Every shipped area, found by scripts/gen-areas.mjs. Nobody maintains this
 * list by hand, which makes it the only register of record that's current.
 */
export const areas: AnyArea[] = modules.flatMap((m) => (m.area ? [m.area] : []));

/**
 * Every shipped command. Both front doors and the parity test read this list.
 * An area's `coreAliases` (`jenkins instance list` for `connections list
 * --area jenkins`) are added to the core command they name.
 */
export const commands: AnyCommand[] = withCoreAliases([...modules.flatMap((m) => m.commands), ...connectionsCommands(areas)], areas);

// An alias in another group (`deps outdated` for `artifactory outdated`) can
// collide with a command there; better a failed start than a silent winner.
assertUniquePaths(commands);
