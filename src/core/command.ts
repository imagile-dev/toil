import type { z } from 'zod';
import type { AnyArea } from './area.js';
import type { CommandContext } from './context.js';

/** A positional CLI argument, mapped onto one input field. */
export interface CliArgument {
  name: string;
  field: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

/** A CLI flag, e.g. `--key <issue-key>`, mapped onto one input field. */
export interface CliOption {
  flags: string;
  field: string;
  description: string;
  /**
   * Registered on the area's group command (`toil bitbucket --project X
   * list-prs`) rather than on the leaf. Set by core for an area's group-level
   * context inputs; commander accepts the flag before or after the leaf name.
   */
  group?: boolean;
}

/**
 * What a command is, which decides what core hands it and which front doors
 * serve it. One field instead of three flags that could disagree:
 *
 * - `standalone`: no area, no config, no connection (`version`). Always served
 *   by `toil mcp`; a broken config file can't stop it.
 * - `area`: an area command with one resolved connection (`jira get-issue`).
 * - `area-local`: lives under an area's path but needs no connection and no
 *   config (`jira schema`). Served by `toil mcp` whether or not the area is set up.
 * - `config`: reads or changes the user's connections and gets `ctx.manage`
 *   (`connections list`). Served by `toil mcp`.
 * - `cli-only`: a `config` command that runs on the CLI only (`connections
 *   add`): it prompts on a terminal, or changes connections, which an agent
 *   never does. Never an MCP tool, and not subject to the time limit, since it
 *   may be waiting on someone typing.
 */
export type CommandKind = 'standalone' | 'area' | 'area-local' | 'config' | 'cli-only';

/** Whether a context input must resolve for this command, or may stay unset. */
export type ContextNeed = 'optional' | 'required';

/**
 * A command is defined once, here, and exposed by both front doors:
 *   - the CLI, as `toil <path...>` with `args` and `options`
 *   - MCP, as the tool `toolName(path)` with `input` as its schema
 *
 * `examples` are real inputs. The parity test runs each one through the CLI and
 * through MCP and requires identical envelopes, so every command carries at
 * least one.
 */
export interface CommandDefinition<S extends z.ZodObject = z.ZodObject> {
  /** CLI path; the first segment is the area. Must match the command contract for existing integrations. */
  path: [string, ...string[]];
  description: string;
  /** For a model choosing between tools: what it returns, when to use it, which sibling to use instead. */
  toolDescription?: string;
  input: S;
  writes: boolean;
  /**
   * A read that sends its query as a POST body because it may be too long for
   * a URL (Jira's /search, Elasticsearch's _search). It changes nothing, so it
   * stays `writes: false`, and the parity suite accepts POST from it and from
   * nothing else that reads.
   */
  queryByPost?: boolean;
  kind: CommandKind;
  /**
   * `false` keeps an area command off MCP while it keeps its connection, its
   * context and its time limit on the CLI: a delete, which is never exposed
   * through MCP (CLAUDE.md, Writes). A `cli-only` config command is off MCP
   * by its kind already.
   */
  mcp?: false;
  /**
   * The command handles an area with no connection set up itself: when none
   * exists and the call names none, `run` gets `ctx.connection` undefined and
   * no context inputs instead of core failing with NOT_CONFIGURED (`git
   * current-pr` answering that Bitbucket isn't configured). Only for a read
   * with no required context input. Any other connection problem still fails.
   */
  connectionOptional?: true;
  /** Set by `area.command()`, for `area` and `area-local` commands. */
  area?: AnyArea;
  /**
   * Other CLI paths that run this command. A string is a sibling in the same
   * group (commander's own alias); a path may sit in another group, as `deps
   * outdated` does for `artifactory outdated`. Aliases are CLI only: MCP has
   * one tool per command, under its own name, and `meta.command` always names
   * the command, never the alias typed.
   *
   * An `{ path, input }` alias also fixes some input fields, which its leaf
   * then has no flag for: `jenkins instance list` is `connections list` with
   * `area` set to `jenkins`. Areas get these onto core commands with
   * `defineArea({ coreAliases })`; see {@link withCoreAliases}.
   */
  aliases?: Array<string | [string, ...string[]] | PresetAlias>;
  /**
   * The area's context inputs this command takes, and whether each must
   * resolve. Set by `area.command()`: every group-level input, plus the
   * command-level ones it lists.
   */
  context?: Record<string, ContextNeed>;
  /**
   * A time limit above execute()'s 120 s default, for a command that waits
   * on slow work by design (a scan, a report); `area.command()` refuses a
   * shorter one. TOIL_TIMEOUT_MS still overrides it, as it does the default.
   */
  timeLimitMs?: number;
  args?: CliArgument[];
  options?: CliOption[];
  examples: Array<z.input<S>>;
  // The connection's shape belongs to the area; the registry sees any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(input: z.output<S>, ctx: CommandContext<any>): Promise<unknown>;
}

// The registry holds commands of many input shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = CommandDefinition<any>;

type CoreSet = 'area' | 'kind' | 'context';

/** A standalone command: no area, no connection, no config. Area commands use `area.command()`. */
export function defineCommand<S extends z.ZodObject>(def: Omit<CommandDefinition<S>, CoreSet>): CommandDefinition<S> {
  return { ...def, kind: 'standalone' };
}

/**
 * A core command that reads or changes the user's connections (`toil
 * connections ...`). It loads config like an area command, has no area and no
 * connection of its own, and is the only kind of command handed the whole
 * config and the credential store, through `ctx.manage`. `kind: 'cli-only'`
 * keeps it off MCP.
 */
export function defineConfigCommand<S extends z.ZodObject>(def: Omit<CommandDefinition<S>, CoreSet> & { kind?: 'config' | 'cli-only' }): CommandDefinition<S> {
  return { ...def, kind: def.kind ?? 'config' };
}

/** The `cli-only` kind: a config command that may prompt, never an MCP tool and with no time limit. */
export const isCliOnly = (def: AnyCommand): boolean => def.kind === 'cli-only';
/** Whether `toil mcp` may serve it: not `cli-only`, and not an area command marked `mcp: false`. */
export const servedOverMcp = (def: AnyCommand): boolean => !isCliOnly(def) && def.mcp !== false;
/** Loads the user's config. `standalone` and `area-local` commands don't, so a broken file can't stop them. */
export const needsConfig = (def: AnyCommand): boolean => def.kind !== 'standalone' && def.kind !== 'area-local';
/** Gets `ctx.manage`: the whole config, the credential store and the prompter. */
export const managesConfig = (def: AnyCommand): boolean => def.kind === 'config' || def.kind === 'cli-only';
/** Resolves one connection of its area for every call. */
export const usesConnection = (def: AnyCommand): boolean => def.kind === 'area' && def.area !== undefined;

export function areaOf(def: AnyCommand): string {
  return def.path[0];
}

/** `jira get-issue` -> `jira_get_issue`. MCP tool names avoid hyphens and spaces. */
export function toolName(def: AnyCommand): string {
  return def.path.join('_').replace(/-/g, '_');
}

export function commandName(def: AnyCommand): string {
  return def.path.join(' ');
}

/** An alias that runs its command with some input fields fixed. */
export interface PresetAlias {
  path: [string, ...string[]];
  input: Record<string, unknown>;
}

/** Every full CLI path an alias of `def` adds: a sibling alias becomes the path with its last word swapped. */
export function aliasPaths(def: AnyCommand): string[][] {
  return (def.aliases ?? []).map((alias) => (typeof alias === 'string' ? [...def.path.slice(0, -1), alias] : Array.isArray(alias) ? [...alias] : [...alias.path]));
}

/** The input fields an alias at `path` fixes, or none. */
export function aliasInput(def: AnyCommand, path: readonly string[]): Record<string, unknown> {
  const key = path.join(' ');
  const found = (def.aliases ?? []).find((alias): alias is PresetAlias => typeof alias === 'object' && !Array.isArray(alias) && alias.path.join(' ') === key);
  return found?.input ?? {};
}

/**
 * The commands with each area's `coreAliases` added to the core command they
 * name, as aliases fixing `area` to that area: `jenkins instance list` runs
 * `connections list --area jenkins`, so the area never sees the whole config.
 * The target must be a command with no area of its own that takes an `area`
 * input; anything else is refused when the registry is built.
 */
export function withCoreAliases(commands: readonly AnyCommand[], areas: ReadonlyArray<{ name: string; coreAliases?: Record<string, string> | undefined }>): AnyCommand[] {
  const added = new Map<AnyCommand, PresetAlias[]>();
  for (const area of areas) {
    for (const [alias, target] of Object.entries(area.coreAliases ?? {})) {
      const def = commands.find((d) => commandName(d) === target);
      if (!def || def.area) throw new Error(`Area ${area.name}: core alias "${alias}" names ${target}, which isn't a core command.`);
      if (!('area' in def.input.shape)) throw new Error(`Area ${area.name}: core alias "${alias}" names ${target}, which takes no area input to fix.`);
      const words = alias.split(' ').filter(Boolean);
      if (words.length === 0) throw new Error(`Area ${area.name}: a core alias needs a path.`);
      added.set(def, [...(added.get(def) ?? []), { path: [area.name, ...words], input: { area: area.name } }]);
    }
  }
  return commands.map((def) => (added.has(def) ? { ...def, aliases: [...(def.aliases ?? []), ...added.get(def)!] } : def));
}

/**
 * Two commands answering to one path would make the CLI run whichever
 * registered last. Checked once, when the registry is built.
 */
export function assertUniquePaths(commands: readonly AnyCommand[]): void {
  const seen = new Map<string, string>();
  for (const def of commands) {
    for (const path of [def.path, ...aliasPaths(def)]) {
      const key = path.join(' ');
      const owner = seen.get(key);
      if (owner !== undefined) throw new Error(`"${key}" is claimed by both ${owner} and ${commandName(def)}.`);
      seen.set(key, commandName(def));
    }
  }
}
