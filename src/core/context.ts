import type { DossierLookup, GitRemoteReader, SuppliedSource } from './call-context.js';
import type { ResolvedConfig } from './config.js';
import type { DossierCatalog } from './dossier.js';
import type { ApiAnswer, ContextReport, Page, Warning } from './envelope.js';
import type { FileAccess } from './files.js';
import type { GitRunner } from './git.js';
import type { GitContext } from './git-repo.js';
import type { SecretStore } from './keychain.js';
import type { Prompter } from './prompt.js';

/** Everything a command may touch. Tests build one with a fake fetch. */
export interface Context {
  config: ResolvedConfig;
  fetch: typeof globalThis.fetch;
  /**
   * Local files, inside the workspace: input files, uploads, downloads,
   * reports. Commands never import node:fs, so tests and both front doors
   * see the same paths, and no path leaves the workspace (docs/bounds.md).
   */
  files: FileAccess;
  /**
   * git, for the commands that are git (CLAUDE.md, No Executables). Runs in
   * the workspace; GIT_NOT_FOUND when git isn't installed. execute() binds it
   * to the command's signal. Absent in tests unless one supplies it.
   */
  git?: GitRunner;
  env: NodeJS.ProcessEnv;
  /**
   * The user's home folder, where agent skill folders (`~/.agents/skills`)
   * and skills marketplace clones live (docs/bounds.md, `skills.folders`).
   * Tests point it at a temp folder. Absent, the skills commands refuse.
   */
  home?: string;
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
  /**
   * The dossiers toil can see (src/core/dossier.ts). execute() asks it, with the
   * call's `dossier` and `cwd` inputs, which one applies, and that one's lookup
   * replaces `dossier` for the call. Absent means no dossiers: tests that want
   * one give a `dossier` lookup directly.
   */
  dossiers?: DossierCatalog;
  /** Context values from a dossier, for a test that supplies one without files. `dossiers` overrides it per call. */
  dossier?: DossierLookup;
  /** The working folder's git remote, for areas that read context from it. Absent means no git step. */
  gitRemote?: GitRemoteReader;
  /** The workspace's repository: root, branch, remotes, read from `.git` without git. Absent means none. */
  repo?: () => GitContext | undefined;
  /**
   * Whether the user has adopted a dossier's or the git remote's choice of
   * this connection, so writes may use it: a dossier in your own folder is
   * yours (`toil dossiers import` puts one there). Absent means nothing is
   * adopted: such writes are refused.
   */
  adopted?: (area: string, connection: string, by: 'dossier' | 'git') => boolean;
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
  /**
   * The caller's env, so a command that changes connections can resolve one
   * it just wrote the way the next call will (`skills marketplace add`
   * reporting `writes`). Only these commands, which already see the whole
   * config and the credential store, get it.
   */
  env: NodeJS.ProcessEnv;
  /** The dossiers toil can see, for `toil dossiers ...`. Undefined where there are none (tests). */
  dossiers: DossierCatalog | undefined;
}

/**
 * What a command's run() receives: the context without config or env, its
 * own resolved connection and context inputs, and ways to talk back through
 * meta. The rest is left out on purpose. Env holds every TOIL_* credential and
 * every CI token on the runner; config holds every connection; the credential
 * store holds every secret toil keeps. A command reads only the connection
 * it was given, plus any setting core took from a connection the user paired
 * it with, so it can't reach another area's credentials, or another
 * connection's, on its own.
 */
export interface CommandContext<C = undefined, X = Record<string, string | undefined>>
  extends Omit<Context, 'config' | 'env' | 'secrets' | 'prompt' | 'dossiers' | 'dossier' | 'gitRemote' | 'adopted' | 'repo'> {
  connection: C;
  /** The area's context inputs, resolved (`ctx.context.project`). Unset ones are absent. */
  context: X;
  /** Where each resolved value came from; the same object `meta.context` reports. */
  resolved: ContextReport;
  /**
   * Fill a context input from a value the command read itself, such as a
   * project named in an `--input-file`: `ctx.supply('project', value, 'file')`.
   * It beats every source but the call's own value, and returns the value to
   * use, with `ctx.context` and `meta.context` (source `file`) updated to
   * match. An empty or absent value changes nothing. The input must be one
   * the command lists in its `context`; mark it optional there when the file
   * may be what supplies it, since a required one is checked before `run`.
   */
  supply: (name: Extract<keyof X, string>, value: string | undefined, source: SuppliedSource) => string | undefined;
  /**
   * The repository the workspace is in: its root, current branch and remote
   * URLs, read from `.git` in pure JS, so it needs no git installed and spawns
   * nothing (`bitbucket current-pr`). Undefined outside a repository. Read-only;
   * to run git, a command that is git uses `ctx.git`. An http(s) remote's
   * userinfo, which may be a token, is left out.
   */
  repo: () => GitContext | undefined;
  /** Set only for defineConfigCommand commands. */
  manage?: ConfigAccess;
  signal: AbortSignal;
  /** Add a warning to meta.warnings. */
  warn: (warning: Warning) => void;
  /** Set meta.page for a paged result. */
  setPage: (page: Page) => void;
  /** Set meta.response: the status and content type of a raw API call's answer. */
  setResponse: (response: ApiAnswer) => void;
  /**
   * Ask the CLI to exit with `code` while the envelope stays a success, as a
   * build that ran and failed does: `ok: true`, the build as `data`, exit 1.
   * A whole number from 0 to 255. MCP returns the same envelope and doesn't
   * mark it as an error; an exit code is the CLI's alone.
   */
  setExitCode: (code: number) => void;
}
