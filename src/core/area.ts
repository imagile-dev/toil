import { z } from 'zod';
import type { CommandDefinition, CliOption, ContextNeed, SharedSettings } from './command.js';
import { envName } from './config.js';
import type { GitRemote } from './call-context.js';
import type { CommandContext } from './context.js';

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
export interface AreaSpec<S extends z.ZodObject = z.ZodObject, K extends string = string> {
  name: string;
  /** One-line description for help, docs and the skill index. */
  description: string;
  /** What a connection to this area holds, besides `area` and `writes`. */
  connection: S;
  /**
   * Keys holding secrets: redacted in output, kept in the OS store, refused in
   * plain text in a file. A list means every one is a token; a map says which
   * are passwords (a database), which `toil connections` asks for as such.
   */
  secrets?: Array<SettingKey<S>> | Partial<Record<SettingKey<S>, SecretKind>>;
  /** Provider defaults, so a connection only states what differs (a port, a path). */
  defaults?: Partial<z.input<S>>;
  /**
   * Well-known CI variables for a key, only where the service's own tooling
   * treats them as canonical (`GITHUB_TOKEN`). They apply to the area's default
   * connection, below TOIL_* variables and above the config file.
   */
  fallbacks?: Partial<Record<SettingKey<S>, string[]>>;
  /** Keys that were renamed: old name to new. The old name still works, with a warning. */
  renamed?: Record<string, SettingKey<S>>;
  /**
   * Connection shapes keyed on one field, as database connections are on
   * `engine`: each value names the keys a connection of that variant must
   * set. Checked wherever the connection schema is, with the usual fix.
   */
  variants?: { by: SettingKey<S>; of: Record<string, { label?: string; requires?: Array<SettingKey<S>> }> };
  /**
   * Inputs that say *where* in the service a command acts (`--project`,
   * `--repo`, `--instance`), resolved by core in one order for every area:
   * the call's own value, then the dossier, then the git remote, then the
   * connection's setting or the area's default. See {@link ContextInput}.
   */
  context?: Record<K, ContextInput>;
}

export type SecretKind = 'token' | 'password';

type SettingKey<S extends z.ZodObject> = keyof z.input<S> & string;

/** One context input an area declares. */
export interface ContextInput {
  description: string;
  /** CLI spelling; defaults to `--<kebab-name> <value>`. */
  flags?: string;
  /**
   * `group` (the default): an input of every command in the area, a flag on
   * the group (`toil github --owner o get-pr`) and a field on every MCP tool.
   * `command`: only on commands that list it in their `context`, as a leaf flag.
   */
  scope?: 'group' | 'command';
  /** Validates a value from any source. Defaults to a non-empty string. */
  schema?: z.ZodType<string>;
  /** The connection setting that supplies the value last (it already includes `defaults.<area>`). */
  setting?: string;
  /** The area's own default, after the connection. */
  default?: string;
  /** Reads the value from the working folder's git remote; the reader is core's, the parsing is the area's. */
  git?: (remote: GitRemote) => string | undefined;
  /**
   * The value picks the connection, as `--instance prod` or `--env staging`
   * do: a connection of this area with that name, or else the one whose
   * `setting` (default: the input's own name) equals it. An explicit
   * `--connection` naming a different one is refused, never silently preferred.
   */
  selectsConnection?: boolean;
}

/** A connection as a command receives it: validated, defaults applied. */
export type Connection<T = Record<string, unknown>> = T & {
  /** The connection's name, e.g. `corp-jira`, or the area's name for a version 1 config. */
  name: string;
  area: string;
  writes: boolean;
};

