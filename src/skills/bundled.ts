import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfigForEdit, type ResolvedConfig } from '../core/config.js';
import type { Warning } from '../core/envelope.js';
import { ToilError } from '../core/errors.js';
import { skillFiles } from '../skill-pages.generated.js';
import { ORIGIN_FILE, knownFolders, readMeta, recordOf, slashes, writeMeta, type InstallRecord, type Roots, type Target } from './folders.js';

/**
 * The toil skill that ships inside toil: skills/toil/*.md, embedded in the
 * bundle at build time (src/skill-pages.generated.ts), written into an agent
 * host's skills folder by `toil skill install`, and kept current from then on
 * without anyone asking.
 *
 * The one thing that isn't a copy is SKILL.md's `description`, which agent
 * hosts read to decide when to load the skill. It names the areas and database
 * engines the user has connections for, by name only, never a host, a user
 * or a credential, so an agent reaches for toil when a task touches one of
 * them. With no connections it is the general text the repository's SKILL.md
 * carries.
 *
 * Only a `toil` folder that toil recorded as `bundled` is ever rewritten: a
 * copy someone made by hand, or one a marketplace installed, is theirs, and
 * stays exactly as it is (docs/bounds.md, `skills.folders`). A rewrite that
 * fails is a warning on whatever command triggered it, never that command's
 * failure. Keeping a document current without a review cycle is unusual here,
 * but the document asked nicely.
 */

export const SKILL_NAME = 'toil';

/** What the generated description says, and what it was made from. */
export interface SkillDescription {
  description: string;
  /** Areas with a connection, the db area aside, sorted. */
  areas: string[];
  /** Database engines a db connection names, sorted. */
  engines: string[];
  /** Connections that exist only because TOIL_* env vars define them, sorted. */
  envOnly: string[];
}

/** A file's `key: value` frontmatter lines. */
function frontmatterOf(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const out: Record<string, string> = {};
  for (const line of match?.[1]?.split('\n') ?? []) {
    const at = line.indexOf(': ');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 2).trim();
  }
  return out;
}

const INDEX = skillFiles['SKILL.md'] ?? '';
/** The description the repository's SKILL.md carries, used when nothing is configured. */
export const GENERAL_DESCRIPTION = frontmatterOf(INDEX).description ?? '';

/** `a`, `a and b`, `a, b and c`. */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The description for this config: the configured areas and engines, then
 * the general triggers. `fileConnections` names the connections in the config
 * file; any other connection came from env vars alone and is reported as such.
 */
export function describeConfig(config: ResolvedConfig, knownAreas: readonly string[], fileConnections: ReadonlySet<string>): SkillDescription {
  const areas = new Set<string>();
  const engines = new Set<string>();
  const envOnly: string[] = [];
  for (const [name, conn] of Object.entries(config.connections)) {
    if (!knownAreas.includes(conn.area)) continue;
    if (conn.area === 'db') {
      if (typeof conn.engine === 'string' && /^[a-z0-9-]+$/.test(conn.engine)) engines.add(conn.engine);
    } else areas.add(conn.area);
    if (!fileConnections.has(name)) envOnly.push(name);
  }
  const a = [...areas].sort();
  const e = [...engines].sort();
  if (a.length === 0 && e.length === 0) return { description: GENERAL_DESCRIPTION, areas: a, engines: e, envOnly: envOnly.sort() };
  const what = [...(a.length ? [`the toil areas set up on this machine (${listed(a)})`] : []), ...(e.length ? [`databases (${listed(e)})`] : [])];
  const description =
    `Use toil, a structured-JSON CLI and MCP server, to read from and (when allowed) write to ${listed(what)}. ` +
    'Use when a task needs data from one of them, or mentions `toil` commands, `toil mcp`, a toil connection, or a TOIL_* environment variable.';
  return { description, areas: a, engines: e, envOnly: envOnly.sort() };
}

