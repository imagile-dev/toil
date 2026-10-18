import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import type { DossierLookup, GitRemoteReader } from './call-context.js';
import { CONNECTION_NAME, connectionsOf, type ResolvedConfig } from './config.js';
import type { DossierReport, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import { forwardSlashes, isSystemPath, type Workspace } from './files.js';
import { findGitRepo, readGitRemotes, type GitContext } from './git-repo.js';
import { JsonSyntaxError, parseStrictJson } from './strict-json.js';

/**
 * Dossiers: what toil knows about one body of work (its repositories, the
 * keys and boards it lives under, each environment's resources), kept apart
 * from connections so it can be shared (docs/dossiers.md). A dossier holds no
 * secret and no `writes`, and it can't create a connection: an area section
 * only selects among the reader's own connections, by name or by a host that
 * is compared and never contacted. That's why one may be checked into a
 * repository when config may not.
 *
 * This module reads them from the three places they live (your own folder,
 * listed folders, the repository you're in) or from one file named on the
 * call, validates each on every read, picks the one that applies to a call,
 * and turns it into the lookup core's context resolver asks
 * (`DossierLookup`, src/core/call-context.ts). It never writes.
 *
 * A dossier is a briefing pack: everyone agrees it should exist, nobody agrees
 * who keeps it current. This one is read fresh every time, which is more than
 * most briefing packs can say.
 */

export type DossierSource = DossierReport['source'];

export interface DossierRepo {
  name: string;
  /** A local checkout, as written. Machine-specific, so an export drops it. */
  path?: string;
  /** Remote URLs, userinfo stripped. Only ever compared, never contacted. */
  remotes: string[];
}

/** One area's section: `connection` or `host`, `fields`, context input values, and reference data kept as written. */
export type Section = Record<string, unknown>;

export interface Dossier {
  name: string;
  description?: string;
  /** The environment the dossier works in by default; a key of `environments`. */
  env?: string;
  repos: DossierRepo[];
  /** Area name to section, unknown areas included (kept, and reported). */
  sections: Record<string, Section>;
  /** Environment name to area name to section. */
  environments: Record<string, Record<string, Section>>;
}

export interface DossierProblem {
  /** An `error` stops the dossier loading; a `warning` is reported and the dossier still loads. */
  level: 'error' | 'warning';
  code: string;
  /** Key path in the file (`jira.fields.storyPoints`), or '' for the file as a whole. */
  path: string;
  message: string;
}

/** One dossier file as read: where it is, where it counts as coming from, and what was wrong with it. */
export interface DossierFile {
  file: string;
  source: DossierSource;
  /** Absent when an error stopped it loading. */
  dossier?: Dossier;
  problems: DossierProblem[];
}

/** What a dossier needs to know about an area: its name and the context inputs a section may supply. */
export interface DossierArea {
  name: string;
  context: readonly string[];
}

/** Keys of a section that core reads itself; every other key is a context input or reference data. */
const CORE_SECTION_KEYS = new Set(['connection', 'host', 'fields']);
const TOP_LEVEL = new Set(['$schema', 'name', 'description', 'env', 'repos', 'environments']);
const ALIAS = /^[a-z][a-zA-Z0-9]*$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const at = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`);

/**
 * A remote with a credential in it: any http(s) userinfo, or a password in any
 * URL. `git@host:path` and `ssh://git@host/...` carry a login name, not a
 * secret, so they're left as they are.
 */
export function hasSecretUserinfo(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/@]*)@/i.exec(url);
  if (!match) return false;
  return /^https?$/i.test(match[1]!) || match[2]!.includes(':');
}

/** The remote with any secret userinfo removed: `https://user:<token>@host/x` becomes `https://host/x`. */
export function stripUserinfo(url: string): string {
  return hasSecretUserinfo(url) ? url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1') : url;
}

/**
 * A remote reduced to what identifies the repository, so the SSH and HTTPS
 * remotes of one repo compare equal: no scheme, no userinfo, no port, host
 * lowercased, scp-style `git@host:path` read as `host/path`, and a trailing
 * `.git` and `/` dropped. A local path compares with forward slashes.
 */
