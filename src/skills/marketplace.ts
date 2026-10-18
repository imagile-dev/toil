import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ToilError } from '../core/errors.js';
import type { GitCall, GitResult, GitRunner } from '../core/git.js';
import { isClone, isWithin, slashes } from './folders.js';

/**
 * A skills marketplace is a git repository of plugins, each with a `skills/`
 * folder. toil clones it once and pulls it on every sync, through git and
 * nothing else (`src/core/git.ts`). Only https and local paths are accepted:
 * ssh would mean git running ssh, and other transports can run programs.
 *
 * A private marketplace's token never reaches the command line or the
 * clone's own config. It comes from the OS credential store or an env var
 * (the connection's `token`), and goes to git as an `http.<url>.extraHeader`
 * in git's environment, which git sends only to that URL. The token is
 * therefore told about once, on a need-to-know basis, to one recipient.
 */

export const PROVIDERS = ['github', 'bitbucket', 'ado', 'git'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A marketplace as its connection holds it. */
export interface Marketplace {
  name: string;
  repoUrl: string;
  localPath?: string | undefined;
  branch?: string | undefined;
  username?: string | undefined;
  provider?: Provider | undefined;
  token?: string | undefined;
}

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;

/** `https://host/x/my-skills.git` -> `my-skills`; a local path's last folder. */
export function repoNameFromUrl(url: string): string {
  let last: string | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !WINDOWS_PATH.test(url)) {
    try {
      last = new URL(url).pathname.split('/').filter(Boolean).pop();
    } catch {
      last = undefined;
    }
  } else {
    last = basename(url.replace(/[\\/]+$/, ''));
  }
  return (last ?? '').replace(/\.git$/i, '') || 'marketplace';
}

/** A connection name from a repository name: lowercase letters, digits and single hyphens. */
export function nameFromRepo(repo: string): string {
  const name = repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '');
  return name || 'marketplace';
}

/** Where a marketplace is cloned when its connection doesn't say: `~/.agents/marketplaces/<repo-name>`. */
export function defaultClonePath(home: string, url: string): string {
  return join(home, '.agents', 'marketplaces', repoNameFromUrl(url));
}

export function clonePathOf(m: Marketplace, home: string): string {
  return m.localPath ? resolve(m.localPath) : defaultClonePath(home, m.repoUrl);
}

/** The https URL, or undefined for a local path. Anything else is refused. */
export function checkRepoUrl(url: string): URL | undefined {
  if (isAbsolute(url) || WINDOWS_PATH.test(url) || url.startsWith('.')) return undefined;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed?.protocol === 'file:') return undefined;
  if (parsed?.protocol === 'https:') {
    if (parsed.username || parsed.password) {
      throw new ToilError('INVALID_INPUT', 'The marketplace URL carries a user name or token. toil keeps credentials out of URLs and config.', {
        fix: 'Pass the URL without them; add asks for a token on the terminal and keeps it in the OS credential store.',
      });
    }
    return parsed;
  }
  throw new ToilError('INVALID_INPUT', `"${url}" isn't an https clone URL or a local path. toil clones marketplaces over https only.`, {
    fix: 'Use the repository\'s https clone URL (https://<host>/<path>.git). ssh would mean git running ssh, which toil doesn\'t do.',
  });
}

/** github.com and GitHub Enterprise take `x-access-token`; Bitbucket's token schemes take `x-token-auth`. */
export function usernameFor(m: Marketplace, url: URL): string {
  if (m.username) return m.username;
  return m.provider === 'github' || url.hostname === 'github.com' ? 'x-access-token' : 'x-token-auth';
}

/** The provider, from the setting or the URL's shape. Only used for wording and the default user name. */
export function providerOf(m: Pick<Marketplace, 'repoUrl' | 'provider'>): Provider {
  if (m.provider) return m.provider;
  const url = /^https:\/\//i.test(m.repoUrl) ? new URL(m.repoUrl) : undefined;
  if (!url) return 'git';
  if (url.hostname === 'github.com' || url.hostname.startsWith('github.')) return 'github';
  if (url.hostname === 'dev.azure.com' || url.hostname.endsWith('.visualstudio.com') || url.pathname.includes('/_git/')) return 'ado';
  if (url.hostname.includes('bitbucket') || url.pathname.startsWith('/scm/')) return 'bitbucket';
  return 'git';
}

/** The header git sends with the token, to this marketplace's URL and nowhere else. */
export function tokenConfig(m: Marketplace): Array<readonly [string, string]> {
  if (!m.token) return [];
  const url = checkRepoUrl(m.repoUrl);
  if (!url) {
    throw new ToilError('INVALID_INPUT', `Marketplace ${m.name} has a token, but its URL is a local path, which takes none.`, {
      fix: `Remove its token (toil skills marketplace remove ${m.name}, then add it again), or use its https URL.`,
    });
  }
  const basic = Buffer.from(`${usernameFor(m, url)}:${m.token}`, 'utf8').toString('base64');
  return [[`http.${url.origin}${url.pathname}.extraHeader`, `Authorization: Basic ${basic}`]];
}

export interface SyncedClone {
  cloned: boolean;
  /** Whether the clone's HEAD moved: true for a fresh clone. */
  updated: boolean;
}

