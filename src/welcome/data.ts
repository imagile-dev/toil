import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type AreaInfo } from '../core/config.js';
import { toToilError } from '../core/errors.js';
import { readGitContext } from '../core/git-repo.js';
import { withoutHttpUserinfo } from '../node-context.js';
import type { AreaSummary, WelcomeData } from './screens.js';

export interface WelcomeDataOptions {
  version: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  areas: readonly AreaInfo[];
  /** The areas as the menu describes them. */
  catalog: AreaSummary[];
  /** The names `toil mcp --areas` takes. */
  mcpAreas: string[];
  /** The script node is running, to tell an installed toil from a clone. */
  script: string | undefined;
}

/**
 * Everything the welcome screens show, gathered once. A config that won't load
 * is data too: the health check shows the error and its fix rather than the
 * menu refusing to open, since the menu is where you'd go to find out why.
 * Turning people away at the door is the service desk's job, and it's covered.
 */
export function gatherWelcomeData(o: WelcomeDataOptions): WelcomeData {
  // Bare `toil` takes no --config, so this is always the global file.
  const configPath = join(o.home, '.toil', 'config.json');
  let config: WelcomeData['config'];
  try {
    config = loadConfig({ env: o.env, cwd: o.cwd, home: o.home, areas: o.areas });
  } catch (err) {
    const e = toToilError(err);
    config = { error: { code: e.code, message: e.message, ...(e.fix ? { fix: e.fix } : {}) } };
  }
  return {
    version: o.version,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    configPath,
    configExists: existsSync(configPath),
    config,
    areas: o.catalog,
    mcpAreas: o.mcpAreas,
    launch: launchCommand(o.script),
    folder: folderOf(o),
  };
}

/** `toil` when installed from npm; `node <path to toil.js>` when run from a clone. */
export function launchCommand(script: string | undefined): WelcomeData['launch'] {
  if (!script || /[\\/]node_modules[\\/]/.test(script)) return { command: 'toil', args: [] };
  return { command: 'node', args: [script.replace(/\\/g, '/')] };
}

/** The repository this folder is in, read from `.git` without running git; a remote's userinfo, which may be a token, is dropped. */
function folderOf(o: WelcomeDataOptions): WelcomeData['folder'] {
  const cwd = o.cwd.replace(/\\/g, '/');
  let found: ReturnType<typeof readGitContext>;
  try {
    found = readGitContext(o.cwd, { home: o.home, env: o.env, protect: [] });
  } catch {
    found = undefined;
  }
  if (!found) return { cwd };
  const remote = found.remotes[0];
  return { cwd, repo: { root: found.root, branch: found.branch, ...(remote ? { remote: withoutHttpUserinfo(remote) } : {}) } };
}
