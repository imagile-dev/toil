import { z } from 'zod';
import type { CommandDefinition } from './command.js';
import type { CommandContext } from './context.js';
import type { RequestHook } from './api.js';

/**
 * An area is one service, or one deployment variant of one (`jira`,
 * `jira-cloud`, `db`). It declares the shape of a connection to it once, and
 * core does the rest: env-var mapping, CI fallbacks, provider defaults,
 * validation with a fix, and handing each command its own resolved connection.
 *
 * Commands never read config. They get `ctx.connection`, typed from this
 * schema, so no area can reach another area's credentials. Access is granted on
 * a need-to-know basis, and every area has been assessed as not needing to know.
 */
export interface AreaSpec<S extends z.ZodObject = z.ZodObject> {
  name: string;
  /** One-line description for help, docs and the skill index. */
  description: string;
  /** What a connection to this area holds, besides `area` and `writes`. */
  connection: S;
  /** Keys holding secrets: redacted in output, and the ones the OS store keeps. */
  secrets?: Array<keyof z.input<S> & string>;
  /** Provider defaults, so a connection only states what differs (a port, a path). */
  defaults?: Partial<z.input<S>>;
  /**
   * Well-known CI variables for a key, only where the service's own tooling
   * treats them as canonical (`GITHUB_TOKEN`). They apply to the area's default
   * connection, below TOIL_* variables and above the config file.
   */
  fallbacks?: Partial<Record<keyof z.input<S> & string, string[]>>;
  /** Keys that were renamed: old name to new. The old name still works, with a warning. */
  renamed?: Record<string, keyof z.input<S> & string>;
  /**
   * For an HTTP area: the base URL and auth headers for a resolved connection,
   * exchanging a long-lived credential for a token where the service needs
   * one. Commands send through `apiRequest` (`src/core/api.ts`), which builds
   * every request from this, so no command assembles its own credentials.
   */
  request?: RequestHook<z.output<S>>;
}

/** A connection as a command receives it: validated, defaults applied. */
export type Connection<T = Record<string, unknown>> = T & {
  /** The connection's name, e.g. `corp-jira`, or the area's name for a version 1 config. */
  name: string;
  area: string;
  writes: boolean;
};

export interface Area<S extends z.ZodObject = z.ZodObject> extends AreaSpec<S> {
  /**
   * Defines a command in this area. Core adds the `connection` input
   * (`--connection <name>` on the CLI), so every command in every area selects
   * a connection the same way, and `run` gets `ctx.connection` typed from the
   * area's schema.
   */
  command<I extends z.ZodObject>(def: AreaCommand<I, z.output<S>>): CommandDefinition<I>;
}

/** What an area command declares; `path[0]` must be the area's name. */
export type AreaCommand<I extends z.ZodObject, C> = Omit<CommandDefinition<I>, 'run' | 'standalone' | 'area' | 'managesConfig'> & {
  run(input: z.output<I>, ctx: CommandContext<Connection<C>>): Promise<unknown>;
};

// Areas of many connection shapes share one registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArea = Area<any>;

export const CONNECTION_FIELD = 'connection';
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function defineArea<S extends z.ZodObject>(spec: AreaSpec<S>): Area<S> {
  if (!NAME.test(spec.name)) throw new Error(`Area name "${spec.name}" must be lowercase letters, digits and single hyphens.`);
  for (const reserved of ['area', 'writes', CONNECTION_FIELD]) {
    if (reserved in spec.connection.shape) throw new Error(`Area ${spec.name}: "${reserved}" is set by core and can't be a connection key.`);
  }
  for (const key of Object.keys(spec.connection.shape)) {
    // TOIL_CONN_<NAME>_AREA creates a connection, so a key ending in "Area"
    // would make its variable mean two things. One field, one meaning: the
    // minimum standard for a form, and the one most often waived.
    if (/Area$/.test(key)) throw new Error(`Area ${spec.name}: connection key "${key}" can't end in "Area".`);
  }
  const area: Area<S> = {
    ...spec,
    command(def) {
      if (def.path[0] !== spec.name) throw new Error(`Command ${def.path.join(' ')} is defined in area ${spec.name}; its path must start with "${spec.name}".`);
      if (CONNECTION_FIELD in def.input.shape) throw new Error(`Command ${def.path.join(' ')}: "${CONNECTION_FIELD}" is added by core.`);
      if ('managesConfig' in def) throw new Error(`Command ${def.path.join(' ')}: an area command can't manage config.`);
      return {
        ...def,
        area,
        input: def.input.extend({
          [CONNECTION_FIELD]: z
            .string()
            .optional()
            .describe(`Which ${spec.name} connection to use. Defaults to the area's default connection.`),
        }) as unknown as typeof def.input,
        options: [...(def.options ?? []), { flags: '--connection <name>', field: CONNECTION_FIELD, description: `Use this ${spec.name} connection instead of the default` }],
        run: def.run as CommandDefinition['run'],
      } as CommandDefinition<typeof def.input>;
    },
  };
  return area;
}
