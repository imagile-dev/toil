import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ToilError } from './errors.js';

/**
 * Configuration is a map of areas (jira, db, ...) to their settings.
 *
 * Precedence, highest first (CLAUDE.md, Configuration Precedence):
 *   1. TOIL_<AREA>_<KEY> environment variables
 *   2. .toil.json in the repository (found by walking up from cwd)
 *   3. the global config (~/.toil/config.json, or --config <path>)
 *
 * Well-known CI fallback variables are per integration and are resolved by the
 * integration itself, between 1 and 2.
 */
export type Settings = Record<string, unknown>;
export type Source = 'env' | 'repo' | 'global';

export interface ResolvedConfig {
  areas: Record<string, Settings>;
  /** Where each `area.key` came from, for `config check` and debugging. */
  sources: Record<string, Source>;
  files: { global: string; repo: string | undefined };
}

export interface LoadConfigOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  configPath?: string | undefined;
}

export function loadConfig(options: LoadConfigOptions): ResolvedConfig {
  const globalPath = options.configPath ? resolve(options.cwd, options.configPath) : join(options.home, '.toil', 'config.json');
  const repoPath = findRepoConfig(options.cwd);

  const config: ResolvedConfig = { areas: {}, sources: {}, files: { global: globalPath, repo: repoPath } };
  apply(config, readConfigFile(globalPath), 'global');
  if (repoPath) apply(config, readConfigFile(repoPath), 'repo');
  apply(config, fromEnv(options.env), 'env');
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

function apply(config: ResolvedConfig, layer: Record<string, Settings>, source: Source): void {
  for (const [area, settings] of Object.entries(layer)) {
    const target = (config.areas[area] ??= {});
    for (const [key, value] of Object.entries(settings)) {
      target[key] = value;
      config.sources[`${area}.${key}`] = source;
    }
  }
}

/** Walk up from cwd to the first .toil.json, stopping at a repository root. */
function findRepoConfig(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, '.toil.json');
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, '.git'))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
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

/** TOIL_JIRA_BASE_URL -> { jira: { baseUrl } }. "true"/"false" become booleans. */
export function fromEnv(env: NodeJS.ProcessEnv): Record<string, Settings> {
  const out: Record<string, Settings> = {};
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined || !name.startsWith('TOIL_')) continue;
    const [area, ...rest] = name.slice(5).toLowerCase().split('_');
    if (!area || rest.length === 0) continue;
    const key = rest.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
    const value: unknown = raw === 'true' ? true : raw === 'false' ? false : raw;
    (out[area] ??= {})[key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
