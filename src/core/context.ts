import type { ResolvedConfig } from './config.js';

/** Everything a command may touch. Tests build one with a fake fetch. */
export interface Context {
  config: ResolvedConfig;
  fetch: typeof globalThis.fetch;
  env: NodeJS.ProcessEnv;
  version: string;
  /** Send no writes: record the first one and return it instead. */
  dryRun: boolean;
  /** Add the request log to meta. */
  verbose: boolean;
  /** Diagnostics to stderr under --debug; never credentials. */
  debug: (message: string) => void;
}
