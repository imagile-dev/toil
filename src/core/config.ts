import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ToilError } from './errors.js';

/**
 * Configuration is a map of areas (jira, jira-cloud, db, ...) to their settings.
 *
 * Precedence, highest first (CLAUDE.md, Configuration Precedence):
 *   1. TOIL_<AREA>_<KEY> environment variables
 *   2. the global config (~/.toil/config.json, or --config <path>)
 *
 * There is deliberately no repository-level file. A config file inside a repo
 * could be written by anyone who can push to it, or by an agent editing the
 * working tree, and use it to switch on writes or send the user's credentials
 * to a host of its choosing. Project knowledge lives in the user's own files.
 *
 * Well-known CI fallback variables are per integration and are resolved by the
 * integration itself, between 1 and 2.
 */
export type Settings = Record<string, unknown>;
export type Source = 'env' | 'global';

export interface ResolvedConfig {
  areas: Record<string, Settings>;
  /** Where each `area.key` came from, for `config check` and debugging. */
  sources: Record<string, Source>;
  files: { global: string };
  /** Things worth telling the user that aren't errors, surfaced in meta.warnings. */
  warnings: Array<{ code: string; message: string }>;
}

/** The config file format this toil reads and writes. */
export const CONFIG_VERSION = 1;

/**
 * Top-level keys that are never areas. Reserved now, before any toil writes
 * them, so a file from a newer toil is recognised rather than misread as
 * areas called "connections" and "defaults".
 */
const RESERVED_KEYS = new Set(['version', '$schema', 'connections', 'defaults']);

/** Every config made by a function, so tests and standalone commands share one shape. */
export function emptyConfig(globalPath = ''): ResolvedConfig {
  return { areas: {}, sources: {}, files: { global: globalPath }, warnings: [] };
}

export interface LoadConfigOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  configPath?: string | undefined;
  /** Registered area names, so TOIL_JIRA_CLOUD_TOKEN maps to jira-cloud, not jira. */
  knownAreas?: readonly string[];
}

export function loadConfig(options: LoadConfigOptions): ResolvedConfig {
  const globalPath = options.configPath ? resolve(options.cwd, options.configPath) : join(options.home, '.toil', 'config.json');
  const config = emptyConfig(globalPath);
  apply(config, readConfigFile(globalPath, config.warnings), 'global');
  apply(config, fromEnv(options.env, options.knownAreas ?? []), 'env');
  return config;
}

/** The setting for `area.key`, or undefined when unset at every level. */
export function setting<T = unknown>(config: ResolvedConfig, area: string, key: string): T | undefined {
  return config.areas[area]?.[key] as T | undefined;
}

/** Writes need a human's standing opt-in: `writes: true` on the area. */
export function writesEnabled(config: ResolvedConfig, area: string): boolean {
  const value = setting(config, area, 'writes');
  return value === true || value === 'true';
}

/** Whether the user has configured anything at all for an area. */
export function hasConfig(config: ResolvedConfig, area: string): boolean {
  return Object.keys(config.areas[area] ?? {}).length > 0;
}

function apply(config: ResolvedConfig, layer: Record<string, Settings>, source: Source): void {
  for (const [area, settings] of Object.entries(layer)) {
    const target = (config.areas[area] ??= {});
    for (const [key, value] of Object.entries(settings)) {
      target[key] = value;
      config.sources[`${area}.${key}`] = source;
    }
  }
}

function readConfigFile(path: string, warnings: ResolvedConfig['warnings']): Record<string, Settings> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ToilError('CONFIG_INVALID', `${path} is not valid JSON: ${(err as Error).message}`, {
      fix: `Fix the JSON in ${path}, or move it aside and run toil config init.`,
    });
  }
  if (!isRecord(parsed)) {
    throw new ToilError('CONFIG_INVALID', `${path} must contain a JSON object of areas.`, {
      fix: `Make ${path} look like { "jira": { "baseUrl": "https://jira.imagile.dev" } }.`,
    });
  }
  return migrateConfig(parsed, path, warnings);
}

