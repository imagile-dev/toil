import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ToilError } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';
import { lastValue, parseGitConfig } from '../core/git-config.js';
import { readGitBranch } from '../core/git-repo.js';

/**
 * The agent skill folders and marketplace clones the `skills` commands read
 * and write. They live outside the workspace on purpose: an agent host reads
 * `~/.claude/skills` wherever toil was started. So this is the one place
 * toil writes there, and it writes only to fixed places (docs/bounds.md,
 * `skills.folders`):
 *
 *   - the agent skill folders, at user scope under the home folder, or at
 *     project scope under the repository root (or the workspace, outside one)
 *   - a marketplace's clone, where the user's config puts it
 *
 * Inside a skills folder it replaces only skill folders it installed itself,
 * from the same marketplace and plugin; a folder of the same name that toil
 * didn't put there is left alone and reported (`files.no-overwrite`). It never
 * copies a symlink out of a marketplace, and never touches `~/.toil`.
 *
 * The file formats keep the shapes skills managers already write, so a folder
 * set up before reads the same way after: an index, `.toil-installed.json`;
 * a provenance file in each skill, `toil-origin.json`; and a hidden stash,
 * `.toil-disabled/`, for skills that are switched off. Switched off is not
 * deleted. Deletion requires a separate form, which has not been designed.
 */

/** Where each agent host reads skills, per scope, relative to the home folder or the project root. */
export const AGENTS = {
  // The cross-tool folder, read by Codex and GitHub Copilot alike, and so the default.
  codex: { project: '.agents/skills', user: '.agents/skills' },
  'github-copilot': { project: '.github/skills', user: '.copilot/skills' },
  'claude-code': { project: '.claude/skills', user: '.claude/skills' },
} as const;
export type AgentName = keyof typeof AGENTS;
export const AGENT_NAMES = Object.keys(AGENTS) as [AgentName, ...AgentName[]];
export const DEFAULT_AGENT: AgentName = 'codex';
export const AGENT_CHOICES = AGENT_NAMES.join(' | ');
export type Scope = 'project' | 'user';

export const META_FILE = '.toil-installed.json';
export const ORIGIN_FILE = 'toil-origin.json';
/** Starts with a dot so agent hosts don't read it as a skill. */
export const DISABLED_DIR = '.toil-disabled';

/** The two places a scope can resolve against. `project` is undefined with no workspace. */
export interface Roots {
  home: string;
  project: string | undefined;
}

/** One skills folder a command acts on. */
export interface Target {
  agent: AgentName;
  scope: Scope;
  /** Absolute, in the platform's own form. */
  dir: string;
}

/** Which agents a call names: `--claude` for claude-code, `--all-agents` for every one, else `--agent` or codex. */
export interface AgentChoice {
  agent?: AgentName | undefined;
  claude?: boolean | undefined;
  allAgents?: boolean | undefined;
}

/**
 * Home from the context; the project is the workspace's repository root, or
 * the workspace outside one, as agent hosts read project skills from the root.
 */
export function rootsOf(ctx: { home?: string | undefined; repo: () => { root: string } | undefined; files: { workspace: string | undefined } }): Roots {
  if (!ctx.home) throw new ToilError('NOT_CONFIGURED', 'The skills commands need a home folder, and none is known.', { fix: 'Set HOME (or USERPROFILE on Windows) and run the command again.' });
  return { home: ctx.home, project: ctx.repo()?.root ?? ctx.files.workspace };
}

export function agentOf(choice: AgentChoice): AgentName {
  return choice.claude ? 'claude-code' : (choice.agent ?? DEFAULT_AGENT);
}

/** The skills folder for one agent at one scope. Project scope with no workspace is NOT_CONFIGURED. */
export function skillsDir(agent: AgentName, scope: Scope, roots: Roots): string {
  if (scope === 'user') return resolve(roots.home, AGENTS[agent].user);
  if (roots.project === undefined) {
    throw new ToilError('NOT_CONFIGURED', 'Project scope needs a workspace, and there is none.', {
      fix: "Pass --workspace <dir> (in the MCP server's args for toil mcp), set TOIL_WORKSPACE, or use --scope user.",
    });
  }
  return resolve(roots.project, AGENTS[agent].project);
}

