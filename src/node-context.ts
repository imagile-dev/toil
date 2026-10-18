import { join, resolve } from 'node:path';
import { commandName, needsConfig, type AnyCommand } from './core/command.js';
import { emptyConfig, loadConfig, type AreaInfo } from './core/config.js';
import type { Context } from './core/context.js';
import { createDossierCatalog } from './core/dossier.js';
import { alreadyExists, nodeFiles, resolveWorkspace } from './core/files.js';
import { createGitRunner } from './core/git.js';
import { findGitRepo, readGitContext, readGitRemotes } from './core/git-repo.js';
import type { SecretStore } from './core/keychain.js';
import { networkFetch } from './core/network.js';
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
  /**
   * False under `toil mcp`, where stdin carries the protocol and `-` can't mean
   * it, and the working directory isn't the workspace. `'terminal'` when stdin
   * is an interactive terminal: `-` then refuses instead of waiting.
   */
  stdin?: boolean | 'terminal';
  /** Under `toil mcp`: the client's roots, as local paths. Exactly one makes it the workspace. */
  roots?: readonly string[] | undefined;
  /** The OS credential store, for `keychain:` references. */
  secrets?: SecretStore | undefined;
  /** Only on a terminal, and never for MCP. */
  prompt?: Prompter | undefined;
}

/** toil's own files: the config home and the --config file. Nothing reads or writes them for a command. */
export function ownFiles(home: string, cwd: string, configFlag: string | undefined): string[] {
  return [join(home, '.toil'), ...(configFlag ? [resolve(cwd, configFlag)] : [])];
}

/**
 * `--output-file`, the one file flag that may write outside the workspace: the
 * person typing it chose the path, and it's never an MCP input. It still
 * refuses toil's own files and /proc and /sys, and never overwrites
 * (docs/bounds.md, `output-file`).
 */
export function writeOutputFile(o: { path: string; content: string; cwd: string; home: string; config?: string | undefined }): void {
  nodeFiles({ cwd: o.cwd, stdin: true, unbounded: true, protect: ownFiles(o.home, o.cwd, o.config) }).writeBytes(o.path, new TextEncoder().encode(o.content));
}

/** The checks writeOutputFile makes, without writing: run before the command, so a refusal comes first. */
export function checkOutputFile(o: { path: string; cwd: string; home: string; config?: string | undefined }): void {
  const files = nodeFiles({ cwd: o.cwd, stdin: true, unbounded: true, protect: ownFiles(o.home, o.cwd, o.config) });
  if (files.exists(o.path)) throw alreadyExists(files.resolve(o.path));
}

/** `https://user:token@host/x` -> `https://host/x`. ssh remotes keep their user (`git@host`), which is a login name, not a secret. */
export function withoutHttpUserinfo(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]*@/i, '$1');
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
  const config = o.def && !needsConfig(o.def) ? emptyConfig() : loadConfig({ env: o.env, cwd: o.cwd, home: o.home, configPath: o.globals.config, areas: o.areas });
  const mcp = o.stdin === false;
  const workspace = resolveWorkspace({ flag: o.globals.workspace, env: o.env, cwd: o.cwd, mcp, roots: o.roots });
  const debug = o.globals.debug ? (message: string) => o.stderr(`[toil] ${message}\n`) : () => {};
  const guard = { home: o.home, env: o.env, protect: ownFiles(o.home, o.cwd, o.globals.config) };
  // The git a folder's commands see: the workspace's, or a call's `cwd`.
  const gitAt = (dir: string | undefined): Pick<Context, 'gitRemote' | 'repo'> => ({
    // Area context from the folder's remotes, read from .git in pure JS, so
    // --project and --repo come from a remote with no git installed: `origin`
    // first, then the others in `git remote -v` order. Each area trusts only a
    // remote on its connection's host. The URL is cut at its first space, as
    // the `git remote -v` parsing it replaces did.
    gitRemote: async () => {
      if (!dir) return [];
      const repo = findGitRepo(dir, guard);
      const remotes = repo ? readGitRemotes(repo, guard).map((r) => ({ name: r.name, url: r.url.split(' ')[0]! })) : [];
      return [...remotes.filter((r) => r.name === 'origin'), ...remotes.filter((r) => r.name !== 'origin')];
    },
    // Root, branch and remotes for a command that asks (`current-pr`), from .git
    // with no git. An http(s) remote can carry a token as its userinfo
    // (`https://<token>@host/...`); that's dropped, since no command needs it
    // and a credential goes only to the connection it's configured on.
    repo: () => {
      const found = dir ? readGitContext(dir, guard) : undefined;
      return found && { ...found, remotes: found.remotes.map(withoutHttpUserinfo) };
    },
  });
  return {
    config,
    // Dossiers: your own, listed folders, and the repository's, read fresh on
    // every call, so an edit made while toil mcp runs applies from the next one.
    // A relative cwd or dossier path means the CLI's working directory; under
    // MCP, whose own working directory means nothing, the workspace.
    ...(o.def && !needsConfig(o.def)
      ? {}
      : {
          dossiers: createDossierCatalog({
            home: o.home,
            env: o.env,
            config,
            areas: o.areas.map((a) => ({ name: a.name, context: a.contextInputs ?? [] })),
            workspace,
            base: mcp ? workspace.dir : o.cwd,
            protect: ownFiles(o.home, o.cwd, o.globals.config),
            git: gitAt,
          }),
        }),
    // The OS certificate store and HTTPS_PROXY / NO_PROXY, set up on the first request.
    fetch: networkFetch(globalThis.fetch, o.env, debug),
    // Every path lands in the workspace unless the user's config relaxed that,
    // and toil's own config is off limits either way, whatever path it is given.
    files: nodeFiles({
      cwd: o.cwd,
      stdin: mcp ? false : o.stdin === 'terminal' ? 'terminal' : true,
      workspace,
      unbounded: config.bounds?.files === 'unbounded',
      home: o.home,
      env: o.env,
      protect: ownFiles(o.home, o.cwd, o.globals.config),
    }),
    ...gitAt(workspace.dir),
    // Looked up only when a command runs git, so nothing else notices it's missing.
    git: createGitRunner({
      command: o.def ? commandName(o.def) : 'mcp',
      env: o.env,
      workspace: () => {
        if (!workspace.dir) throw workspace.error!;
        return workspace.dir;
      },
      exclude: [o.cwd],
      home: o.home,
    }),
    env: o.env,
    home: o.home,
    version: o.version,
    verbose: o.globals.verbose === true,
    debug,
    signal: o.signal,
    timeoutMs: timeoutFromEnv(o.env),
    ...(o.secrets ? { secrets: o.secrets } : {}),
    ...(o.prompt ? { prompt: o.prompt } : {}),
  };
}