export function normalizeRemote(url: string): string {
  const trimmed = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?([^/:]+)(?::\d+)?(\/.*)?$/i.exec(trimmed);
  // `user@host:path`, but not `C:\x` or `C:/x`, which are Windows paths.
  const scp = scheme || /^[a-z]:[\\/]/i.test(trimmed) ? null : /^(?:[^@/:]+@)?([^/:]+):(.*)$/.exec(trimmed);
  const parts = scheme ?? scp;
  if (!parts) return forwardSlashes(trimmed).replace(/\/+$/, '').replace(/\.git$/, '');
  const path = (parts[2] ?? '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return `${parts[1]!.toLowerCase()}/${path}`;
}

/** Paths compared as the platform compares them: case-insensitively on Windows, with one kind of slash. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => {
    const slashed = forwardSlashes(resolve(p)).replace(/\/+$/, '');
    return platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Validates a parsed dossier, section by section. Unknown areas' sections are
 * kept and reported, never dropped. Remotes come back without userinfo.
 */
export function validateDossier(raw: unknown, areas: readonly DossierArea[]): { dossier?: Dossier; problems: DossierProblem[] } {
  const problems: DossierProblem[] = [];
  const error = (path: string, message: string) => problems.push({ level: 'error', code: 'DOSSIER_INVALID', path, message });
  const warn = (code: string, path: string, message: string) => problems.push({ level: 'warning', code, path, message });
  if (!isRecord(raw)) {
    error('', 'A dossier must be a JSON object.');
    return { problems };
  }
  const byName = new Map(areas.map((a) => [a.name, a]));

  if (typeof raw.name !== 'string' || !CONNECTION_NAME.test(raw.name)) error('name', '"name" must be lowercase letters, digits and single hyphens, starting with a letter, e.g. "payments".');
  if (raw.description !== undefined && typeof raw.description !== 'string') error('description', '"description" must be text.');

  const repos: DossierRepo[] = [];
  if (raw.repos !== undefined && !Array.isArray(raw.repos)) error('repos', '"repos" must be a list of repositories.');
  const seenRepo = new Map<string, string>();
  const seenRemote = new Map<string, string>();
  const seenPath: string[] = [];
  (Array.isArray(raw.repos) ? raw.repos : []).forEach((entry: unknown, i) => {
    const path = at('repos', i);
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '') return error(path, 'Each repo needs a "name".');
    if (entry.path !== undefined && (typeof entry.path !== 'string' || entry.path === '')) return error(at(path, 'path'), '"path" must be a folder.');
    if (entry.remotes !== undefined && (!Array.isArray(entry.remotes) || !entry.remotes.every((r) => typeof r === 'string' && r !== ''))) return error(at(path, 'remotes'), '"remotes" must be a list of remote URLs.');
    for (const key of Object.keys(entry)) if (!['name', 'path', 'remotes'].includes(key)) warn('DOSSIER_UNKNOWN_KEY', at(path, key), `"${key}" isn't a repo key; repos take name, path and remotes. It was ignored.`);
    if (seenRepo.has(entry.name)) warn('DOSSIER_DUPLICATE', at(path, 'name'), `Repo "${entry.name}" is listed twice (also ${seenRepo.get(entry.name)}).`);
    seenRepo.set(entry.name, path);
    if (typeof entry.path === 'string') {
      if (seenPath.some((p) => samePath(p, entry.path as string))) warn('DOSSIER_DUPLICATE', at(path, 'path'), `Path ${forwardSlashes(entry.path)} is listed for two repos.`);
      seenPath.push(entry.path);
    }
    const remotes = ((entry.remotes as string[] | undefined) ?? []).map((remote, j) => {
      const where = at(at(path, 'remotes'), j);
      if (hasSecretUserinfo(remote)) warn('DOSSIER_REMOTE_USERINFO', where, 'This remote has a credential in its userinfo. toil ignores it, but it shouldn\'t be in a dossier: remove the "user:token@" part.');
      const key = normalizeRemote(remote);
      if (seenRemote.has(key)) warn('DOSSIER_DUPLICATE', where, `This remote is listed twice (also ${seenRemote.get(key)}).`);
      seenRemote.set(key, where);
      return stripUserinfo(remote);
    });
    repos.push({ name: entry.name, ...(typeof entry.path === 'string' ? { path: entry.path } : {}), remotes });
  });

  const readSection = (area: string, value: unknown, path: string): Section | undefined => {
    const known = byName.get(area);
    if (!known) warn('DOSSIER_UNKNOWN_SECTION', path, `"${area}" isn't an area this toil has, so its section is kept but not used.`);
    if (!isRecord(value)) {
      error(path, `The ${area} section must be an object.`);
      return undefined;
    }
    if (value.connection !== undefined && (typeof value.connection !== 'string' || !CONNECTION_NAME.test(value.connection))) error(at(path, 'connection'), '"connection" must be a connection name, e.g. "corp-jira".');
    if (value.host !== undefined && (typeof value.host !== 'string' || !HOST.test(value.host))) error(at(path, 'host'), '"host" must be a host name, optionally with a port, e.g. "jira.imagile.dev"; no scheme or path.');
    if (value.connection !== undefined && value.host !== undefined) error(path, 'Give "connection" or "host", not both: each picks the connection on its own.');
    if (value.fields !== undefined) {
      if (!isRecord(value.fields)) error(at(path, 'fields'), '"fields" must map each alias to a field id.');
      else {
        const ids = new Map<string, string>();
        for (const [alias, id] of Object.entries(value.fields)) {
          const where = at(at(path, 'fields'), alias);
          if (!ALIAS.test(alias)) error(where, `Field alias "${alias}" must be a camelCase identifier, e.g. "storyPoints".`);
          if (typeof id !== 'string' || id === '') error(where, `Field alias "${alias}" must name a field id.`);
          else {
            if (ids.has(id)) warn('DOSSIER_DUPLICATE', where, `Field id ${id} has two aliases ("${ids.get(id)}" and "${alias}").`);
            ids.set(id, alias);
          }
        }
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (CORE_SECTION_KEYS.has(key)) continue;
      const where = at(path, key);
      if (known?.context.includes(key)) {
        // A context input: one value, or one per repo (`{ "payments-api": "PAY" }`).
        const ok = (typeof entry === 'string' && entry !== '') || (isRecord(entry) && Object.values(entry).every((v) => typeof v === 'string' && v !== ''));
        if (!ok) error(where, `"${key}" supplies ${area}'s ${key}: give it as text, or as an object of repo name to text.`);
      } else if (Array.isArray(entry)) {
        // Reference data (`projects`, `deployments`) is kept as written; a value listed twice is still worth saying.
        const seen = new Set<string>();
        entry.forEach((item, i) => {
          if (typeof item !== 'string' && typeof item !== 'number') return;
          const k = String(item);
          if (seen.has(k)) warn('DOSSIER_DUPLICATE', at(where, i), `${JSON.stringify(item)} is listed twice in ${where}.`);
          seen.add(k);
        });
      }
    }
    return value;
  };

  const sections: Record<string, Section> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (TOP_LEVEL.has(key)) continue;
    const section = readSection(key, value, key);
    if (section) sections[key] = section;
  }

  const environments: Record<string, Record<string, Section>> = {};
  if (raw.environments !== undefined && !isRecord(raw.environments)) error('environments', '"environments" must map each environment to its areas.');
  for (const [env, areasOf] of Object.entries(isRecord(raw.environments) ? raw.environments : {})) {
    const path = at('environments', env);
    if (!isRecord(areasOf)) {
      error(path, `Environment "${env}" must map areas to their sections.`);
      continue;
    }
    environments[env] = {};
    for (const [area, value] of Object.entries(areasOf)) {
      const section = readSection(area, value, at(path, area));
      if (section) environments[env]![area] = section;
    }
  }
  if (raw.env !== undefined && (typeof raw.env !== 'string' || !(raw.env in environments))) {
    error('env', `"env" must name one of the dossier's environments${Object.keys(environments).length ? ` (${Object.keys(environments).join(', ')})` : ', and it has none'}.`);
  }

  if (problems.some((p) => p.level === 'error')) return { problems };
  return {
    dossier: {
      name: raw.name as string,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.env === 'string' ? { env: raw.env } : {}),
      repos,
      sections,
      environments,
    },
    problems,
  };
}

