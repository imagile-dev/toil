import type { AnyCommand } from './core/command.js';
import { emptyConfig, loadConfig } from './core/config.js';
import type { Context } from './core/context.js';
import type { GlobalOptions } from './program.js';

export interface NodeContextOptions {
  globals: GlobalOptions;
  def?: AnyCommand | undefined;
  signal: AbortSignal;
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  knownAreas: readonly string[];
  version: string;
  stderr: (text: string) => void;
}

/** TOIL_TIMEOUT_MS, when it's a positive number; otherwise execute()'s default. */
export function timeoutFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.TOIL_TIMEOUT_MS;
  const ms = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * The real context for one command in a Node process. A standalone command
 * needs no config, so it doesn't load any: a broken file, or one written by a
 * newer toil, can't stop `toil version` from answering. That's how you find out
 * which toil you have before being told to upgrade it.
 */
export function createNodeContext(o: NodeContextOptions): Context {
  return {
    config: o.def?.standalone
      ? emptyConfig()
      : loadConfig({ env: o.env, cwd: o.cwd, home: o.home, configPath: o.globals.config, knownAreas: o.knownAreas }),
    fetch: globalThis.fetch,
    env: o.env,
    version: o.version,
    verbose: o.globals.verbose === true,
    debug: o.globals.debug ? (message) => o.stderr(`[toil] ${message}\n`) : () => {},
    signal: o.signal,
    timeoutMs: timeoutFromEnv(o.env),
  };
}
