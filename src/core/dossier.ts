import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import type { DossierLookup, GitRemoteReader } from './call-context.js';
import { CONNECTION_NAME, connectionsOf, type ResolvedConfig } from './config.js';
import type { DossierReport, Warning } from './envelope.js';
import { ToilError } from './errors.js';
import { forwardSlashes, isSystemPath, type Workspace } from './files.js';
import { findGitRepo, readGitBranch, readGitRemotes, type GitContext } from './git-repo.js';
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
  /** A JSON schema reference, kept as written. */
  $schema?: string;
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
      if (key === 'env' && known?.context.includes('env')) {
        warn('DOSSIER_UNUSED_KEY', where, `"env" in a section isn't used: the environment is the dossier's own "env", or the call's --env. Set it with toil dossiers env <dossier> <env> ${area} --default.`);
        continue;
      }
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
      ...(typeof raw.$schema === 'string' ? { $schema: raw.$schema } : {}),
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

/**
 * Whether a connection is on a dossier host selector (`host` or `host:port`): its
 * base URL's host, with the scheme's default port filled in, or its `host` setting.
 * Exported so the menu asks about writes on exactly the connections a call would pick.
 */
export function hostMatches(settings: Record<string, unknown>, selector: string): boolean {
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
}

/** The dossier as it's written to a file and shown: remotes without userinfo, every section and reference key kept. */
export function dossierContent(dossier: Dossier): Record<string, unknown> {
  return {
    ...(dossier.$schema !== undefined ? { $schema: dossier.$schema } : {}),
    name: dossier.name,
    ...(dossier.description !== undefined ? { description: dossier.description } : {}),
    ...(dossier.env !== undefined ? { env: dossier.env } : {}),
    repos: dossier.repos,
    ...dossier.sections,
    ...(Object.keys(dossier.environments).length > 0 ? { environments: dossier.environments } : {}),
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
  /** The dossier's values; the first call works out which dossier applies, and may fail (two match). */
  lookup: DossierLookup;
  /** Whether a write may use a connection the dossier chose: only when the dossier is your own (`toil dossiers import`). */
  adopted: (area: string, connection: string, by: 'dossier' | 'git') => boolean;
  /** The host selector that picked `area`'s connection, for meta.context. */
  hostFor: (area: string, input: Record<string, unknown>) => string | undefined;
  /** meta.context.dossier, once the lookup has been asked and a dossier applied; undefined before. */
  report: () => DossierReport | undefined;
  /** Problems found reading dossiers, once the lookup has been asked. */
  warnings: () => Warning[];
  /** The dossier's field aliases for an area, alias to field id; asking consults the dossier, as the lookup does. */
  fields: (area: string, input: Record<string, unknown>) => Record<string, string>;
  /** Every section the dossier has for an area, for `<area> check-dossier`; asking consults the dossier. */
  view: (area: string) => DossierView | undefined;
  /** The folder's git, when the call named a `cwd`; otherwise the workspace's. */
  gitRemote?: GitRemoteReader;
  repo?: () => GitContext | undefined;
}

/** A repository `toil repos scan` found. */
export interface ScannedRepo {
  /** The folder's name, which `dossiers add-repo` uses as the repo's name too. */
  name: string;
  /** The work tree's root, absolute, forward slashes. */
  path: string;
  branch: string;
  /** Fetch URLs by remote name, userinfo stripped. */
  remotes: Record<string, string>;
}

/** The most folders one scan visits; past it the result says it's truncated. */
const SCAN_LIMIT = 20_000;
/** Folders no repository lives in, skipped by name. */
const SCAN_SKIP = new Set(['node_modules', '.git', '.hg', '.svn', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', 'bin', 'obj']);

/** One area's part of a dossier, as `<area> check-dossier` reads it: read-only, and never a connection's settings. */
export interface DossierView {
  name: string;
  source: DossierSource;
  file: string;
  /** The dossier's default environment, if it names one. */
  env: string | null;
  /** The area's own section and each environment's, with their key paths. */
  sections: Array<{ path: string; env: string | null; values: Section }>;
}

/** A group of values that belong together, as `viewScopes` finds them: each key's value and where in the dossier it came from. */
export interface ViewScope {
  repo: string | null;
  values: Record<string, string>;
  paths: Record<string, string>;
}

/**
 * The values of several keys that belong together (a project and its repo),
 * per repo, read the way the resolver reads them: for each key, the call's
 * environment's section first, then the area's own, and in each a plain value
 * for every repo or a per-repo one (`{ "payments-api": "PAY" }`) for its repo.
 * A scope that finds some of `keys` but not all goes in `incomplete`, so the
 * caller can say it couldn't be checked rather than leave it out.
 */
export function viewScopes(view: DossierView, keys: readonly string[]): { scopes: ViewScope[]; incomplete: Array<{ repo: string | null; found: Record<string, string>; lacks: string[] }> } {
  // The environment's section first, as the resolver reads it (sectionsFor).
  const ordered = [...view.sections].sort((a, b) => Number(a.env === null) - Number(b.env === null));
  const repos = [...new Set(ordered.flatMap((s) => keys.flatMap((k) => (isRecord(s.values[k]) ? Object.keys(s.values[k] as Record<string, unknown>) : []))))];
  const scopes: ViewScope[] = [];
  const incomplete: Array<{ repo: string | null; found: Record<string, string>; lacks: string[] }> = [];
  for (const repo of repos.length > 0 ? repos : [null]) {
    const values: Record<string, string> = {};
    const paths: Record<string, string> = {};
    for (const key of keys) {
      for (const section of ordered) {
        const value = section.values[key];
        if (typeof value === 'string') {
          values[key] = value;
          paths[key] = `${section.path}.${key}`;
          break;
        }
        if (isRecord(value) && repo !== null && typeof value[repo] === 'string') {
          values[key] = value[repo] as string;
          paths[key] = `${section.path}.${key}.${repo}`;
          break;
        }
      }
    }
    const lacks = keys.filter((k) => !(k in values));
    if (lacks.length === 0) scopes.push({ repo, values, paths });
    else if (lacks.length < keys.length) incomplete.push({ repo, found: Object.fromEntries(Object.entries(paths).map(([k, path]) => [path, values[k]!])), lacks });
  }
  return { scopes, incomplete };
}

/**
 * Every text value a view holds under `keys`, with its key path: a plain
 * value, each repo's value in a per-repo map, each item of a list. What a
 * check-dossier command looks up on its service.
 */
export function viewValues(view: DossierView, keys: readonly string[]): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  for (const { path, values } of view.sections) {
    for (const key of keys) {
      const value = values[key];
      const at = `${path}.${key}`;
      if (typeof value === 'string') out.push({ path: at, value });
      else if (Array.isArray(value)) value.forEach((v, i) => typeof v === 'string' && out.push({ path: `${at}[${i}]`, value: v }));
      else if (isRecord(value)) for (const [repo, v] of Object.entries(value)) if (typeof v === 'string') out.push({ path: `${at}.${repo}`, value: v });
    }
  }
  return out;
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
  /** Where your own dossier named `name` lives: `~/.toil/dossiers/<name>.json`. */
  userFile(name: string): string;
  /** The lookup a call would get from `dossier`, as if the folder were its repo `repo`: for judging a change before it's saved. */
  lookupOf(dossier: Dossier, repo?: string): DossierLookup;
  /**
   * The dossier files an import reads from `value`: the file, or every `.json`
   * in the folder. The bounds are checked before anything is looked at, so a
   * path outside them can't be probed for whether it exists.
   */
  importFiles(value: string): { folder: boolean; files: string[] };
  /** A path a call gave, absolute: relative to the CLI's working directory, or under MCP the workspace. */
  pathFor(value: string, what: string): string;
  /** A folder on this machine and the repository it's in, for `add-repo`; INVALID_INPUT when it isn't there. */
  inspect(dir: string): { path: string; repo?: FolderRepo };
  /**
   * The git repositories under `dir` (default: the workspace), for `toil repos
   * scan`: each one's root, branch and remotes, credentials stripped. `dir`
   * must be inside the workspace. Folders are walked to `depth` levels below
   * it, links aren't followed, and a repository's own folders aren't entered.
   */
  scanRepos(dir: string | undefined, depth: number): { folder: string; repos: ScannedRepo[]; truncated: boolean };
  /** `.toil/dossiers/` in the repository whose root is `dir`; INVALID_INPUT when `dir` isn't a repository's root. */
  repoFolder(dir: string): string;
  /**
   * Writes a dossier, validated, to `path`: `create` refuses a file that's
   * there, `replace` replaces only a valid dossier, `edit` rewrites the one it
   * was read from. The path must be a `.json` file in a dossier folder or the
   * workspace, never toil's own files, /proc or /sys. Files in your own folder
   * are readable by you only. Returns the absolute path written.
   */
  save(path: string, dossier: Dossier, mode: 'create' | 'replace' | 'edit'): string;
}

const FROM_WORKSPACE: Record<Workspace['source'], FolderSource> = { flag: 'flag', env: 'env', cwd: 'cwd', 'mcp-root': 'mcp-root', none: 'cwd' };

export function createDossierCatalog(o: CatalogOptions): DossierCatalog {
  const user = join(o.home, '.toil', 'dossiers');
  const own = join(o.home, '.toil');
  const guard = { home: o.home, env: o.env, protect: o.protect };
  const areaNames = new Map(o.areas.map((a) => [a.name, a]));
  /**
   * A folder's one canonical form, whether or not it exists yet: the nearest
   * folder above it that exists, real-pathed, with the rest added back. So
   * `~/.toil/dossiers` before the first dossier is made compares equal to a
   * real-pathed file inside it, even when the home is spelled another way
   * (a Windows 8.3 name such as RUNNER~1, macOS's /var for /private/var).
   */
  const real = (path: string) => {
    let existing = resolve(path);
    const rest: string[] = [];
    for (;;) {
      try {
        return join(realpathSync.native(existing), ...rest);
      } catch {
        const parent = resolve(existing, '..');
        if (parent === existing) return resolve(path);
        rest.unshift(basename(existing));
        existing = parent;
      }
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

  /**
   * Where a path a call names may be read from, decided before anything is
   * looked at: not toil's own files or a system path, and inside a dossier
   * folder or the workspace (anywhere, with the workspace bound relaxed).
   * Checking first means a path outside can't be probed for whether it exists.
   * Returns where it lies, as a source.
   */
  const bounded = (path: string, cwd: string | undefined, refuse: (why: string, fix: string) => ToilError): DossierSource => {
    const target = real(path);
    if (forbidden(target)) throw refuse("that's one of toil's own files, or a system path.", 'Pass a dossier file, or a dossier by name.');
    const where = places(cwd);
    // ~/.toil/dossiers is the one part of toil's own folder a dossier path may name.
    const source: DossierSource = inside(target, real(user))
      ? 'user'
      : where.listed.some((d) => inside(target, real(d)))
        ? 'listed'
        : where.repo && inside(target, real(where.repo))
          ? 'repo'
          : 'file';
    if (source === 'file' && o.config.bounds?.files !== 'unbounded' && !(o.workspace.dir && inside(target, real(o.workspace.dir)))) {
      throw refuse(
        `it's outside the workspace${o.workspace.dir ? ` (${forwardSlashes(o.workspace.dir)})` : ''} and outside every dossier folder.`,
        'Move it into the workspace, list its folder in dossierPaths (or TOIL_DOSSIER_PATHS), copy it in with toil dossiers import, or pass the dossier by name.',
      );
    }
    return source;
  };

  const missing = (path: string) =>
    new ToilError('INVALID_INPUT', `${forwardSlashes(path)} doesn't exist where toil is running.`, {
      fix: "Check the path. If toil runs somewhere else (a container, WSL, another host), its paths aren't yours: pass the dossier by name instead.",
    });

  /** A path on the call, bounded: a `.json` file in the workspace or a dossier place, never toil's config or /proc and /sys. */
  const readPath = (value: string, cwd?: string): DossierFile => {
    const path = fromBase(value, 'The dossier file');
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `${forwardSlashes(path)} can't be read as a dossier: ${why}`, { fix });
    if (!path.toLowerCase().endsWith('.json')) throw refuse('a dossier file ends in .json.', 'Pass a dossier file, or a dossier by name.');
    const source = bounded(path, cwd, refuse);
    let realPath: string;
    try {
      realPath = realpathSync.native(path);
      if (!statSync(realPath).isFile()) throw new Error('not a file');
    } catch {
      throw missing(path);
    }
    return readDossierFile(realPath, source, o.areas);
  };

  const importFiles: DossierCatalog['importFiles'] = (value) => {
    const path = fromBase(value, 'The import source');
    bounded(path, undefined, (why, fix) => new ToilError('INVALID_INPUT', `toil won't import from ${forwardSlashes(path)}: ${why}`, { fix }));
    let folder: boolean;
    try {
      folder = statSync(path).isDirectory();
    } catch {
      throw missing(path);
    }
    if (!folder) return { folder, files: [path] };
    return { folder, files: readdirSync(path).filter((n) => n.toLowerCase().endsWith('.json')).sort().map((n) => join(path, n)) };
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
    const files = scanned.files.filter(usable);
    for (const found of files) {
      const matched = matchRepo(found.dossier, f, repo);
      // A dossier checked into the repository you're in applies there, listed repo or not.
      if (!matched && found.source !== 'repo') continue;
      if (taken.has(found.dossier.name)) continue;
      taken.add(found.dossier.name);
      // Your own copy of a checked-in dossier (an import) wins wherever the checked-in one applies,
      // then a listed folder's: same name, the scan's order.
      const file = matched ? found : (files.find((x) => x.dossier.name === found.dossier.name) ?? found);
      const own = file === found ? matched : matchRepo(file.dossier, f, repo);
      candidates.push({ file, by: 'folder', match: own?.by ?? 'checked-in', ...(own ? { repo: own.name } : {}) });
    }
    const applied = candidates.length === 1 ? candidates[0] : undefined;
    if (applied) warnings.push(...sameName(scanned.files, applied.file.dossier.name));
    return { folder: f, ...(repo ? { repo } : {}), ...(applied ? { applied } : {}), candidates, warnings };
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
    // The folder a call names is checked now: it's the call's own input, and
    // its git applies whether or not any dossier does.
    const named = request.cwd !== undefined ? folder(request.cwd) : undefined;
    const git = named?.path ? o.git(named.path) : {};
    // Which dossier applies is worked out only when the resolver first asks,
    // so a call that never reaches the dossier step (every input given, or an
    // area with nothing set up) can't fail on a dossier it doesn't use.
    let chosen: { applied?: Applied; selection: Selection } | undefined;
    const choose = () => {
      if (chosen) return chosen;
      const selection = select(request);
      if (!selection.applied && selection.candidates.length > 1) {
        throw new ToilError('INVALID_INPUT', `${selection.candidates.length} dossiers apply to ${forwardSlashes(selection.folder.path ?? '')}: ${selection.candidates.map((c) => `${c.file.dossier.name} (${forwardSlashes(c.file.file)})`).join(', ')}.`, {
          fix: `Pass --dossier <name>, or set TOIL_DOSSIER, to pick one: ${selection.candidates.map((c) => c.file.dossier.name).join(', ')}.`,
        });
      }
      chosen = { ...(selection.applied ? { applied: selection.applied } : {}), selection };
      return chosen;
    };
    // A dossier the call or TOIL_DOSSIER names is checked now, as cwd is: it
    // can't be ambiguous, and a mistyped, broken or out-of-bounds one must
    // fail the call that named it, not wait for one that consults it. Only a
    // match from the folder waits.
    if (request.dossier !== undefined || o.env.TOIL_DOSSIER) choose();
    let lookup: DossierLookup | undefined;
    return {
      lookup: (area, key, input) => {
        const { applied } = choose();
        if (!applied) return undefined;
        lookup ??= lookupFor(applied);
        return lookup(area, key, input);
      },
      // Your own dossier's bindings are yours; a checked-in, listed or loose
      // file's are suggestions until you import it (docs/dossiers.md, Writes ask once).
      adopted: (_area, _connection, by) => by === 'dossier' && chosen?.applied?.file.source === 'user',
      hostFor: (area, input) => {
        const applied = chosen?.applied;
        return applied ? binding(applied.file.dossier, area, envOf(applied.file.dossier, area, input)).host : undefined;
      },
      // Only once a dossier was consulted: one that never mattered isn't reported.
      report: () => {
        const applied = chosen?.applied;
        if (!applied) return undefined;
        const f = chosen!.selection.folder;
        const folderReport = (applied.by === 'folder' || request.cwd !== undefined) && f.path ? { folder: { path: forwardSlashes(f.path), from: f.from } } : {};
        return {
          name: applied.file.dossier.name,
          source: applied.file.source,
          file: forwardSlashes(applied.file.file),
          by: applied.by,
          ...(applied.match ? { match: applied.match } : {}),
          ...(applied.repo ? { repo: applied.repo } : {}),
          ...folderReport,
        };
      },
      fields: (area, input) => {
        const { applied } = choose();
        if (!applied) return {};
        const dossier = applied.file.dossier;
        const sections = sectionsFor(dossier, area, envOf(dossier, area, input));
        // The environment's section first, so its aliases win.
        return Object.assign({}, ...sections.map((s) => (isRecord(s.fields) ? s.fields : {})).reverse()) as Record<string, string>;
      },
      view: (area) => {
        const { applied } = choose();
        if (!applied) return undefined;
        const d = applied.file.dossier;
        const sections = [
          ...(d.sections[area] ? [{ path: area, env: null, values: d.sections[area]! }] : []),
          ...Object.entries(d.environments).flatMap(([env, byArea]) => (byArea[area] ? [{ path: `environments.${env}.${area}`, env, values: byArea[area]! }] : [])),
        ];
        return { name: d.name, source: applied.file.source, file: forwardSlashes(applied.file.file), env: d.env ?? null, sections };
      },
      warnings: () => {
        if (!chosen) return [];
        const applied = chosen.applied;
        return [...chosen.selection.warnings, ...(applied ? applied.file.problems.filter((p) => p.level === 'warning').map((p) => problemWarning(applied.file, p)) : [])];
      },
      ...git,
    };
  };

  const userFile = (name: string) => join(user, `${name}.json`);

  const repoFolder = (dir: string): string => {
    const path = fromBase(dir, 'The repository');
    const repo = findGitRepo(path, guard);
    if (!repo || !samePath(repo.root, path)) {
      throw new ToilError('INVALID_INPUT', `${forwardSlashes(path)} isn't the root of a git repository${repo ? ` (its root is ${repo.root})` : ''}.`, {
        fix: repo ? `Pass ${repo.root}.` : 'Pass the top folder of a working tree, the one that holds .git.',
      });
    }
    return join(path, '.toil', 'dossiers');
  };

  const save: DossierCatalog['save'] = (path, dossier, mode) => {
    const target = resolve(path);
    const refuse = (why: string, fix: string) => new ToilError('INVALID_INPUT', `toil won't write a dossier to ${forwardSlashes(target)}: ${why}`, { fix });
    if (!target.toLowerCase().endsWith('.json')) throw refuse('a dossier file ends in .json.', 'Name a .json file.');
    // Judged where it would really land, through any link in the folders above it.
    const realTarget = real(target);
    if (forbidden(realTarget)) throw refuse("that's one of toil's own files, or a system path.", 'Write it to your dossier folder, a repository, or the workspace.');
    const where = places();
    // A repository's dossier folder: `.toil/dossiers/` right under a working tree's root.
    const folderOf = resolve(realTarget, '..');
    const rootOf = resolve(folderOf, '..', '..');
    const inRepoFolder = basename(folderOf) === 'dossiers' && basename(resolve(folderOf, '..')) === '.toil' && samePath(findGitRepo(rootOf, guard)?.root ?? '', rootOf);
    const inPlace = [user, ...where.listed].some((d) => inside(realTarget, real(d))) || inRepoFolder;
    const inWorkspace = o.workspace.dir !== undefined && inside(realTarget, real(o.workspace.dir));
    if (!inPlace && !inWorkspace && o.config.bounds?.files !== 'unbounded') {
      throw refuse(`it's outside the workspace${o.workspace.dir ? ` (${forwardSlashes(o.workspace.dir)})` : ''} and outside every dossier folder.`, 'Write it inside the workspace (--workspace <dir> chooses another), or to a repository with --repo.');
    }
    let exists = false;
    try {
      exists = statSync(realTarget).isFile();
    } catch {
      // nothing there yet
    }
    if (exists && mode === 'create') throw refuse('a file is already there.', 'Pass --replace to replace a dossier, or choose another name.');
    if (exists && mode === 'replace' && !readDossierFile(realTarget, 'file', o.areas).dossier) {
      throw refuse("the file there isn't a valid dossier, and toil only ever replaces a dossier.", 'Choose another path, or move that file aside.');
    }
    if (!exists && mode === 'edit') throw refuse('the dossier it was read from is gone.', 'Run the command again.');
    const checked = validateDossier(dossierContent(dossier), o.areas);
    const errors = checked.problems.filter((p) => p.level === 'error');
    if (errors.length > 0) {
      throw new ToilError('INVALID_INPUT', `That change would leave dossier ${dossier.name} invalid: ${errors[0]!.path ? `${errors[0]!.path}: ` : ''}${errors[0]!.message} Nothing was written.`, {
        fix: 'Correct the value and run the command again.',
        details: errors.map((p) => ({ path: p.path, message: p.message })),
      });
    }
    // Your own folder is yours alone, as the config is; a repository's files take the repository's.
    const yours = inside(realTarget, real(user));
    mkdirSync(resolve(realTarget, '..'), { recursive: true, ...(yours ? { mode: 0o700 } : {}) });
    // Written alongside and renamed into place, so a crash halfway leaves the old file, not half a new one.
    const temp = `${realTarget}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(dossierContent(dossier), null, 2)}\n`, { encoding: 'utf8', ...(yours ? { mode: 0o600 } : {}) });
    renameSync(temp, realTarget);
    return forwardSlashes(realTarget);
  };

  const inspect = (dir: string) => {
    const f = folder(dir);
    const repo = repoOf(f.path);
    return { path: f.path!, ...(repo ? { repo } : {}) };
  };

  const scanRepos: DossierCatalog['scanRepos'] = (dir, depth) => {
    const start = dir === undefined ? o.workspace.dir : fromBase(dir, 'The folder');
    if (start === undefined) {
      throw new ToilError('NOT_CONFIGURED', "There's no folder to scan: no workspace is set and none was given.", { fix: 'Pass a folder, or give the MCP server a workspace with --workspace <dir>.' });
    }
    const root = folder(start).path!;
    if (o.config.bounds?.files !== 'unbounded' && !(o.workspace.dir && inside(real(root), real(o.workspace.dir)))) {
      throw new ToilError('INVALID_INPUT', `${forwardSlashes(root)} is outside the workspace${o.workspace.dir ? `, ${forwardSlashes(o.workspace.dir)}` : ''}. Scans stay inside it.`, {
        fix: 'Scan a folder inside the workspace, or choose another workspace with --workspace <dir>.',
      });
    }
    const repos: ScannedRepo[] = [];
    let visited = 0;
    let truncated = false;
    const queue: Array<[string, number]> = [[root, 0]];
    while (queue.length > 0) {
      const [dir, level] = queue.shift()!;
      if (++visited > SCAN_LIMIT) {
        truncated = true;
        break;
      }
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      if (entries.some((e) => e.name === '.git')) {
        const repo = findGitRepo(dir, guard);
        if (repo && samePath(repo.root, dir)) {
          const branch = readGitBranch(repo) ?? 'unknown';
          const remotes = Object.fromEntries(readGitRemotes(repo, guard).map((r) => [r.name, stripUserinfo(r.url.split(' ')[0]!)]));
          repos.push({ name: basename(dir), path: repo.root, branch, remotes });
          // A repository's own folders hold its files, not other repositories.
          continue;
        }
      }
      if (level >= depth) continue;
      // Links aren't followed, so a scan can't wander out of the folder it was given.
      for (const e of entries.filter((x) => x.isDirectory() && !x.isSymbolicLink() && !SCAN_SKIP.has(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        queue.push([join(dir, e.name), level + 1]);
      }
    }
    repos.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { folder: forwardSlashes(root), repos, truncated };
  };

  const lookupOf: DossierCatalog['lookupOf'] = (dossier, repo) => lookupFor({ file: { file: '', source: 'user', problems: [], dossier }, by: 'input', ...(repo !== undefined ? { repo } : {}) });

  return { places, scan, find, select, place, binding, userFile, lookupOf, importFiles, pathFor: fromBase, inspect, scanRepos, repoFolder, save };
}