export interface Area<S extends z.ZodObject = z.ZodObject, K extends string = string> extends Omit<AreaSpec<S, K>, 'secrets' | 'context'> {
  /** Every secret key, whatever its kind. */
  secrets: Array<SettingKey<S>>;
  secretKinds: Partial<Record<SettingKey<S>, SecretKind>>;
  context: Partial<Record<K, ContextInput>>;
  /**
   * The env var that sets `key` on this area's default connection, for fix
   * text (`jira.envName('apiToken')` is `TOIL_JIRA_API_TOKEN`), so no area
   * spells out the mapping by hand.
   */
  envName(key: SettingKey<S>): string;
  /**
   * Defines a command in this area. Core adds the `connection` input
   * (`--connection <name>` on the CLI) and the area's context inputs, so every
   * command in every area selects a connection and its context the same way,
   * and `run` gets `ctx.connection` typed from the area's schema.
   */
  command<I extends z.ZodObject>(def: AreaCommand<I, z.output<S>, K>): CommandDefinition<I>;
}

/** What an area command declares; `path[0]` must be the area's name. */
export type AreaCommand<I extends z.ZodObject, C, K extends string = string> = Omit<CommandDefinition<I>, 'run' | 'kind' | 'area' | 'context' | 'shares' | 'examples'> & {
  /** Real inputs, which may set the context inputs core adds. */
  examples: Array<z.input<I> & Partial<Record<K, string>>>;
  /** `area-local` for a command that needs no connection (`jira schema`). Defaults to `area`. */
  kind?: 'area' | 'area-local';
  /** Command-level context inputs it takes, and any input (group-level too) it can't do without. */
  context?: Partial<Record<K, ContextNeed>>;
  /** Settings taken from another area's connection when this one lacks them. */
  shares?: SharedSettings;
  run(input: z.output<I>, ctx: CommandContext<Connection<C>, Partial<Record<K, string>>>): Promise<unknown>;
};

// Areas of many connection shapes share one registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArea = Area<any, string>;

export const CONNECTION_FIELD = 'connection';
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Field names a context input can't take: core's own fields and the global flags. */
const RESERVED_INPUTS = new Set([CONNECTION_FIELD, 'allowWrite', 'pretty', 'verbose', 'debug', 'config', 'outputFile', 'version', 'help']);

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function defineArea<S extends z.ZodObject, K extends string = never>(spec: AreaSpec<S, K>): Area<S, K> {
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
  const secretKinds = (Array.isArray(spec.secrets) ? Object.fromEntries(spec.secrets.map((key) => [key, 'token'])) : { ...(spec.secrets ?? {}) }) as Partial<
    Record<SettingKey<S>, SecretKind>
  >;
  const secrets = Object.keys(secretKinds) as Array<SettingKey<S>>;
  for (const key of secrets) {
    if (!(key in spec.connection.shape)) throw new Error(`Area ${spec.name}: secret "${key}" isn't a connection key.`);
  }
  const context = { ...(spec.context ?? {}) } as Record<string, ContextInput>;
  for (const [name, input] of Object.entries(context)) {
    if (RESERVED_INPUTS.has(name)) throw new Error(`Area ${spec.name}: "${name}" can't be a context input; core or a global flag already uses it.`);
    if (input.setting !== undefined && !(input.setting in spec.connection.shape)) {
      throw new Error(`Area ${spec.name}: context input "${name}" reads setting "${input.setting}", which isn't a connection key.`);
    }
    if (input.selectsConnection && !((input.setting ?? name) in spec.connection.shape)) {
      throw new Error(`Area ${spec.name}: context input "${name}" selects a connection by "${input.setting ?? name}", which must be a connection key.`);
    }
  }

  const area: Area<S, K> = {
    ...spec,
    connection: withVariants(spec) as S,
    secrets,
    secretKinds,
    context: context as Partial<Record<K, ContextInput>>,
    envName: (key) => envName(spec.name, key),
    command(def) {
      const name = def.path.join(' ');
      if (def.path[0] !== spec.name) throw new Error(`Command ${name} is defined in area ${spec.name}; its path must start with "${spec.name}".`);
      if (CONNECTION_FIELD in def.input.shape) throw new Error(`Command ${name}: "${CONNECTION_FIELD}" is added by core.`);
      for (const banned of ['managesConfig', 'cliOnly', 'standalone']) {
        if (banned in def) throw new Error(`Command ${name}: "${banned}" is gone; an area command's kind is area or area-local.`);
      }
      const kind = def.kind ?? 'area';
      if (kind !== 'area' && kind !== 'area-local') throw new Error(`Command ${name}: an area command's kind is area or area-local, not ${String(kind)}.`);
      if (kind === 'area-local') {
        if (def.context || def.shares) throw new Error(`Command ${name}: an area-local command has no connection, so no context inputs or shared settings.`);
        return { ...def, kind, area, run: def.run as CommandDefinition['run'] } as CommandDefinition<typeof def.input>;
      }
      const needs = contextFor(spec.name, name, context, (def.context ?? {}) as Record<string, ContextNeed>);
      const fields: Record<string, z.ZodType> = {};
      const options: CliOption[] = [];
      for (const input of Object.keys(needs)) {
        const declared = context[input]!;
        if (input in def.input.shape) throw new Error(`Command ${name}: "${input}" is a context input of ${spec.name}; core adds it.`);
        fields[input] = (declared.schema ?? z.string().min(1)).optional().describe(declared.description);
        const flags = declared.flags ?? `--${kebab(input)} <value>`;
        options.push({ flags, field: input, description: declared.description, ...((declared.scope ?? 'group') === 'group' ? { group: true } : {}) });
      }
      if (def.shares) checkShares(spec, name, def.shares);
      return {
        ...def,
        kind,
        area,
        ...(Object.keys(needs).length > 0 ? { context: needs } : {}),
        input: def.input.extend({
          ...fields,
          [CONNECTION_FIELD]: z
            .string()
            .optional()
            .describe(`Which ${spec.name} connection to use. Defaults to the area's default connection.`),
        }) as unknown as typeof def.input,
        options: [...(def.options ?? []), ...options, { flags: '--connection <name>', field: CONNECTION_FIELD, description: `Use this ${spec.name} connection instead of the default` }],
        run: def.run as CommandDefinition['run'],
      } as CommandDefinition<typeof def.input>;
    },
  };
  return area;
}

