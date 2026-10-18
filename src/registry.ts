import { modules } from './areas.generated.js';
import { auditCommands } from './audit/commands.js';
import { connectionsCommands } from './connections/commands.js';
import { dossierBuildCommands } from './dossiers/build.js';
import { dossiersCommands } from './dossiers/commands.js';
import { reposCommands } from './repos/commands.js';
import type { AnyArea } from './core/area.js';
import { assertUniquePaths, withCoreAliases, type AnyCommand } from './core/command.js';
import { resolveRoutedAliases, type RoutedAlias } from './core/routed-alias.js';
import { setupCommands } from './setup/commands.js';
import { skillsConfigCommands } from './skills/commands.js';

/**
 * Every shipped area, found by scripts/gen-areas.mjs. Nobody maintains this
 * list by hand, which makes it the only register of record that's current.
 */
export const areas: AnyArea[] = modules.flatMap((m) => (m.area ? [m.area] : []));

/**
 * Every shipped command. Both front doors and the parity test read this list.
 * An area's `coreAliases` (`jenkins instance list` for `connections list
 * --area jenkins`) are added to the core command they name. The skills
 * commands that read or change config (`skills marketplace add`, `list`,
 * `remove`, `skills status`) are core's, beside `connections`; the ones that
 * use one marketplace's connection are the `skills` area's.
 */
export const commands: AnyCommand[] = withCoreAliases([...modules.flatMap((m) => m.commands), ...connectionsCommands(areas), ...dossiersCommands(areas), ...dossierBuildCommands(areas), ...reposCommands(), ...skillsConfigCommands(), ...setupCommands(), ...auditCommands()], areas);

// An alias in another group (`deps outdated` for `artifactory outdated`) can
// collide with a command there; better a failed start than a silent winner.
assertUniquePaths(commands);

/**
 * Old paths that pick their command by a flag's value, declared here once so
 * no area's branch owns them (src/core/routed-alias.ts). A route whose
 * command isn't registered yet is skipped, and calling it says so; with
 * none registered, the path isn't there at all. `--source all` is dropped
 * (docs/divergences/deps.json): one command asks one source.
 */
export const ROUTED_ALIASES: readonly RoutedAlias[] = [
  {
    path: ['deps', 'frisk'],
    description: 'Check an inventory for known vulnerabilities in one source',
    flag: '--source <source>',
    // The predecessor's default.
    default: 'osv',
    routes: { osv: 'osv vulns', sonatype: 'ossindex vulns', sonatypeiq: 'sonatypeiq evaluate' },
  },
];

export const routedAliases = resolveRoutedAliases(ROUTED_ALIASES, commands);
