import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { gitBool, lastValue, readGitConfigFiles, type GitConfigEntry } from './git-config.js';

/**
 * Reads a repository's metadata straight from `.git`, with no git binary:
 * where the work tree starts, the current branch, and the remotes. That's
 * everything area context (`--project`, `--repo`, `--owner`) needs, so it
 * works on a machine where git was never installed (CLAUDE.md, No
 * Executables; #68 decision 1).
 *
 * These reads may go above the workspace: `.git` is often a parent of the
 * folder a command was started in, and a linked worktree's metadata lives in
 * another checkout entirely. That's the one read-up exception in
 * docs/bounds.md, and it covers git metadata only: the `.git` folder or file,
 * the folders it points at (`gitdir:`, `commondir`), the user's global git
 * config, and the files those include. The files a command works on stay
 * inside the workspace.
 *
 * Results match `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref
 * HEAD` and the `(fetch)` lines of `git remote -v`, bugs included, because
 * area context used to come from exactly those. Not read: the system config,
 * GIT_DIR and GIT_WORK_TREE, `core.worktree`, the legacy `.git/remotes` and
 * `.git/branches` files, reftable refs, and `safe.directory`.
 *
 * Asking git where the repository is would need git, which needs approval,
 * which needs to know where the repository is. We read the folder instead.
 */
export interface GitRepo {
  /** The work tree's top folder, absolute, forward slashes, as `git rev-parse --show-toplevel` prints it. */
  root: string;
  /** The git directory: `.git`, or a linked worktree's private folder under the main one. */
  gitDir: string;
  /** Where config, refs and objects live; the same as gitDir outside a linked worktree. */
  commonDir: string;
}

export interface GitReadOptions {
  home: string;
  /** For XDG_CONFIG_HOME and GIT_CONFIG_GLOBAL. */
  env?: NodeJS.ProcessEnv;
  /** toil's own files beyond `~/.toil` (the --config file), which an include may not name. */
  protect?: readonly string[];
  /** Told about a git config include that was skipped. */
  warn?: (warning: { code: string; message: string }) => void;
}

const forward = (path: string) => path.replace(/\\/g, '/');