/** The connection names in the config file at `path`; none when there's no file or it can't be read. */
export function connectionsInFile(path: string): Set<string> {
  try {
    return new Set(Object.keys(readConfigForEdit(path).connections));
  } catch {
    return new Set();
  }
}

/**
 * The skill's files as installed: every file the bundle carries, with
 * SKILL.md's description replaced and, when something is configured, a short
 * index of the configured areas' references appended.
 */
export function skillFilesFor(d: SkillDescription): Record<string, string> {
  const index = INDEX.replace(/^(---\n[\s\S]*?^description: ).*$/m, `$1${d.description}`);
  const pages = [...d.areas, ...(d.engines.length ? ['db'] : [])]
    .sort()
    .flatMap((area) => {
      const text = skillFiles[`${area}.md`];
      return text ? [`- \`${area}.md\`: ${frontmatterOf(text).description ?? area}${area === 'db' ? `. Engines set up here: ${d.engines.join(', ')}` : ''}`] : [];
    });
  const configured = pages.length
    ? `${index.trimEnd()}\n\n## Configured here\n\nWhen this skill was written, toil had connections for these areas. Each reference is beside this file; every other area's is too, for one set up later.\n\n${pages.join('\n')}\n`
    : index;
  return { ...skillFiles, 'SKILL.md': configured };
}

/** Whether `dir/toil` is free to write: absent, or a skill toil recorded as bundled. */
function ownedOrFree(dir: string): { free: boolean; record: InstallRecord | undefined } {
  const path = join(dir, SKILL_NAME);
  if (!existsSync(path)) return { free: true, record: undefined };
  const record = recordOf(readMeta(dir), dir, SKILL_NAME);
  return { free: record?.source === 'bundled', record };
}

/**
 * Writes the skill into `dir/toil` and records it as bundled. The files go
 * into a hidden folder beside it first; the old copy is renamed aside, the
 * new one renamed in, and only then is the old one deleted, so an agent never
 * reads half of each and a failed swap puts the old copy back. The index is
 * read before anything is written, so one that can't be read changes nothing.
 */
export function writeBundledSkill(dir: string, files: Record<string, string>, version: string): InstallRecord {
  mkdirSync(dir, { recursive: true });
  const meta = readMeta(dir);
  const final = join(dir, SKILL_NAME);
  const staging = join(dir, `.toil-staging-${SKILL_NAME}-${process.pid}`);
  const aside = join(dir, `.toil-replaced-${SKILL_NAME}-${process.pid}`);
  const record: InstallRecord = { source: 'bundled', installedAt: new Date().toISOString(), toilVersion: version };
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staging, name), text, 'utf8');
    writeFileSync(join(staging, ORIGIN_FILE), `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`, 'utf8');
    rmSync(aside, { recursive: true, force: true });
    const had = existsSync(final);
    if (had) renameSync(final, aside);
    try {
      renameSync(staging, final);
    } catch (err) {
      if (had) renameSync(aside, final);
      throw err;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(aside, { recursive: true, force: true });
  }
  meta.skills[SKILL_NAME] = record;
  writeMeta(dir, meta);
  return record;
}

/** Installs into one target, refusing a `toil` folder toil didn't install. Returns whether one was replaced. */
export function installBundledSkill(target: Target, d: SkillDescription, version: string): { replaced: boolean; record: InstallRecord } {
  const { free, record: existing } = ownedOrFree(target.dir);
  if (!free) {
    const path = slashes(join(target.dir, SKILL_NAME));
    throw new ToilError('INVALID_INPUT', `${path} is already there, and toil didn't install it${existing?.source === 'marketplace' ? ` (it came from marketplace ${existing.marketplace ?? 'unknown'})` : ''}, so it was left as it is. Nothing was written.`, {
      fix: `Move ${path} aside (it may be a copy made by hand), then run toil skill install again.`,
    });
  }
  return { replaced: existing !== undefined, record: writeBundledSkill(target.dir, skillFilesFor(d), version) };
}

