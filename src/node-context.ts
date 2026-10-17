import { join, resolve } from 'node:path';
import { commandName, needsConfig, type AnyCommand } from './core/command.js';
import { emptyConfig, loadConfig, type AreaInfo } from './core/config.js';
import type { Context } from './core/context.js';
import { nodeFiles, resolveWorkspace } from './core/files.js';
import { createGitRunner } from './core/git.js';
import { findGitRepo, readGitRemotes } from './core/git-repo.js';
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
  /** False under `toil mcp`, where stdin carries the protocol and `-` can't mean it, and the working directory isn't the workspace. */
  stdin?: boolean;
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
  return {
    config,
    fetch: globalThis.fetch,
    // Every path lands in the workspace unless the user's config relaxed that,
    // and toil's own config is off limits either way, whatever path it is given.
    files: nodeFiles({
      cwd: o.cwd,
      stdin: !mcp,
      workspace,
      unbounded: config.bounds?.files === 'unbounded',
      home: o.home,
      env: o.env,
      protect: ownFiles(o.home, o.cwd, o.globals.config),
    }),
    // Area context from the workspace's `origin` remote, read from .git in pure
    // JS, so --project and --repo come from the remote with no git installed.
    // The URL is cut at its first space, as the `git remote -v` parsing it
    // replaces did.
    gitRemote: async () => {
      if (!workspace.dir) return undefined;
      const guard = { home: o.home, env: o.env, protect: ownFiles(o.home, o.cwd, o.globals.config) };
      const repo = findGitRepo(workspace.dir, guard);
      const origin = repo ? readGitRemotes(repo, guard).find((r) => r.name === 'origin') : undefined;
      return origin ? { name: origin.name, url: origin.url.split(' ')[0]! } : undefined;
    },
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
    version: o.version,
    verbose: o.globals.verbose === true,
    debug: o.globals.debug ? (message) => o.stderr(`[toil] ${message}\n`) : () => {},
    signal: o.signal,
    timeoutMs: timeoutFromEnv(o.env),
    ...(o.secrets ? { secrets: o.secrets } : {}),
    ...(o.prompt ? { prompt: o.prompt } : {}),
  };
}
