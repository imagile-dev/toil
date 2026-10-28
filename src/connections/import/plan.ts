import type { DbSettings, Parsed, Skip } from './common.js';

/**
 * Turns what an importer found into what `connections import` would do: a name
 * for each connection, which of them are new, which collide with a connection
 * that exists, and which fail the real `db` schema and so would be refused if
 * they were saved. Pure: the existing connections and the schema check come in
 * as arguments, so the whole decision is a table test.
 *
 * Nothing here chooses to overwrite. A name already taken is reported and left
 * alone, the way a form letter handles a duplicate application.
 */
export interface ExistingConnection {
  name: string;
  /** Present only for `db` connections, which are the ones a duplicate check compares. */
  db?: { engine?: string; host?: string; port?: number; database?: string; path?: string };
}

export interface PlanOptions {
  parsed: Parsed;
  prefix?: string | undefined;
  /** A user for connections whose file names none. */
  user?: string | undefined;
  /** The name to give the one connection of a `--url` import. */
  name?: string | undefined;
  existing: readonly ExistingConnection[];
  /** The real schema's verdict on one mapped connection: undefined when valid, else why not. */
  validate: (engine: string, settings: DbSettings) => string | undefined;
}

export interface Planned {
  name: string;
  /** The tool's own name for it. */
  source: string;
  group: string[];
  engine: string;
  settings: DbSettings;
  warnings: string[];
  /** An existing connection with the same engine, host, port and database. */
  similarTo?: string;
  /** What to run next, in order, to make the connection usable. */
  nextSteps: string[];
}

export interface Exists {
  name: string;
  source: string;
  reason: string;
}

export interface Plan {
  create: Planned[];
  exists: Exists[];
  skipped: Skip[];
}

/** A tool's connection name as a toil one: lowercase letters, digits and single hyphens, starting with a letter. */
export function slugName(...parts: string[]): string {
  const slug = parts
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (slug === '') return 'db';
  return /^[a-z]/.test(slug) ? slug : `db-${slug}`;
}

const NAME_RESERVED = new Set(['constructor', 'prototype']);

export function planImport(options: PlanOptions): Plan {
  const taken = new Set(options.existing.map((e) => e.name));
  const used = new Set<string>();
  const plan: Plan = { create: [], exists: [], skipped: options.parsed.skipped.map((k) => ({ label: [...(k.group ?? []), k.label].join(" / "), reason: k.reason })) };
  const prefix = options.prefix ? slugName(options.prefix) : undefined;

  for (const c of options.parsed.candidates) {
    const base = options.name ?? slugName(...(prefix ? [prefix] : []), ...c.group, c.label);
    const name = options.name ? base : unique(base, used);
    const source = [...c.group, c.label].join(' / ');
    if (NAME_RESERVED.has(name)) {
      plan.skipped.push({ label: source, reason: `would be named "${name}", which toil reserves; rename it in the tool or use --prefix` });
      continue;
    }
    if (taken.has(name)) {
      plan.exists.push({ name, source, reason: `There is already a connection named "${name}", so it was left as it is.` });
      used.add(name);
      continue;
    }
    used.add(name);

    const settings = withUser(c.settings, options.user);
    const invalid = options.validate(c.engine, settings);
    if (invalid) {
      const needsUser = /\buser\b/.test(invalid) && !settings.user;
      plan.skipped.push({ label: source, reason: `${invalid}${needsUser ? ' Pass --user <name> to use one login for every connection that has none.' : ''}` });
      continue;
    }
    const similar = options.existing.find((e) => e.db && same(e.db, c.engine, settings));
    const warnings = [...c.warnings];
    if (similar) warnings.push(`It has the same engine, host, port and database as the existing connection "${similar.name}".`);
    plan.create.push({
      name,
      source,
      group: c.group,
      engine: c.engine,
      settings,
      warnings,
      ...(similar ? { similarTo: similar.name } : {}),
      nextSteps: nextSteps(name, c.engine, settings),
    });
  }
  return plan;
}

function unique(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 44).replace(/-+$/, '')}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function withUser(settings: DbSettings, user: string | undefined): DbSettings {
  if (!user || settings.user || settings.auth === 'windows' || settings.auth === 'nosasl' || settings.path) return settings;
  return { ...settings, user };
}

function same(existing: NonNullable<ExistingConnection['db']>, engine: string, s: DbSettings): boolean {
  if (existing.engine !== engine) return false;
  if (engine === 'sqlite') return existing.path !== undefined && existing.path === s.path;
  return (existing.host ?? '').toLowerCase() === (s.host ?? '').toLowerCase() && existing.port === s.port && existing.database === s.database;
}

/** The commands that finish a connection: its password goes in with `login`, and `test` proves it. SQLite and Windows sign-in have no password to enter. */
function nextSteps(name: string, engine: string, s: DbSettings): string[] {
  const needsPassword = engine !== 'sqlite' && s.auth !== 'windows' && s.auth !== 'nosasl';
  return [...(needsPassword ? [`toil connections login ${name}`] : []), `toil connections test ${name}`];
}