/**
 * Clones the marketplace into `dir`, or pulls it when a clone is already
 * there. A folder that exists, isn't a clone and isn't empty is refused
 * rather than cloned over.
 */
export async function cloneOrPull(git: GitRunner | undefined, m: Marketplace, dir: string, signal?: AbortSignal): Promise<SyncedClone> {
  if (!git) throw new ToilError('INTERNAL', 'The skills commands ran without git.', { fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues.' });
  const secretConfig = tokenConfig(m);
  const run = async (call: GitCall): Promise<GitResult> => git.run({ ...call, ...(secretConfig.length ? { secretConfig } : {}) }, signal);
  if (isClone(dir)) {
    const head = async () => {
      const r = await git.run({ subcommand: 'rev-parse', options: ['--verify'], revisions: ['HEAD'], cwd: dir }, signal);
      return r.exitCode === 0 ? r.stdout.trim() : undefined;
    };
    const before = await head();
    const pulled = await run({ subcommand: 'pull', options: ['--ff-only', '--no-rebase'], cwd: dir });
    if (pulled.exitCode !== 0) throw gitFailed('pull', m, pulled);
    return { cloned: false, updated: before === undefined || before !== (await head()) };
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new ToilError('INVALID_INPUT', `${slashes(dir)} already exists and isn't a git clone, so toil didn't clone into it.`, {
      fix: 'Empty or move that folder, or give the marketplace another localPath.',
    });
  }
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true });
  const cloned = await run({
    subcommand: 'clone',
    options: ['--no-recurse-submodules', ...(m.branch ? [`--branch=${m.branch}`] : [])],
    paths: [m.repoUrl, dir],
    cwd: parent,
  });
  // Git Credential Manager on Windows can exit non-zero after a clone that
  // worked; the clone itself is the evidence that counts.
  if (cloned.exitCode !== 0 && !isClone(dir)) throw gitFailed('clone', m, cloned);
  return { cloned: true, updated: true };
}

const AUTH_FAILED = [/invalid username or (password|token)/i, /authentication failed/i, /could not read (username|password)/i, /support for password authentication was removed/i, /\b40[13]\b/];
const NOT_FOUND = [/repository not found/i, /does not exist/i, /\b404\b/, /does not appear to be a git repository/i];
const OFFLINE = [/could not resolve host/i, /failed to connect/i, /connection (refused|timed out)/i, /unable to access/i];

/** git's own words, last few lines, with the token cut out should git ever echo it. */
function gitSaid(m: Marketplace, r: GitResult): string {
  const text = r.stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `git exited with ${r.exitCode}`;
  return m.token ? text.split(m.token).join('***') : text;
}

/** A failed clone or pull as an error that says what to do, never only git's stderr. */
export function gitFailed(action: 'clone' | 'pull', m: Marketplace, r: GitResult): ToilError {
  const said = gitSaid(m, r);
  const login = `toil connections login ${m.name}`;
  if (AUTH_FAILED.some((p) => p.test(said))) {
    const why = m.token ? `The token for marketplace ${m.name} was refused: it may be expired, revoked, or missing read access to the repository.` : `Marketplace ${m.name} needs a token, and none is set.`;
    const bitbucket = providerOf(m) === 'bitbucket' && !m.username ? ' Bitbucket Data Center personal tokens are usually sent with your Bitbucket username: set "username" on the connection.' : '';
    return new ToilError('AUTH', `${why} git ${action} said: ${said}`, { fix: `Store a token with ${login}, or set TOIL_CONN_${envForm(m.name)}_TOKEN.${bitbucket}` });
  }
  if (NOT_FOUND.some((p) => p.test(said))) {
    return new ToilError('NOT_FOUND', `The repository for marketplace ${m.name} wasn't found. git ${action} said: ${said}`, {
      fix: m.token ? `Check its repoUrl, and that the token can read it.` : `Check its repoUrl. If it's private, store a token with ${login}.`,
    });
  }
  if (OFFLINE.some((p) => p.test(said))) {
    return new ToilError('NETWORK', `git couldn't reach marketplace ${m.name}. git ${action} said: ${said}`, { fix: 'Check the URL and your network, and HTTPS_PROXY if you are behind a proxy.' });
  }
  return new ToilError('INVALID_INPUT', `git ${action} failed for marketplace ${m.name}: ${said}`, {
    fix: action === 'pull' ? `Check the clone at ${m.localPath ? slashes(resolve(m.localPath)) : 'its localPath'} for local changes; toil pulls fast-forward only.` : 'Check the URL and branch.',
  });
}

const envForm = (name: string) => name.toUpperCase().replace(/-/g, '_');

/** Refuses a clone folder inside toil's own files: config and credentials references live there. */
export function checkClonePath(dir: string, home: string, configFile: string): void {
  if (isWithin(dir, join(home, '.toil')) || isWithin(configFile, dir)) {
    throw new ToilError('INVALID_INPUT', `${slashes(dir)} holds toil's own configuration, which a marketplace may not be cloned into.`, {
      fix: 'Pick a folder outside ~/.toil that doesn\'t hold the --config file, or leave localPath out for ~/.agents/marketplaces/<repo-name>.',
    });
  }
}
