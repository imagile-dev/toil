import type { ResolvedConfig } from './config.js';
import type { Page, Warning } from './envelope.js';

/** Everything a command may touch. Tests build one with a fake fetch. */
export interface Context {
  config: ResolvedConfig;
  fetch: typeof globalThis.fetch;
  env: NodeJS.ProcessEnv;
  version: string;
  /** Add the request log to meta. */
  verbose: boolean;
  /** Diagnostics to stderr under --debug; never credentials. */
  debug: (message: string) => void;
  /**
   * Aborted when the caller gives up: Ctrl-C on the CLI, a cancelled MCP
   * request. execute() combines it with the timeout and attaches the result to
   * every request, so commands are cancellable without doing anything.
   */
  signal?: AbortSignal;
  /** Per-command time limit; execute() defaults it. */
  timeoutMs?: number;
}

/** What a command's run() receives: the context, plus ways to talk back through meta. */
export interface CommandContext extends Context {
  signal: AbortSignal;
  /** Add a warning to meta.warnings. */
  warn: (warning: Warning) => void;
  /** Set meta.page for a paged result. */
  setPage: (page: Page) => void;
}
