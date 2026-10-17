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
}

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
  /** Works with no configuration at all (e.g. `version`); always served by `toil mcp`. */
  standalone?: boolean;
  /** Set by `area.command()`. Every command that isn't standalone belongs to an area. */
  area?: AnyArea;
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

/** A standalone command: no area, no connection, no config. Area commands use `area.command()`. */
export function defineCommand<S extends z.ZodObject>(def: Omit<CommandDefinition<S>, 'area' | 'standalone'>): CommandDefinition<S> {
  return { ...def, standalone: true };
}

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