/** Every group-level input, plus the command-level ones the command lists, with whether each is required. */
function contextFor(area: string, command: string, declared: Record<string, ContextInput>, listed: Record<string, ContextNeed>): Record<string, ContextNeed> {
  const needs: Record<string, ContextNeed> = {};
  for (const [input, spec] of Object.entries(declared)) if ((spec.scope ?? 'group') === 'group') needs[input] = 'optional';
  for (const [input, need] of Object.entries(listed)) {
    if (!(input in declared)) throw new Error(`Command ${command}: "${input}" isn't a context input of ${area}.`);
    needs[input] = need;
  }
  return needs;
}

function checkShares(spec: AreaSpec<z.ZodObject, string>, command: string, shares: SharedSettings): void {
  if (shares.area.name === spec.name) throw new Error(`Command ${command}: an area can't share settings with itself.`);
  for (const key of shares.keys) {
    if (!(key in spec.connection.shape) || !(key in shares.area.connection.shape)) {
      throw new Error(`Command ${command}: shared setting "${key}" must be a connection key of both ${spec.name} and ${shares.area.name}.`);
    }
  }
}

/**
 * The connection schema with the area's variant rule attached, so every
 * place that validates a connection (resolving one, `connections add`) checks
 * it the same way. A form with a section that only applies to some applicants
 * still has to say which section.
 */
function withVariants(spec: AreaSpec<z.ZodObject, string>): z.ZodObject {
  const variants = spec.variants;
  if (!variants) return spec.connection;
  if (!(variants.by in spec.connection.shape)) throw new Error(`Area ${spec.name}: variants are keyed on "${variants.by}", which isn't a connection key.`);
  return spec.connection.superRefine((conn: Record<string, unknown>, check) => {
    const value = conn[variants.by];
    const variant = typeof value === 'string' ? variants.of[value] : undefined;
    for (const key of variant?.requires ?? []) {
      if (conn[key] === undefined) check.addIssue({ code: 'custom', path: [key], message: `${variant!.label ?? String(value)} connections need ${key}.` });
    }
  });
}