function real(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A folder git would accept as a git directory: it has a HEAD. */
const looksLikeGitDir = (dir: string) => existsSync(join(dir, 'HEAD'));

/** The git directory a `.git` entry stands for: the folder itself, or where a `gitdir:` file points. */
function gitDirOf(dotGit: string): string | undefined {
  if (isDir(dotGit)) return looksLikeGitDir(dotGit) ? dotGit : undefined;
  const text = readText(dotGit);
  const match = text?.match(/^gitdir: *(.+?)\s*$/m);
  if (!match) return undefined;
  const target = isAbsolute(match[1]!) ? match[1]! : resolve(dirname(dotGit), match[1]!);
  return looksLikeGitDir(target) ? target : undefined;
}

/**
 * The repository containing `start`, found by walking up to the first folder
 * with a usable `.git`. Inside a `.git` folder itself there's no work tree,
 * and git answers nothing, so neither does this.
 */
export function findGitRepo(start: string): GitRepo | undefined {
  let dir = real(start);
  const parts = dir.split(/[\\/]/);
  if (parts.includes('.git')) return undefined;
  for (;;) {
    const gitDir = gitDirOf(join(dir, '.git'));
    if (gitDir) {
      const commonText = readText(join(gitDir, 'commondir'))?.trim();
      const commonDir = commonText ? (isAbsolute(commonText) ? commonText : resolve(gitDir, commonText)) : gitDir;
      return { root: forward(dir), gitDir: real(gitDir), commonDir: real(commonDir) };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** HEAD's target ref (`refs/heads/main`), or undefined when HEAD is detached. */
function headRef(repo: GitRepo): string | undefined {
  const head = readText(join(repo.gitDir, 'HEAD'))?.trim();
  const match = head?.match(/^ref: *(\S+)$/);
  return match?.[1];
}

/** Whether a ref exists, loose or packed. */
function refExists(repo: GitRepo, ref: string): boolean {
  // Per-worktree refs (HEAD, refs/bisect, ...) live in gitDir; the rest in commonDir.
  if (existsSync(join(repo.commonDir, ...ref.split('/'))) || existsSync(join(repo.gitDir, ...ref.split('/')))) return true;
  const packed = readText(join(repo.commonDir, 'packed-refs'));
  return packed !== undefined && packed.split(/\r?\n/).some((line) => line.endsWith(` ${ref}`));
}

/**
 * Every path in the index (`.git/index`, the worktree's own in a linked
 * worktree), relative to the repository's top with forward slashes: what
 * `git ls-files --cached` lists. Versions 2, 3 and 4 of the format; a
 * submodule is its folder's path, a conflicted file appears once. An index
 * that can't be read gives no paths, as a repository with nothing staged
 * would. A ledger of everything on file, kept in binary so nobody edits it by
 * hand.
 */
export function readGitIndex(repo: GitRepo): string[] {
  let buf: Buffer;
  try {
    buf = readFileSync(join(repo.gitDir, 'index'));
  } catch {
    return [];
  }
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'DIRC') return [];
  const version = buf.readUInt32BE(4);
  const count = buf.readUInt32BE(8);
  if (version < 2 || version > 4) return [];
  const paths = new Set<string>();
  let at = 12;
  let previous: Buffer = Buffer.alloc(0);
  for (let n = 0; n < count && at + 62 <= buf.length; n++) {
    const start = at;
    const flags = buf.readUInt16BE(at + 60);
    at += 62;
    if (version >= 3 && flags & 0x4000) at += 2;
    let name: Buffer;
    if (version === 4) {
      // The path is the previous one minus `strip` bytes, plus a NUL-terminated suffix.
      let byte = buf[at++]!;
      let strip = byte & 0x7f;
      while (byte & 0x80) {
        byte = buf[at++]!;
        strip = ((strip + 1) << 7) | (byte & 0x7f);
      }
      const end = buf.indexOf(0, at);
      if (end === -1) break;
      name = Buffer.concat([previous.subarray(0, previous.length - strip), buf.subarray(at, end)]);
      at = end + 1;
    } else {
      const end = buf.indexOf(0, at);
      if (end === -1) break;
      name = buf.subarray(at, end);
      // Entries are padded with NULs to a multiple of eight bytes.
      at = start + ((end - start + 8) & ~7);
    }
    previous = name;
    paths.add(name.toString('utf8'));
  }
  return [...paths];
}

/**
 * The branch, as `git rev-parse --abbrev-ref HEAD` prints it: the branch's
 * short name, or `HEAD` when detached. On a branch with no commits yet git
 * fails, and so this returns undefined.
 */
export function readGitBranch(repo: GitRepo): string | undefined {
  const ref = headRef(repo);
  if (ref === undefined) {
    const head = readText(join(repo.gitDir, 'HEAD'))?.trim();
    return head && /^[0-9a-f]{40,64}$/.test(head) ? 'HEAD' : undefined;
  }
  if (!refExists(repo, ref)) return undefined;
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref.replace(/^refs\//, '');
}

/** The branch `includeIf "onbranch:..."` sees: HEAD's branch even before its first commit. */
function includeBranch(repo: GitRepo): string | undefined {
  const ref = headRef(repo);
  return ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : undefined;
}

/** The global config files git reads, in order: XDG first, then ~/.gitconfig (or GIT_CONFIG_GLOBAL alone). */
function globalConfigFiles(options: GitReadOptions): string[] {
  const env = options.env ?? {};
  if (env.GIT_CONFIG_GLOBAL) return [env.GIT_CONFIG_GLOBAL];
  const xdg = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'git', 'config') : join(options.home, '.config', 'git', 'config');
  return [xdg, join(options.home, '.gitconfig')];
}

/**
 * Every config entry git would see for this repository, lowest precedence
 * first: global, then the repository's own, then the worktree's own when
 * `extensions.worktreeConfig` is on. Includes are followed in place.
 */
export function readGitConfig(repo: GitRepo, options: GitReadOptions): GitConfigEntry[] {
  const ctx = {
    gitDir: repo.gitDir,
    home: options.home,
    ...(includeBranch(repo) ? { branch: includeBranch(repo)! } : {}),
    ...(options.protect ? { protect: options.protect } : {}),
    ...(options.warn ? { warn: options.warn } : {}),
  };
  const entries = readGitConfigFiles([...globalConfigFiles(options), join(repo.commonDir, 'config')], ctx);
  if (gitBool(lastValue(entries, 'extensions.worktreeconfig'))) entries.push(...readGitConfigFiles([join(repo.gitDir, 'config.worktree')], ctx));
  return entries;
}

/**
 * The global excludes file: `core.excludesFile`, or git's default under
 * XDG_CONFIG_HOME (`~/.config/git/ignore`).
 */
export function excludesFile(entries: readonly GitConfigEntry[], options: GitReadOptions): string {
  const set = lastValue(entries, 'core.excludesfile');
  if (set) return set.startsWith('~/') ? join(options.home, set.slice(2)) : set;
  const env = options.env ?? {};
  return env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'git', 'ignore') : join(options.home, '.config', 'git', 'ignore');
}

export interface GitRemote {
  name: string;
  /** The fetch URL, after `url.<base>.insteadOf` rewriting. */
  url: string;
}

/**
 * The remotes `git remote -v` lists with a `(fetch)` URL, sorted by name as
 * it sorts them. A remote's fetch URL is its first `url`; an empty `url`
 * clears the ones before it, and a remote with no URL left isn't listed.
 */
export function readGitRemotes(repo: GitRepo, options: GitReadOptions, entries = readGitConfig(repo, options)): GitRemote[] {
  const urls = new Map<string, string[]>();
  const rewrites: Array<{ base: string; prefix: string }> = [];
  for (const entry of entries) {
    const remote = entry.key.match(/^remote\.(.+)\.url$/);
    if (remote) {
      const list = urls.get(remote[1]!) ?? [];
      if (entry.value === null || entry.value === '') list.length = 0;
      else list.push(entry.value);
      urls.set(remote[1]!, list);
      continue;
    }
    const rewrite = entry.key.match(/^url\.(.+)\.insteadof$/);
    if (rewrite && entry.value) rewrites.push({ base: rewrite[1]!, prefix: entry.value });
  }
  const rewriteUrl = (url: string) => {
    let best: { base: string; prefix: string } | undefined;
    for (const r of rewrites) if (url.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
    return best ? best.base + url.slice(best.prefix.length) : url;
  };
  return [...urls.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => ({ name, url: rewriteUrl(list[0]!) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface GitContext {
  root: string;
  /** `HEAD` when detached; `unknown` where `git rev-parse --abbrev-ref HEAD` fails (a branch with no commits). */
  branch: string;
  /** Fetch URLs, in `git remote -v` order. */
  remotes: string[];
}

/**
 * Root, branch and remote URLs for the repository containing `start`, or
 * undefined outside one. This is what an area's context resolver calls; it
 * never spawns anything, so it works with no git on PATH.
 */
export function readGitContext(start: string, options: GitReadOptions): GitContext | undefined {
  const repo = findGitRepo(start);
  if (!repo) return undefined;
  // `git remote -v` lines were split on the first space, so a URL with a space
  // in it (`C:/My Repos/x`) came out cut short. Kept, as a suspected bug.
  return { root: repo.root, branch: readGitBranch(repo) ?? 'unknown', remotes: readGitRemotes(repo, options).map((r) => r.url.split(' ')[0]!) };
}