/** The folders a call installs into: one agent, or with `--all-agents` every one. */
export function targetsFor(choice: AgentChoice, scope: Scope, roots: Roots): Target[] {
  if (choice.allAgents) {
    if (choice.claude || choice.agent) {
      throw new ToilError('INVALID_INPUT', '--all-agents cannot be combined with --claude or --agent.', { fix: 'Pass --all-agents on its own, or name one agent.' });
    }
    return AGENT_NAMES.map((agent) => ({ agent, scope, dir: skillsDir(agent, scope, roots) }));
  }
  const agent = agentOf(choice);
  return [{ agent, scope, dir: skillsDir(agent, scope, roots) }];
}

export const slashes = forwardSlashes;

/** Whether `child` is `parent` or under it, compared case-insensitively on Windows. */
export function isWithin(child: string, parent: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(fold(resolve(parent)), fold(resolve(child)));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** A name that stays one folder inside `dir`: no separators, no dots, nothing hidden. */
function childOf(dir: string, name: string): string | undefined {
  if (name === '' || name.startsWith('.') || /[\\/]/.test(name)) return undefined;
  const path = resolve(dir, name);
  return dirname(path) === resolve(dir) ? path : undefined;
}

// ─── The install index ─────────────────────────────────────────────────────

/** Where a skill came from, as recorded when it was installed. */
export interface InstallRecord {
  source: 'marketplace' | 'bundled';
  marketplace?: string;
  plugin?: string;
  installedFrom?: string;
  branch?: string;
  installedAt: string;
  /** The toil version that installed it. */
  toilVersion?: string;
  [key: string]: unknown;
}

/** `.toil-installed.json`. Keys toil doesn't know are kept as found, so writing it back drops nothing. */
export interface InstalledMeta {
  version: 1;
  skills: Record<string, InstallRecord>;
  disabled?: Record<string, InstallRecord>;
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The index of a skills folder, as written. A missing one is empty. One that
 * isn't valid is an error rather than empty: treating it as empty would
 * replace it, and with it every record a person can't recreate.
 */
export function readMeta(dir: string): InstalledMeta {
  const path = join(dir, META_FILE);
  if (!existsSync(path)) return { version: 1, skills: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw badMeta(path, `it isn't valid JSON (${(err as Error).message})`);
  }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.skills) || (raw.disabled !== undefined && !isRecord(raw.disabled))) {
    throw badMeta(path, 'it isn\'t { "version": 1, "skills": { ... } }');
  }
  return raw as InstalledMeta;
}

function badMeta(path: string, why: string): ToilError {
  return new ToilError('INVALID_INPUT', `${slashes(path)} can't be read: ${why}. Nothing was changed.`, {
    fix: `Fix ${slashes(path)}, or move it aside to start the index again.`,
  });
}

/** Writes the index alongside and renames it into place, so a crash leaves the old one. */
export function writeMeta(dir: string, meta: InstalledMeta): void {
  const path = join(dir, META_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

/** The per-skill provenance file, for a skill the index doesn't list. */
function readOrigin(skillDir: string): InstallRecord | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(skillDir, ORIGIN_FILE), 'utf8')) as unknown;
    if (isRecord(raw) && raw.version === 1 && (raw.source === 'marketplace' || raw.source === 'bundled')) {
      const record: Record<string, unknown> = { ...raw };
      delete record.version;
      return record as InstallRecord;
    }
  } catch {
    // No origin file, or not one toil wrote: the skill is untracked.
  }
  return undefined;
}

/** A skill's record: the index first, then its own origin file. */
export function recordOf(meta: InstalledMeta, dir: string, name: string): InstallRecord | undefined {
  return meta.skills[name] ?? readOrigin(join(dir, name));
}

/** The skill folders in `dir`: visible folders holding a SKILL.md. */
export function activeSkills(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      if (name.startsWith('.')) return false;
      try {
        return statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'SKILL.md'));
      } catch {
        return false;
      }
    })
    .sort();
}

/** The marketplace a command acts for: its connection name and clone URL. */
export interface MarketplaceRef {
  name: string;
  repoUrl: string;
}

/** Whether a record came from this marketplace, by the name it was installed under or its clone URL. */
export function fromMarketplace(record: InstallRecord, m: MarketplaceRef): boolean {
  return record.source === 'marketplace' && (record.marketplace === m.name || record.installedFrom === m.repoUrl);
}

// ─── Enable and disable ────────────────────────────────────────────────────