/** Reads and validates one file. A file that can't be read or parsed is an error problem, never a throw. */
export function readDossierFile(file: string, source: DossierSource, areas: readonly DossierArea[]): DossierFile {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { file, source, problems: [{ level: 'error', code: 'DOSSIER_INVALID', path: '', message: `It couldn't be read: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.` }] };
  }
  let parsed: ReturnType<typeof parseStrictJson>;
  try {
    parsed = parseStrictJson(text);
  } catch (err) {
    // Where, never what: the content stays in the file (docs/dossiers.md, What import reveals).
    const where = err instanceof JsonSyntaxError ? err.message : 'unreadable';
    return { file, source, problems: [{ level: 'error', code: 'DOSSIER_INVALID', path: '', message: `It isn't valid JSON: ${where}.` }] };
  }
  const { dossier, problems } = validateDossier(parsed.value, areas);
  const duplicates: DossierProblem[] = parsed.duplicates.map((path) => ({ level: 'warning', code: 'DOSSIER_DUPLICATE_KEY', path, message: `"${path}" is set twice; the last one is used.` }));
  return { file, source, ...(dossier ? { dossier } : {}), problems: [...duplicates, ...problems] };
}

/** A problem as a meta.warnings entry, naming the file and key. */
export function problemWarning(file: DossierFile, problem: DossierProblem): Warning {
  return { code: problem.code, message: `${forwardSlashes(file.file)}${problem.path ? ` (${problem.path})` : ''}: ${problem.message}` };
}

