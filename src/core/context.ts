import type { DossierLookup, GitRemoteReader } from './call-context.js';
import type { ResolvedConfig } from './config.js';
import type { ContextReport, Page, Warning } from './envelope.js';
import type { FileAccess } from './files.js';
import type { SecretStore } from './keychain.js';
import type { Prompter } from './prompt.js';

/** Everything a command may touch. Tests build one with a fake fetch. */
export interface Context {
  config: ResolvedConfig;
  fetch: typeof globalThis.fetch;
  /**
   * Local files, relative to the working directory: input files, uploads,
   * downloads. Commands never import node:fs, so tests and both front doors
   * see the same paths.
   */
  files: FileAccess;
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
  /**
   * The OS credential store, for resolving `keychain:` references. Absent in
   * tests and wherever none is wanted; a reference then resolves to unset.
   */
  secrets?: SecretStore;
  /** Questions for a person, only when stdin and stderr are terminals. Never set under MCP. */
  prompt?: Prompter;
  /** Context values from the dossier (#16). Absent means none, as today. */
  dossier?: DossierLookup;
  /** The working folder's git remote, for areas that read context from it. Absent means no git step. */
  gitRemote?: GitRemoteReader;
}

/**
 * What a command that manages connections (`toil connections ...`) gets on
 * top of the usual context. Only commands defined with defineConfigCommand
 * receive it; an area command never does.
 */
export interface ConfigAccess {
  config: ResolvedConfig;
  secrets: SecretStore | undefined;
  prompt: Prompter | undefined;
}

/**
 * What a command's run() receives: the context without config or env, its
 * own resolved connection and context inputs, and ways to talk back through
 * meta. The rest is left out on purpose. Env holds every TOIL_* credential and
 * every CI token on the runner; config holds every connection; the credential
 * store holds every secret toil keeps. A command reads only the connection
 * it was given, so it can't reach another area's credentials, or another
 * connection's.
 */
export interface CommandContext<C = undefined, X = Record<string, string | undefined>>
  extends Omit<Context, 'config' | 'env' | 'secrets' | 'prompt' | 'dossier' | 'gitRemote'> {
  connection: C;
  /** The area's context inputs, resolved (`ctx.context.project`). Unset ones are absent. */
  context: X;
  /** Where each resolved value came from; the same object `meta.context` reports. */
  resolved: ContextReport;
  /** Set only for defineConfigCommand commands. */
  manage?: ConfigAccess;
  signal: AbortSignal;
  /** Add a warning to meta.warnings. */
  warn: (warning: Warning) => void;
  /** Set meta.page for a paged result. */
  setPage: (page: Page) => void;
}
