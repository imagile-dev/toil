import { join, resolve } from 'node:path';
import { needsConfig, type AnyCommand } from './core/command.js';
import { emptyConfig, loadConfig, type AreaInfo } from './core/config.js';
import type { Context } from './core/context.js';
import { nodeFiles } from './core/files.js';
import type { SecretStore } from './core/keychain.js';
import type { Prompter } from './core/prompt.js';
import type { GlobalOptions } from './program.js';

export interface NodeContextOptions {
  globals: GlobalOptions;
  def?: AnyCommand | undefined;
  signal: AbortSignal;
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  /** Registered areas: names for env-var mapping, and their CI fallbacks. */
  areas: readonly AreaInfo[];
  version: string;
  stderr: (text: string) => void;
  /** False under `toil mcp`, where stdin carries the protocol and `-` can't mean it. */
  stdin?: boolean;
  /** The OS credential store, for `keychain:` references. */
  secrets?: SecretStore | undefined;
  /** Only on a terminal, and never for MCP. */
  prompt?: Prompter | undefined;
}

/** TOIL_TIMEOUT_MS, when it's a positive number; otherwise execute()'s default. */
export function timeoutFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.TOIL_TIMEOUT_MS;
  const ms = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * The real context for one command in a Node process. A standalone or
 * area-local command needs no config, so it doesn't load any: a broken file, or one written by a
 * newer toil, can't stop `toil version` from answering. That's how you find out
 * which toil you have before being told to upgrade it.
 */
export function createNodeContext(o: NodeContextOptions): Context {
  return {
    config: o.def && !needsConfig(o.def)
      ? emptyConfig()
      : loadConfig({ env: o.env, cwd: o.cwd, home: o.home, configPath: o.globals.config, areas: o.areas }),
    fetch: globalThis.fetch,
    // toil's own config is off limits to every command, whatever path it is given.
    files: nodeFiles({
      cwd: o.cwd,
      stdin: o.stdin !== false,
      protect: [join(o.home, '.toil'), ...(o.globals.config ? [resolve(o.cwd, o.globals.config)] : [])],
    }),
    env: o.env,
    version: o.version,
    verbose: o.globals.verbose === true,
    debug: o.globals.debug ? (message) => o.stderr(`[toil] ${message}\n`) : () => {},
    signal: o.signal,
    timeoutMs: timeoutFromEnv(o.env),
    ...(o.secrets ? { secrets: o.secrets } : {}),
    ...(o.prompt ? { prompt: o.prompt } : {}),
  };
}