/** The error for a dossier that can't load: which file, which key, what's wrong. Never the content. */
export function brokenDossier(file: DossierFile): ToilError {
  const errors = file.problems.filter((p) => p.level === 'error');
  const first = errors[0]!;
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more problem${errors.length > 2 ? 's' : ''})` : '';
  return new ToilError('CONFIG_INVALID', `Dossier ${forwardSlashes(file.file)} can't be used${first.path ? `: ${first.path}` : ''}: ${first.message}${more}`, {
    fix: `Fix it in ${forwardSlashes(file.file)}; toil dossiers check ${forwardSlashes(file.file)} lists every problem.`,
    details: errors.map((p) => ({ path: p.path, message: p.message })),
  });
}

/** Where a dossier's folder came from: the call's `cwd`, or the workspace (`--workspace`, TOIL_WORKSPACE, the CLI's working directory, the MCP client's root). */
export type FolderSource = NonNullable<DossierReport['folder']>['from'];

export interface Folder {
  path?: string;
  from: FolderSource;
}

/** The repository a folder is in, as dossiers match it: its root and its `origin` remote. */
export interface FolderRepo {
  root: string;
  origin?: string;
}

export interface Selection {
  folder: Folder;
  repo?: FolderRepo;
  /** The dossier that applies, and how it was found. */
  applied?: Applied;
  /** Every dossier that matched the folder, after same-name precedence; more than one means none applies. */
  candidates: Applied[];
  /** Files read on the way that are broken, and same-name collisions: worth saying, not worth failing for. */
  warnings: Warning[];
}

export interface Applied {
  file: DossierFile & { dossier: Dossier };
  by: DossierReport['by'];
  match?: NonNullable<DossierReport['match']>;
  /** The dossier's repo the folder is, when one matched. */
  repo?: string;
}

/** What execute() gets for one call: the lookup for core's resolver, adoption, and the folder's git. */
export interface Place {
  lookup?: DossierLookup;
  /** Whether a write may use a connection the dossier chose: only when the dossier is your own (`toil dossiers import`). */
  adopted: (area: string, connection: string, by: 'dossier' | 'git') => boolean;
  /** The host selector that picked `area`'s connection, for meta.context. */
  hostFor: (area: string, input: Record<string, unknown>) => string | undefined;
  report?: DossierReport;
  warnings: Warning[];
  /** The folder's git, when the call named a `cwd`; otherwise the workspace's, as before. */
  gitRemote?: GitRemoteReader;
  repo?: () => GitContext | undefined;
}

export interface CatalogOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  config: ResolvedConfig;
  areas: readonly DossierArea[];
  /** The default folder: the workspace. */
  workspace: Pick<Workspace, 'dir' | 'source'>;
  /** What a relative `cwd` or dossier path resolves against: the CLI's working directory; under MCP, the workspace. */
  base: string | undefined;
  /** toil's own files beyond `~/.toil` (the --config file), which a dossier path may not name. */
  protect: readonly string[];
  /** The git context for a folder (its remotes for the git step, and `ctx.repo()`), used when a call names a `cwd`: the same readers the workspace gets. */
  git: (dir: string) => Pick<Place, 'gitRemote' | 'repo'>;
}