export interface DisableResult {
  disabled: string[];
  alreadyDisabled: string[];
  skipped: string[];
}

/**
 * Moves every active skill of `plugin` from this marketplace into the stash,
 * and its record from `skills` to `disabled` in the index. Nothing else in
 * the index changes, and it's written only when something moved.
 */
export function disablePlugin(dir: string, plugin: string, m: MarketplaceRef): DisableResult {
  const meta = readMeta(dir);
  const stash = join(dir, DISABLED_DIR);
  const result: DisableResult = { disabled: [], alreadyDisabled: [], skipped: [] };
  for (const name of activeSkills(dir)) {
    const record = recordOf(meta, dir, name);
    const from = childOf(dir, name);
    if (!from || !record || !fromMarketplace(record, m) || record.plugin !== plugin) {
      result.skipped.push(name);
      continue;
    }
    mkdirSync(stash, { recursive: true });
    const to = join(stash, name);
    // A stale stashed copy of a skill that is also active: the active one is newer.
    rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
    delete meta.skills[name];
    (meta.disabled ??= {})[name] = record;
    result.disabled.push(name);
  }
  for (const [name, record] of Object.entries(meta.disabled ?? {})) {
    if (record.plugin === plugin && fromMarketplace(record, m) && !result.disabled.includes(name)) result.alreadyDisabled.push(name);
  }
  if (result.disabled.length > 0) writeMeta(dir, meta);
  return result;
}

export interface EnableResult {
  enabled: string[];
  /** Recorded as disabled, but the stashed copy is gone: re-installing the plugin restores them. */
  stashMissing: string[];
  skipped: string[];
  hadDisabled: boolean;
}

/**
 * Moves every stashed skill of `plugin` from this marketplace back, and its
 * record from `disabled` to `skills`. A record whose stashed copy is gone
 * stays in `disabled`, so the index never claims a skill that isn't there.
 */
export function enablePlugin(dir: string, plugin: string, m: MarketplaceRef): EnableResult {
  const meta = readMeta(dir);
  const stash = join(dir, DISABLED_DIR);
  const entries = Object.entries(meta.disabled ?? {});
  const result: EnableResult = { enabled: [], stashMissing: [], skipped: [], hadDisabled: entries.length > 0 };
  for (const [name, record] of entries) {
    // The name comes from a file anyone can edit: it has to stay one folder inside `dir`.
    const to = childOf(dir, name);
    if (!to || record.plugin !== plugin || !fromMarketplace(record, m)) {
      result.skipped.push(name);
      continue;
    }
    const from = join(stash, name);
    if (!existsSync(from)) {
      result.stashMissing.push(name);
      continue;
    }
    if (existsSync(to)) {
      // Something else took the name while it was off; it isn't toil's to replace.
      result.skipped.push(name);
      continue;
    }
    renameSync(from, to);
    meta.skills[name] = record;
    delete meta.disabled![name];
    result.enabled.push(name);
  }
  if (existsSync(stash) && readdirSync(stash).length === 0) rmdirSync(stash);
  if (result.enabled.length > 0) writeMeta(dir, meta);
  return result;
}

// ─── Plugins in a marketplace clone ────────────────────────────────────────

export interface PluginChoice {
  name: string;
  description: string;
  /** Where the plugin lives in the clone, as marketplace.json says (`./plugins/review`, `./`); else `plugins/<name>`. */
  source?: unknown;
  /** Its skill folders, relative to `source`, when marketplace.json lists them; else every folder in `<source>/skills`. */
  skills?: unknown;
}

/**
 * The plugins a marketplace offers: `.claude-plugin/marketplace.json` when it
 * lists any, else each folder under `plugins/`.
 */
export function pluginsIn(clone: string): PluginChoice[] {
  const listed = join(clone, '.claude-plugin', 'marketplace.json');
  if (existsSync(listed)) {
    try {
      const meta = JSON.parse(readFileSync(listed, 'utf8')) as { plugins?: unknown };
      if (Array.isArray(meta.plugins) && meta.plugins.length > 0) {
        return meta.plugins
          .filter((p): p is Record<string, unknown> & { name: string } => isRecord(p) && typeof p.name === 'string')
          .map((p) => ({
            name: p.name,
            description: typeof p.description === 'string' ? p.description : '',
            ...('source' in p ? { source: p.source } : {}),
            ...('skills' in p ? { skills: p.skills } : {}),
          }));
      }
    } catch {
      // Not valid JSON: fall back to the folders, as an index nobody maintains usually is.
    }
  }
  const dir = join(clone, 'plugins');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => ({ name, description: '' }));
}

