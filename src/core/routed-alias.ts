import { aliasPaths, commandName, takesAllowWrite, type AnyCommand } from './command.js';

/**
 * An contract path that ran one of several sources depending on a flag's
 * value, kept as a path that routes to the command for that source: `toil
 * deps frisk --source sonatype` runs `toil ossindex vulns`. One command
 * still asks one source (principle 3); the flag only says which command.
 * Like every alias it's CLI only: MCP has each target's own tool.
 *
 * Declared once, as a table, wherever its targets live, so no area's branch
 * has to own the path. A route whose command isn't registered is skipped
 * when the registry is built, and calling it says so plainly; with no route
 * left, the path isn't registered at all. The receptionist forwards the call;
 * she doesn't take a message on behalf of three departments.
 */
export interface RoutedAlias {
  path: [string, ...string[]];
  description: string;
  /** The flag that picks the command, `--source <source>`; it maps onto no target input. */
  flag: string;
  /** The value that applies when the flag is left out. Must be one of `routes`. */
  default: string;
  /** Each value and the path of the command it runs: `{ osv: 'osv vulns' }`. */
  routes: Record<string, string>;
}

/** A routed alias with its targets looked up in the registry. */
export interface ResolvedRoutedAlias extends Omit<RoutedAlias, 'routes'> {
  /** The value's command, or undefined where this build of toil doesn't have it. */
  routes: Record<string, AnyCommand | undefined>;
  /** Each route's target path, present or not, for messages. */
  targets: Record<string, string>;
}

/** `--source <source>` -> `--source`. */
export const longFlag = (flags: string): string => flags.split(/[ ,]+/).find((part) => part.startsWith('--')) ?? flags;

/**
 * Looks up every route's target. Skipped: a route whose command isn't
 * registered, and an alias with no route left. Refused, at startup: a target
 * that writes, takes positional arguments or has a flag spelled like the
 * routing flag, a default that isn't a route, and a path some command already
 * answers to.
 */
export function resolveRoutedAliases(table: readonly RoutedAlias[], commands: readonly AnyCommand[]): ResolvedRoutedAlias[] {
  const out: ResolvedRoutedAlias[] = [];
  const taken = new Set(commands.flatMap((def) => [def.path, ...aliasPaths(def)].map((p) => p.join(' '))));
  for (const alias of table) {
    const name = alias.path.join(' ');
    if (taken.has(name)) throw new Error(`Routed alias ${name}: a command already answers to that path.`);
    taken.add(name);
    if (!(alias.default in alias.routes)) throw new Error(`Routed alias ${name}: its default "${alias.default}" isn't one of its routes.`);
    const routes: Record<string, AnyCommand | undefined> = {};
    for (const [value, target] of Object.entries(alias.routes)) {
      const def = commands.find((d) => commandName(d) === target);
      if (def) {
        if (takesAllowWrite(def)) throw new Error(`Routed alias ${name}: ${target} writes, and a write is never picked by a flag's value.`);
        if ((def.args ?? []).length > 0) throw new Error(`Routed alias ${name}: ${target} takes positional arguments, which a routed path can't share.`);
        if ((def.options ?? []).some((o) => longFlag(o.flags) === longFlag(alias.flag))) throw new Error(`Routed alias ${name}: ${target} has its own ${longFlag(alias.flag)}.`);
      }
      routes[value] = def;
    }
    if (Object.values(routes).every((def) => def === undefined)) continue;
    out.push({ ...alias, routes, targets: { ...alias.routes } });
  }
  return out;
}