export interface DossierCatalog {
  /** Your own folder, the listed folders, and the repository dossier folder for `folder` when it's in one. */
  places(cwd?: string): { user: string; listed: string[]; repo?: string };
  /** Every dossier file in every place, in precedence order (yours, listed, the repository's). */
  scan(cwd?: string): { files: DossierFile[]; folder: Folder; repo?: FolderRepo; warnings: Warning[] };
  /** One dossier by name or by path; broken is CONFIG_INVALID, unknown INVALID_INPUT. */
  find(nameOrPath: string, cwd?: string): DossierFile & { dossier: Dossier };
  /** Which dossier applies, from the explicit `dossier` (or TOIL_DOSSIER), else the folder. */
  select(request: { dossier?: string | undefined; cwd?: string | undefined }): Selection;
  /** The same, as what a call's context resolution needs. */
  place(request: { dossier?: string | undefined; cwd?: string | undefined }): Place;
  /** The connection `area` uses under `dossier`'s binding, without a call: for `dossiers show` and `check`. */
  binding(dossier: Dossier, area: string, env: string | undefined): { connection?: string; host?: string; section?: Section };
}

const FROM_WORKSPACE: Record<Workspace['source'], FolderSource> = { flag: 'flag', env: 'env', cwd: 'cwd', 'mcp-root': 'mcp-root', none: 'cwd' };