/** `rel` under `base`, or undefined when it would leave it. */
function under(base: string, rel: string): string | undefined {
  const path = resolve(base, rel);
  return isWithin(path, base) ? path : undefined;
}

/**
 * A real folder inside the clone, not a symlink to one and not reached through
 * one: a marketplace never gets to point toil elsewhere on disk.
 */
function isRealDir(path: string, clone: string): boolean {
  try {
    return lstatSync(path).isDirectory() && isWithin(realpathSync.native(path), realpathSync.native(clone));
  } catch {
    return false;
  }
}

/** One skill to copy: its folder name and where it is in the clone. */
export interface SkillSource {
  name: string;
  dir: string;
}

/**
 * Where a plugin's skills are in the clone. A plugin at `plugins/<name>` (or
 * marketplace.json's relative `source`) offers every folder in its `skills/`,
 * or the folders its `skills` list names. Undefined when it has none here;
 * a plugin whose `source` is another repository isn't fetched (`remote`).
 */
export function skillSources(clone: string, choice: PluginChoice): SkillSource[] | 'remote' | undefined {
  const outside = (what: string) =>
    new ToilError('INVALID_INPUT', `Plugin "${choice.name}" ${what}, outside the marketplace's clone, so toil didn't read it.`, {
      fix: "Check the marketplace's .claude-plugin/marketplace.json.",
    });
  let root: string | undefined;
  if (choice.source === undefined) {
    root = childOf(join(clone, 'plugins'), choice.name);
    if (!root) throw new ToilError('INVALID_INPUT', `"${choice.name}" isn't a plugin name.`, { fix: 'Pass a plugin name as toil skills marketplace plugins lists it.' });
  } else if (typeof choice.source === 'string') {
    root = under(clone, choice.source);
    if (!root) throw outside(`names a source of ${JSON.stringify(choice.source)}`);
  } else {
    return 'remote';
  }
  if (Array.isArray(choice.skills)) {
    const out: SkillSource[] = [];
    for (const rel of choice.skills) {
      if (typeof rel !== 'string') continue;
      const dir = under(root, rel);
      if (!dir || !isWithin(dir, clone)) throw outside(`lists a skill at ${JSON.stringify(rel)}`);
      if (isRealDir(dir, clone)) out.push({ name: basename(dir), dir });
    }
    return out.length > 0 ? out : undefined;
  }
  const skills = join(root, 'skills');
  if (!isRealDir(skills, clone)) return undefined;
  return readdirSync(skills)
    .filter((name) => isRealDir(join(skills, name), clone))
    .sort()
    .map((name) => ({ name, dir: join(skills, name) }));
}

/** The plugins installed here from this marketplace, active or disabled. */
export function installedPlugins(dir: string, m: MarketplaceRef): string[] {
  if (!existsSync(dir)) return [];
  const meta = readMeta(dir);
  const out = new Set<string>();
  for (const records of [meta.skills, meta.disabled ?? {}]) {
    for (const record of Object.values(records)) if (record.plugin && fromMarketplace(record, m)) out.add(record.plugin);
  }
  return [...out].sort();
}

// ─── Installing ────────────────────────────────────────────────────────────

export interface CopyResult {
  installed: string[];
  failed: string[];
  /** Folders already there that toil didn't install from this plugin, so it left them alone. */
  notReplaced: string[];
}

/**
 * Copies a plugin's skills into `dir` and records them. A skill toil
 * installed from this marketplace and plugin is replaced; one that is
 * switched off has its stashed copy refreshed and stays off; any other folder
 * of the same name is left exactly as it is. Symlinks are never copied.
 */
