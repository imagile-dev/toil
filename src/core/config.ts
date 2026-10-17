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
  const config: ResolvedConfig = { areas: {}, sources: {}, files: { global: globalPath } };
  apply(config, readConfigFile(globalPath), 'global');
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

function readConfigFile(path: string): Record<string, Settings> {
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
  const out: Record<string, Settings> = {};
  for (const [area, settings] of Object.entries(parsed)) {
    if (!isRecord(settings)) {
      throw new ToilError('CONFIG_INVALID', `"${area}" in ${path} must be an object of settings.`, {
        fix: `Change "${area}" in ${path} to an object, for example { "baseUrl": "..." }.`,
      });
    }
    out[area] = settings;
  }
  return out;
}

/**
 * TOIL_JIRA_BASE_URL -> { jira: { baseUrl } }, and with "jira-cloud" known,
 * TOIL_JIRA_CLOUD_TOKEN -> { "jira-cloud": { token } }. The longest known area
 * wins; a name matching no known area falls back to its first segment.
 * "true"/"false" become booleans.
 */
export function fromEnv(env: NodeJS.ProcessEnv, knownAreas: readonly string[] = []): Record<string, Settings> {
  const prefixes = knownAreas
    .map((area) => ({ area, prefix: `${area.toUpperCase().replace(/-/g, '_')}_` }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const out: Record<string, Settings> = {};
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined || !name.startsWith('TOIL_')) continue;
    const rest = name.slice(5);
    const known = prefixes.find((p) => rest.startsWith(p.prefix) && rest.length > p.prefix.length);
    let area: string | undefined;
    let keyPart: string;
    if (known) {
      area = known.area;
      keyPart = rest.slice(known.prefix.length);
    } else {
      const [first, ...tail] = rest.split('_');
      area = first?.toLowerCase();
      keyPart = tail.join('_');
    }
    if (!area || keyPart === '') continue;
    const key = keyPart
      .toLowerCase()
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
    const value: unknown = raw === 'true' ? true : raw === 'false' ? false : raw;
    (out[area] ??= {})[key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