export function createDossierCatalog(o: CatalogOptions): DossierCatalog {
  const user = join(o.home, '.toil', 'dossiers');
  const own = join(o.home, '.toil');
  const guard = { home: o.home, env: o.env, protect: o.protect };
  const areaNames = new Map(o.areas.map((a) => [a.name, a]));
  const real = (path: string) => {
    try {
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  };

  const listed = (): string[] => {
    const fromEnv = o.env.TOIL_DOSSIER_PATHS;
    const raw = fromEnv !== undefined ? fromEnv.split(delimiter).filter((p) => p !== '') : (o.config.dossierPaths ?? []);
    return raw.map((p) => resolve(p));
  };

  const fromBase = (value: string, what: string): string => {
    if (isAbsolute(value)) return resolve(value);
    if (o.base === undefined) {
      throw new ToilError('INVALID_INPUT', `${what} "${value}" is relative, and there's no folder to resolve it against.`, {
        fix: 'Pass an absolute path, or give the MCP server a workspace with --workspace <dir> or TOIL_WORKSPACE.',
      });
    }
    return resolve(o.base, value);
  };

  const folder = (cwd?: string): Folder => {
    if (cwd === undefined) return o.workspace.dir ? { path: o.workspace.dir, from: FROM_WORKSPACE[o.workspace.source] } : { from: FROM_WORKSPACE[o.workspace.source] };
    const path = fromBase(cwd, 'The folder');
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      // said below
    }
    if (!isDir) {
      throw new ToilError('INVALID_INPUT', `The folder ${forwardSlashes(path)} (from cwd) doesn't exist where toil is running.`, {
        fix: "Pass a folder on this machine. If toil runs somewhere else (a container, WSL, another host), its paths aren't yours: pass dossier by name instead.",
      });
    }
    return { path, from: 'input' };
  };

  const repoOf = (dir: string | undefined): FolderRepo | undefined => {
    if (!dir) return undefined;
    const repo = findGitRepo(dir, guard);
    if (!repo) return undefined;
    const origin = readGitRemotes(repo, guard).find((r) => r.name === 'origin');
    return { root: repo.root, ...(origin ? { origin: origin.url } : {}) };
  };

  /** toil's own files (but your dossier folder), the --config file, /proc and /sys: never read as a dossier. */
  const forbidden = (realPath: string) => (!inside(realPath, real(user)) && [own, ...o.protect].some((p) => inside(realPath, real(p)))) || isSystemPath(realPath);

  /** Every `.json` in `dir`. A repository's folder must really be inside the repository (`within`), and no file may lead out of its folder. */
  const readFolder = (dir: string, source: DossierSource, warnings: Warning[], within?: string): DossierFile[] => {
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) {
        warnings.push({ code: 'DOSSIER_PATH_INVALID', message: `${forwardSlashes(dir)} is listed as a dossier folder but isn't a folder.` });
        return [];
      }
      names = readdirSync(dir);
    } catch {
      // A folder that isn't there yet (no dossiers made) is simply empty; a listed one is worth saying.
      if (source === 'listed') warnings.push({ code: 'DOSSIER_PATH_INVALID', message: `${forwardSlashes(dir)} is listed as a dossier folder but doesn't exist.` });
      return [];
    }
    const realDir = real(dir);
    if ((within !== undefined && !inside(realDir, real(within))) || forbidden(realDir)) {
      warnings.push({ code: 'DOSSIER_PATH_INVALID', message: `${forwardSlashes(dir)} was skipped: it's a link to a folder outside ${within ? forwardSlashes(within) : 'the dossier folders'}.` });
      return [];
    }
    return names
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .sort()
      .flatMap((n) => {
        // A repository can check in a symlink. One that leads out of its folder
        // could make any JSON file on the machine read as a dossier, so it's skipped.
        const file = join(dir, n);
        if (!inside(real(file), realDir) || forbidden(real(file))) {
          warnings.push({ code: 'DOSSIER_PATH_INVALID', message: `${forwardSlashes(file)} was skipped: it's a link to a file outside ${forwardSlashes(dir)}.` });
          return [];
        }
        return [readDossierFile(file, source, o.areas)];
      });
  };

  const places = (cwd?: string) => {
    const repo = repoOf(folder(cwd).path);
    const repoDir = repo ? join(repo.root, '.toil', 'dossiers') : undefined;
    // A home folder that is itself a repository has one dossier folder, not two.
    return { user, listed: listed(), ...(repoDir && !samePath(real(repoDir), real(user)) ? { repo: repoDir } : {}) };
  };

  const scan = (cwd?: string) => {
    const f = folder(cwd);
    const repo = repoOf(f.path);
    const where = places(cwd);
    const warnings: Warning[] = [];
    const files = [
      ...readFolder(where.user, 'user', warnings),
      ...where.listed.flatMap((dir) => readFolder(dir, 'listed', warnings)),
      ...(where.repo && repo ? readFolder(where.repo, 'repo', warnings, repo.root) : []),
    ];
    return { files, folder: f, ...(repo ? { repo } : {}), warnings };
  };

  /** Which of the dossier's repos the folder is: by path first, then by `origin`. */
  const matchRepo = (dossier: Dossier, f: Folder, repo: FolderRepo | undefined): { name: string; by: 'path' | 'remote' } | undefined => {
    const root = repo?.root ?? f.path;
    if (root) {
      const byPath = dossier.repos.find((r) => r.path !== undefined && samePath(r.path, root));
      if (byPath) return { name: byPath.name, by: 'path' };
    }
    if (repo?.origin) {
      const origin = normalizeRemote(repo.origin);
      const byRemote = dossier.repos.find((r) => r.remotes.some((remote) => normalizeRemote(remote) === origin));
      if (byRemote) return { name: byRemote.name, by: 'remote' };
    }
    return undefined;
  };

  const usable = (file: DossierFile): file is DossierFile & { dossier: Dossier } => file.dossier !== undefined;

  /** A path on the call, bounded: a `.json` file in the workspace or a dossier place, never toil's config or /proc and /sys. */
  const readPath = (value: string, cwd?: string): DossierFile => {
    const path = fromBase(value, 'The dossier file');
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `${forwardSlashes(path)} can't be read as a dossier: ${why}`, { fix });
    if (!path.toLowerCase().endsWith('.json')) throw refuse('a dossier file ends in .json.', 'Pass a dossier file, or a dossier by name.');
    let realPath: string;
    try {
      realPath = realpathSync.native(path);
      if (!statSync(realPath).isFile()) throw new Error('not a file');
    } catch {
      throw new ToilError('INVALID_INPUT', `The dossier file ${forwardSlashes(path)} doesn't exist where toil is running.`, {
        fix: "Check the path. If toil runs somewhere else (a container, WSL, another host), its paths aren't yours: pass the dossier by name instead.",
      });
    }
    const where = places(cwd);
    // ~/.toil/dossiers is the one part of toil's own folder a dossier path may name.
    const inUser = inside(realPath, real(user));
    if (forbidden(realPath)) throw refuse("that's one of toil's own files, or a system path.", 'Pass a dossier file, or a dossier by name.');
    const source: DossierSource = inUser
      ? 'user'
      : where.listed.some((d) => inside(realPath, real(d)))
        ? 'listed'
        : where.repo && inside(realPath, real(where.repo))
          ? 'repo'
          : 'file';
    const unbounded = o.config.bounds?.files === 'unbounded';
    if (source === 'file' && !unbounded && !(o.workspace.dir && inside(realPath, real(o.workspace.dir)))) {
      throw refuse(
        `it's outside the workspace${o.workspace.dir ? ` (${forwardSlashes(o.workspace.dir)})` : ''} and outside every dossier folder.`,
        'Move it into the workspace, list its folder in dossierPaths (or TOIL_DOSSIER_PATHS), copy it in with toil dossiers import, or pass the dossier by name.',
      );
    }
    return readDossierFile(realPath, source, o.areas);
  };

  const find = (nameOrPath: string, cwd?: string): DossierFile & { dossier: Dossier } => {
    // A dossier's name is lowercase letters, digits and hyphens; anything else is a path.
    if (!CONNECTION_NAME.test(nameOrPath)) {
      const file = readPath(nameOrPath, cwd);
      if (!usable(file)) throw brokenDossier(file);
      return file;
    }
    const { files } = scan(cwd);
    // Yours, then a listed folder, then the repository's: the scan's order.
    const named = files.filter((f) => f.dossier?.name === nameOrPath || (!f.dossier && basename(f.file).replace(/\.json$/i, '') === nameOrPath));
    const first = named[0];
    if (!first) {
      const known = [...new Set(files.flatMap((f) => (f.dossier ? [f.dossier.name] : [])))].sort();
      throw new ToilError('INVALID_INPUT', `There's no dossier named "${nameOrPath}" here.`, {
        fix: known.length ? `Use one of: ${known.join(', ')}; or pass a path to a dossier file.` : 'Create one with toil dossiers init <name>, or pass a path to a dossier file.',
      });
    }
    if (!usable(first)) throw brokenDossier(first);
    return first;
  };

  /** Same name in two places: worth saying, naming both files, even when precedence settles it. */
  const sameName = (files: readonly DossierFile[], name: string): Warning[] => {
    const all = files.filter((f) => f.dossier?.name === name);
    if (all.length < 2) return [];
    return [{ code: 'DOSSIER_DUPLICATE_NAME', message: `Dossier "${name}" is in ${all.length} places: ${all.map((f) => `${forwardSlashes(f.file)} (${f.source})`).join(', ')}. The first is used.` }];
  };

  const select = (request: { dossier?: string | undefined; cwd?: string | undefined }): Selection => {
    const explicit = request.dossier ?? (o.env.TOIL_DOSSIER || undefined);
    const by: DossierReport['by'] = request.dossier !== undefined ? 'input' : 'env';
    const f = folder(request.cwd);
    const repo = repoOf(f.path);
    if (explicit !== undefined) {
      const file = find(explicit, request.cwd);
      const matched = matchRepo(file.dossier, f, repo);
      const applied: Applied = { file, by, ...(matched ? { match: matched.by, repo: matched.name } : {}) };
      const warnings = CONNECTION_NAME.test(explicit) ? sameName(scan(request.cwd).files, file.dossier.name) : [];
      return { folder: f, ...(repo ? { repo } : {}), applied, candidates: [applied], warnings };
    }
    const scanned = scan(request.cwd);
    const warnings = [...scanned.warnings];
    for (const file of scanned.files) {
      const broken = file.dossier ? undefined : file.problems.find((p) => p.level === 'error');
      if (broken) warnings.push(problemWarning(file, { ...broken, message: `skipped, because ${broken.message.charAt(0).toLowerCase()}${broken.message.slice(1)}` }));
    }
    const candidates: Applied[] = [];
    const taken = new Set<string>();
    for (const file of scanned.files.filter(usable)) {
      const matched = matchRepo(file.dossier, f, repo);
      // A dossier checked into the repository you're in applies there, listed repo or not.
      if (!matched && file.source !== 'repo') continue;
      if (taken.has(file.dossier.name)) continue;
      taken.add(file.dossier.name);
      candidates.push({ file, by: 'folder', match: matched?.by ?? 'checked-in', ...(matched ? { repo: matched.name } : {}) });
    }
    const applied = candidates.length === 1 ? candidates[0] : undefined;
    if (applied) warnings.push(...sameName(scanned.files, applied.file.dossier.name));
    return { folder: f, ...(repo ? { repo } : {}), ...(applied ? { applied } : {}), candidates, warnings };
  };

  const hostMatches = (settings: Record<string, unknown>, selector: string): boolean => {
    const [host, port] = selector.toLowerCase().split(':');
    if (typeof settings.baseUrl === 'string') {
      try {
        const url = new URL(settings.baseUrl);
        const actual = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
        return url.hostname.toLowerCase() === host && (port === undefined || actual === port);
      } catch {
        return false;
      }
    }
    if (typeof settings.host === 'string') return settings.host.toLowerCase() === host && (port === undefined || String(settings.port ?? '') === port);
    return false;
  };

  /** The reader's connection that a host selector picks. Never a fallback to the default: that could point the dossier somewhere its author didn't mean. */
  const byHost = (dossier: Dossier, area: string, host: string): string => {
    const matches = connectionsOf(o.config, area).filter((name) => hostMatches(o.config.connections[name]!, host));
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) {
      throw new ToilError('NOT_CONFIGURED', `Dossier ${dossier.name} uses the ${area} connection on ${host}, and you have no ${area} connection with that host.`, {
        fix: `Add one with toil connections add <name> --area ${area} (base URL on ${host}), or pass --connection.`,
      });
    }
    throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} uses the ${area} connection on ${host}, and ${matches.length} of yours are on that host: ${matches.join(', ')}.`, {
      fix: `Pass --connection, or set "connection" instead of "host" in your own copy of the dossier (toil dossiers import).`,
    });
  };

  const sectionsFor = (dossier: Dossier, area: string, env: string | undefined): Section[] =>
    [env === undefined ? undefined : dossier.environments[env]?.[area], dossier.sections[area]].filter((s): s is Section => s !== undefined);

  const binding: DossierCatalog['binding'] = (dossier, area, env) => {
    for (const section of sectionsFor(dossier, area, env)) {
      if (typeof section.connection === 'string') return { connection: section.connection, section };
      if (typeof section.host === 'string') return { connection: byHost(dossier, area, section.host), host: section.host, section };
    }
    return {};
  };

  /** The environment a call works in: its own `--env` where the area has one, else the dossier's. */
  const envOf = (dossier: Dossier, area: string, input: Record<string, unknown>): string | undefined => {
    const explicit = areaNames.get(area)?.context.includes('env') ? input.env : undefined;
    return typeof explicit === 'string' ? explicit : dossier.env;
  };

  const lookupFor = (applied: Applied): DossierLookup => {
    const dossier = applied.file.dossier;
    return (area, key, input = {}) => {
      const env = envOf(dossier, area, input);
      if (key === 'connection') return binding(dossier, area, env).connection;
      // The dossier's environment is the same `--env` an area already has; it
      // applies to the areas the environment lists (docs/dossiers.md, One --env).
      if (key === 'env' && areaNames.get(area)?.context.includes('env')) return dossier.env !== undefined && dossier.environments[dossier.env]?.[area] ? dossier.env : undefined;
      for (const section of sectionsFor(dossier, area, env)) {
        const value = section[key];
        if (typeof value === 'string') return value;
        if (isRecord(value) && applied.repo !== undefined && typeof value[applied.repo] === 'string') return value[applied.repo] as string;
      }
      return undefined;
    };
  };

  const place = (request: { dossier?: string | undefined; cwd?: string | undefined }): Place => {
    const selection = select(request);
    if (!selection.applied && selection.candidates.length > 1) {
      throw new ToilError('INVALID_INPUT', `${selection.candidates.length} dossiers apply to ${forwardSlashes(selection.folder.path ?? '')}: ${selection.candidates.map((c) => `${c.file.dossier.name} (${forwardSlashes(c.file.file)})`).join(', ')}.`, {
        fix: `Pass --dossier <name>, or set TOIL_DOSSIER, to pick one: ${selection.candidates.map((c) => c.file.dossier.name).join(', ')}.`,
      });
    }
    const applied = selection.applied;
    const git = request.cwd !== undefined && selection.folder.path ? o.git(selection.folder.path) : {};
    const warnings = [...selection.warnings, ...(applied ? applied.file.problems.filter((p) => p.level === 'warning').map((p) => problemWarning(applied.file, p)) : [])];
    if (!applied) return { adopted: () => false, hostFor: () => undefined, warnings, ...git };
    const folderReport = (applied.by === 'folder' || request.cwd !== undefined) && selection.folder.path ? { folder: { path: forwardSlashes(selection.folder.path), from: selection.folder.from } } : {};
    return {
      lookup: lookupFor(applied),
      // Your own dossier's bindings are yours; a checked-in, listed or loose
      // file's are suggestions until you import it (docs/dossiers.md, Writes ask once).
      adopted: (_area, _connection, by) => by === 'dossier' && applied.file.source === 'user',
      hostFor: (area, input) => binding(applied.file.dossier, area, envOf(applied.file.dossier, area, input)).host,
      report: {
        name: applied.file.dossier.name,
        source: applied.file.source,
        file: forwardSlashes(applied.file.file),
        by: applied.by,
        ...(applied.match ? { match: applied.match } : {}),
        ...(applied.repo ? { repo: applied.repo } : {}),
        ...folderReport,
      },
      warnings,
      ...git,
    };
  };

  return { places, scan, find, select, place, binding };
}