export function installPlugin(
  sources: SkillSource[],
  dir: string,
  record: { marketplace: string; plugin: string; installedFrom: string; branch?: string | undefined },
  m: MarketplaceRef,
  toilVersion: string,
): CopyResult {
  mkdirSync(dir, { recursive: true });
  const meta = readMeta(dir);
  const result: CopyResult = { installed: [], failed: [], notReplaced: [] };
  const active: string[] = [];
  const copy = (from: string, to: string) => {
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true, filter: (path) => !lstatSync(path).isSymbolicLink() });
  };
  for (const { name, dir: from } of sources) {
    const to = childOf(dir, name);
    if (!to) {
      result.failed.push(name);
      continue;
    }
    const stashed = meta.disabled?.[name];
    if (stashed && stashed.plugin === record.plugin && fromMarketplace(stashed, m)) {
      copy(from, join(dir, DISABLED_DIR, name));
      result.installed.push(name);
      continue;
    }
    if (existsSync(to)) {
      const existing = recordOf(meta, dir, name);
      if (!existing || existing.plugin !== record.plugin || !fromMarketplace(existing, m)) {
        result.notReplaced.push(name);
        result.failed.push(name);
        continue;
      }
    }
    copy(from, to);
    result.installed.push(name);
    active.push(name);
  }
  if (active.length > 0) {
    const now = new Date().toISOString();
    for (const name of active) {
      const full: InstallRecord = {
        source: 'marketplace',
        marketplace: record.marketplace,
        plugin: record.plugin,
        installedFrom: record.installedFrom,
        ...(record.branch ? { branch: record.branch } : {}),
        installedAt: now,
        toilVersion,
      };
      meta.skills[name] = full;
      writeFileSync(join(dir, name, ORIGIN_FILE), `${JSON.stringify({ version: 1, ...full }, null, 2)}\n`, 'utf8');
    }
    writeMeta(dir, meta);
  }
  return result;
}

// ─── Reading a clone's git metadata, without git ───────────────────────────

/** Whether `dir` holds a git clone of its own (not merely sits inside one). */
export function isClone(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/** The clone's branch, read from `.git` in pure JS; undefined when detached or unreadable. */
export function cloneBranch(dir: string): string | undefined {
  if (!isClone(dir)) return undefined;
  const gitDir = join(dir, '.git');
  const branch = readGitBranch({ root: slashes(dir), gitDir, commonDir: gitDir });
  return branch === 'HEAD' ? undefined : branch;
}

/** The clone's `origin` URL from its own `.git/config`, with any http(s) userinfo (a token) dropped. */
export function cloneOrigin(dir: string): string | null {
  try {
    const url = lastValue(parseGitConfig(readFileSync(join(dir, '.git', 'config'), 'utf8')), 'remote.origin.url');
    return typeof url === 'string' ? url.replace(/^(https?:\/\/)[^/@]*@/i, '$1') : null;
  } catch {
    return null;
  }
}

// ─── Where things are, for status ──────────────────────────────────────────

export interface SkillLocation {
  agent: string;
  scope: 'project' | 'user' | 'custom';
  path: string;
  exists: boolean;
  totalSkills: number;
  marketplaceSkills: number;
  bundledSkills: number;
  untrackedSkills: number;
  disabledSkills: number;
  disabledStashMissing: string[];
}

/** Counts for one skills folder; the three buckets are exclusive and add up to `totalSkills`. */
export function summarize(agent: AgentName, scope: Scope, dir: string): SkillLocation {
  const base: SkillLocation = {
    agent,
    scope,
    path: slashes(dir),
    exists: existsSync(dir),
    totalSkills: 0,
    marketplaceSkills: 0,
    bundledSkills: 0,
    untrackedSkills: 0,
    disabledSkills: 0,
    disabledStashMissing: [],
  };
  if (!base.exists) return base;
  const meta = readMeta(dir);
  for (const name of activeSkills(dir)) {
    base.totalSkills++;
    const record = recordOf(meta, dir, name);
    if (record?.source === 'marketplace') base.marketplaceSkills++;
    else if (record?.source === 'bundled') base.bundledSkills++;
    else base.untrackedSkills++;
  }
  const disabled = Object.keys(meta.disabled ?? {});
  base.disabledSkills = disabled.length;
  base.disabledStashMissing = disabled.filter((name) => !existsSync(join(dir, DISABLED_DIR, name)));
  return base;
}

/** Every built-in skills folder: each agent at project scope (when there is a project) and at user scope. */
export function knownFolders(roots: Roots): Target[] {
  return AGENT_NAMES.flatMap((agent) =>
    (['project', 'user'] as const).filter((scope) => scope === 'user' || roots.project !== undefined).map((scope) => ({ agent, scope, dir: skillsDir(agent, scope, roots) })),
  );
}