/**
 * Turns a config file of any version this toil understands into the current
 * shape. Each format change adds a step here, with a test, so a file written
 * years ago still loads. A file from a newer toil is refused with an upgrade
 * hint rather than half-read.
 */
export function migrateConfig(raw: Record<string, unknown>, path: string, warnings: ResolvedConfig['warnings']): Record<string, Settings> {
  // Absent means version 1; present-but-null is a mistake, not a default.
  const version = 'version' in raw ? raw.version : 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ToilError('CONFIG_INVALID', `"version" in ${path} must be a whole number, found ${JSON.stringify(raw.version)}.`, {
      fix: `Remove "version" from ${path}, or set it to ${CONFIG_VERSION}.`,
    });
  }
  if (version > CONFIG_VERSION) {
    throw new ToilError('CONFIG_INVALID', `${path} was written by a newer toil (config version ${version}); this toil reads version ${CONFIG_VERSION}.`, {
      fix: 'Upgrade toil: npm install -g @imagile-dev/toil@latest.',
    });
  }

  const out: Record<string, Settings> = {};
  for (const [key, settings] of Object.entries(raw)) {
    if (RESERVED_KEYS.has(key)) {
      if (key === 'connections' || key === 'defaults') {
        warnings.push({ code: 'CONFIG_RESERVED_KEY', message: `"${key}" in ${path} is reserved for a later config version and was ignored.` });
      }
      continue;
    }
    if (!isRecord(settings)) {
      throw new ToilError('CONFIG_INVALID', `"${key}" in ${path} must be an object of settings.`, {
        fix: `Change "${key}" in ${path} to an object, for example { "baseUrl": "..." }.`,
      });
    }
    out[key] = settings;
  }
  return out;
}

/**
 * Environment variable names toil reserves for itself. They never map onto an
 * area, whatever areas exist now or later.
 */
const RESERVED_ENV = [/^TOIL_CONN_/, /^TOIL_DOSSIER$/, /^TOIL_ENV$/, /^TOIL_CONFIG/, /^TOIL_TIMEOUT_MS$/];

/** camelCase key to SNAKE: baseUrl -> BASE_URL, baseURL -> BASE_URL, apiKey2 -> API_KEY2. */
function snake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** The one place an (area, key) pair becomes a variable name: jira-cloud + baseUrl -> TOIL_JIRA_CLOUD_BASE_URL. */
export function envName(area: string, key: string): string {
  return `TOIL_${area.toUpperCase().replace(/-/g, '_')}_${snake(key)}`;
}

/**
 * The inverse of envName, against the areas toil knows. The longest matching
 * area wins, so TOIL_JIRA_CLOUD_TOKEN is jira-cloud.token. A name matching no
 * known area, or one toil reserves, is not config: it returns undefined rather
 * than guessing, so the same variable never means different things in
 * different versions.
 */
export function parseEnvName(name: string, knownAreas: readonly string[]): { area: string; key: string } | undefined {
  if (!name.startsWith('TOIL_') || RESERVED_ENV.some((re) => re.test(name))) return undefined;
  const rest = name.slice(5);
  const match = knownAreas
    .map((area) => ({ area, prefix: `${area.toUpperCase().replace(/-/g, '_')}_` }))
    .filter((p) => rest.startsWith(p.prefix) && rest.length > p.prefix.length)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!match) return undefined;
  const key = rest
    .slice(match.prefix.length)
    .toLowerCase()
    .split('_')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return { area: match.area, key };
}

/**
 * Every TOIL_<AREA>_<KEY> variable for a known area, as config. "true" and
 * "false" become booleans; everything else stays a string until areas declare
 * schemas that type their keys (#51).
 */
export function fromEnv(env: NodeJS.ProcessEnv, knownAreas: readonly string[] = []): Record<string, Settings> {
  const out: Record<string, Settings> = {};
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined) continue;
    const parsed = parseEnvName(name, knownAreas);
    if (!parsed) continue;
    const value: unknown = raw === 'true' ? true : raw === 'false' ? false : raw;
    (out[parsed.area] ??= {})[parsed.key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