/** One bundled toil skill on disk. */
export interface InstalledSkill {
  agent: string;
  scope: Target['scope'];
  path: string;
  toilVersion: string | null;
  installedAt: string | null;
  /** Written by another toil version, so the next run rewrites it. */
  stale: boolean;
  /** Its files are the ones toil would write now, description included. */
  current: boolean;
}

/** Every bundled toil skill in the known folders. A folder whose index can't be read is skipped with a warning. */
export function bundledSkills(roots: Roots, d: SkillDescription, version: string, warn: (w: Warning) => void): InstalledSkill[] {
  const want = skillFilesFor(d);
  const out: InstalledSkill[] = [];
  for (const t of knownFolders(roots)) {
    const path = join(t.dir, SKILL_NAME);
    if (!existsSync(path)) continue;
    let record: InstallRecord | undefined;
    try {
      record = recordOf(readMeta(t.dir), t.dir, SKILL_NAME);
    } catch (err) {
      warn({ code: 'SKILLS_INDEX_UNREADABLE', message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (record?.source !== 'bundled') continue;
    const version_ = typeof record.toilVersion === 'string' ? record.toilVersion : null;
    out.push({
      agent: t.agent,
      scope: t.scope,
      path: slashes(path),
      toilVersion: version_,
      installedAt: record.installedAt ?? null,
      stale: version_ !== version,
      current: version_ === version && Object.entries(want).every(([name, text]) => readText(join(path, name)) === text),
    });
  }
  return out;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export interface UpkeepOptions {
  roots: Roots;
  version: string;
  /** Registered area names, so a connection to an area toil doesn't have isn't named. */
  areas: readonly string[];
  /** The config this call loaded, and how to load it again after a command changed the file. */
  config: ResolvedConfig;
  reload: () => ResolvedConfig;
  /** The config file's text before the command ran, and how to read it now; `undefined` when there's none. */
  before: string | undefined;
  read: () => string | undefined;
  warn: (w: Warning) => void;
}

/**
 * Run after every command that loads config. Two things rewrite a bundled
 * toil skill: the command changed the config file (a connection added,
 * changed or removed), which rewrites every one whose files differ from what
 * the new config gives; or a bundled skill was written by another toil
 * version, which rewrites that one. Anything else leaves the folders alone,
 * so a run with different env vars never rewrites a description on its own.
 */
export function keepSkillCurrent(o: UpkeepOptions): void {
  try {
    const changed = o.read() !== o.before;
    const config = changed ? o.reload() : o.config;
    const d = describeConfig(config, o.areas, connectionsInFile(config.files.global));
    const files = skillFilesFor(d);
    const rewritten: string[] = [];
    for (const skill of bundledSkills(o.roots, d, o.version, o.warn)) {
      if (skill.current || (!changed && !skill.stale)) continue;
      try {
        writeBundledSkill(join(skill.path, '..'), files, o.version);
        rewritten.push(changed ? skill.path : `${skill.path} (written by toil ${skill.toilVersion ?? 'of an unknown version'})`);
      } catch (err) {
        o.warn({
          code: 'SKILL_REWRITE_FAILED',
          message: `The toil skill in ${skill.path} couldn't be rewritten: ${err instanceof Error ? err.message : String(err)}. It still works; run toil skill install --allow-write to try again.`,
        });
      }
    }
    if (rewritten.length === 0) return;
    const why = changed ? 'the config changed' : 'another toil version wrote it';
    const env = d.envOnly.length ? ` It names ${listed(d.envOnly)}, set only by TOIL_* env vars in this process.` : '';
    o.warn({ code: 'SKILL_REWRITTEN', message: `Rewrote the toil skill in ${listed(rewritten)}, because ${why}.${env}` });
  } catch (err) {
    o.warn({ code: 'SKILL_REWRITE_FAILED', message: `toil couldn't check its installed skill: ${err instanceof Error ? err.message : String(err)}` });
  }
}

