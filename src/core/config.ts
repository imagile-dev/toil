import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ToilError } from './errors.js';

/**
 * Configuration is a set of named **connections**, each one instance of a
 * service (an area), plus per-area **defaults**.
 *
 * Where a connection's value comes from, highest first (CLAUDE.md,
 * Configuration Precedence):
 *   1. TOIL_CONN_<NAME>_<KEY>, for that connection
 *   2. TOIL_<AREA>_<KEY>, for the area's default connection
 *   3. a well-known CI variable the area declares, for its default connection
 *   4. the connection in ~/.toil/config.json (or --config)
 *   5. `defaults.<area>` in that file, shared by every connection to the area
 *   6. the area's provider defaults (applied when the connection is resolved)
 *
 * There is deliberately no repository-level file. A config file inside a repo
 * could be written by anyone who can push to it, or by an agent editing the
 * working tree, and use it to switch on writes or send the user's credentials
 * to a host of its choosing. A memo left in a shared folder is not an
 * authorisation, however official its letterhead.
 */
export type Settings = Record<string, unknown>;
export type Source = 'env' | 'ci' | 'global' | 'defaults';

/** A connection as stored: its area, `writes`, and the area's own keys. */
export type ConnectionSettings = Settings & { area: string };

export interface ResolvedConfig {
  connections: Record<string, ConnectionSettings>;
  /** Per area: `connection` names the default connection; any other key is a shared default. */
  defaults: Record<string, Settings>;
  /** Where each `<connection>.<key>` came from, for `config check` and debugging. */
  sources: Record<string, Source>;
  files: { global: string };
  /** Things worth telling the user that aren't errors, surfaced in meta.warnings. */
  warnings: Array<{ code: string; message: string }>;
  /** Bounds the user relaxed in the config file (docs/bounds.md). Absent means every bound holds. */
  bounds?: Bounds;
}

/**
 * The bounds a config file may relax. Only the file workspace can be, and
 * only from the user's own config file: never from env, a dossier or a
 * repository (docs/bounds.md).
 */
export interface Bounds {
  files: 'workspace' | 'unbounded';
}

/** What config loading needs to know about each registered area. */
export interface AreaInfo {
  name: string;
  /** Key to the CI variables that stand in for it, in order. */
  fallbacks?: Record<string, string[] | undefined>;
}

/** The config file format this toil writes. It reads every version up to this one. */
export const CONFIG_VERSION = 2;

/** Top-level keys that are never areas, in any version. */
const RESERVED_KEYS = new Set(['version', '$schema', 'connections', 'defaults', 'bounds']);

/** Connection names map one-to-one onto env names: lowercase, digits, single hyphens. */
export const CONNECTION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function emptyConfig(globalPath = ''): ResolvedConfig {
  return { connections: {}, defaults: {}, sources: {}, files: { global: globalPath }, warnings: [] };
}

export interface LoadConfigOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  configPath?: string | undefined;
  /** Registered areas, so TOIL_JIRA_CLOUD_TOKEN maps to jira-cloud, not jira. */
  areas?: readonly AreaInfo[];
}

export function loadConfig(options: LoadConfigOptions): ResolvedConfig {
  const globalPath = options.configPath ? resolve(options.cwd, options.configPath) : join(options.home, '.toil', 'config.json');
  const config = emptyConfig(globalPath);
  const file = readConfigFile(globalPath, config.warnings);
  config.defaults = file.defaults;
  if (file.bounds) {
    config.bounds = file.bounds;
    if (file.bounds.files === 'unbounded') {
      config.warnings.push({
        code: 'BOUND_RELAXED',
        message: `The file workspace bound is off ("bounds": { "files": "unbounded" } in ${globalPath.replace(/\\/g, '/')}): commands may read and write files anywhere you can, except toil's own files.`,
      });
    }
  }
  for (const [name, conn] of Object.entries(file.connections)) {
    config.connections[name] = { ...conn };
    for (const key of Object.keys(conn)) if (key !== 'area') config.sources[`${name}.${key}`] = 'global';
  }
  // Order matters: connections defined only by env exist before an area's
  // default is chosen, so TOIL_CONN_CI_AREA=jira plus TOIL_JIRA_TOKEN is one
  // connection, not a stray second one named after the area.
  createEnvConnections(config, options.env);
  applyAreaEnv(config, options.env, options.areas ?? []);
  applyConnectionEnv(config, options.env);
  if (options.areas?.length) warnUnknownAreas(config, options.areas);
  return config;
}

/** A misspelt area would otherwise surface later as "no such connection", hiding the typo. */
function warnUnknownAreas(config: ResolvedConfig, areas: readonly AreaInfo[]): void {
  const known = new Set(areas.map((a) => a.name));
  for (const [name, conn] of Object.entries(config.connections)) {
    if (known.has(conn.area)) continue;
    config.warnings.push({
      code: 'CONFIG_UNKNOWN_AREA',
      message: `Connection ${name} is for area "${conn.area}", which this toil doesn't have. Known areas: ${[...known].sort().join(', ')}.`,
    });
  }
}

/** The default connection's name for an area, or undefined when it has none or several and no default. */
export function defaultConnectionName(config: ResolvedConfig, area: string): string | undefined {
  const named = config.defaults[area]?.connection;
  if (typeof named === 'string') return named;
  const candidates = connectionsOf(config, area);
  if (candidates.includes(area)) return area;
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Every connection name for an area. */
export function connectionsOf(config: ResolvedConfig, area: string): string[] {
  return Object.keys(config.connections).filter((name) => config.connections[name]!.area === area);
}

/** Whether the user has configured anything at all for an area. */
export function hasConfig(config: ResolvedConfig, area: string): boolean {
  return connectionsOf(config, area).length > 0;
}

/** `writes: true` on a connection, set by a human (or by CI through env). */
export function connectionWrites(settings: Settings | undefined): boolean {
  const value = settings?.writes;
  return value === true || value === 'true';
}

/** Whether any connection to an area has writes on: MCP lists its write tools only then. */
export function anyWrites(config: ResolvedConfig, area: string): boolean {
  return connectionsOf(config, area).some((name) => connectionWrites(config.connections[name]));
}

function readConfigFile(path: string, warnings: ResolvedConfig['warnings']): { connections: Record<string, ConnectionSettings>; defaults: Record<string, Settings>; bounds?: Bounds } {
  if (!existsSync(path)) return { connections: {}, defaults: {} };
  return migrateConfig(readJson(path), path, warnings);
}

function readJson(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ToilError('CONFIG_INVALID', `${path} is not valid JSON: ${(err as Error).message}`, {
      fix: `Fix the JSON in ${path}, or move it aside and set toil up again.`,
    });
  }
  if (!isRecord(parsed)) {
    throw new ToilError('CONFIG_INVALID', `${path} must contain a JSON object.`, {
      fix: `Make ${path} look like { "version": ${CONFIG_VERSION}, "connections": { ... } }.`,
    });
  }
  return parsed;
}

/** A config file as `toil connections` edits it: always version 2, every other key kept as found. */
export type EditableConfig = Record<string, unknown> & {
  version: number;
  connections: Record<string, ConnectionSettings>;
  defaults: Record<string, Settings>;
};

/**
 * Reads the config file for editing, as version 2. A version 2 file comes back
 * exactly as written, unknown keys included, so writing it back drops nothing.
 * A version 1 file becomes the version 2 file it already meant: one connection
 * per area, named after it and set as its default, with every setting carried
 * over. A missing file is an empty one.
 */
export function readConfigForEdit(path: string): EditableConfig {
  if (!existsSync(path)) return { version: CONFIG_VERSION, connections: {}, defaults: {} };
  const raw = readJson(path);
  const { connections, defaults } = migrateConfig(raw, path, []);
  if ((raw.version ?? 1) !== 1) return { ...raw, version: CONFIG_VERSION, connections: { ...connections }, defaults: { ...defaults } };
  // In version 1 these two keys were ignored; upgrading would give them meaning.
  for (const key of ['connections', 'defaults']) {
    if (key in raw) {
      throw new ToilError('CONFIG_INVALID', `${path} is a version 1 file with a "${key}" key, which version 1 ignores, so toil won't upgrade it automatically.`, {
        fix: `Remove "${key}" from ${path}, or add "version": ${CONFIG_VERSION} and check it reads as you intend.`,
      });
    }
  }
  return { ...('$schema' in raw ? { $schema: raw.$schema } : {}), ...('bounds' in raw ? { bounds: raw.bounds } : {}), version: CONFIG_VERSION, connections, defaults };
}

/**
 * Writes the config file, readable by the user only where the platform has
 * POSIX modes (0600, in a 0700 folder). On Windows the file inherits the
 * ACL of the user's profile folder, which already keeps other users out. The
 * new file is written alongside and renamed into place, so a crash halfway
 * leaves the old file, not half of a new one. The content is checked with the
 * same reader that will load it, so toil never writes a file it would refuse.
 */
export function writeConfigFile(path: string, config: EditableConfig): void {
  migrateConfig(config, path, []);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

/**
 * Turns a config file of any version this toil understands into connections
 * and defaults. Each format change adds a step here, with a test, so a file
 * written years ago still loads. A file from a newer toil is refused with an
 * upgrade hint rather than half-read.
 *
 * Version 1 is a map of area to settings. It reads as one connection per area,
 * named after the area and set as that area's default, which is exactly what
 * it always meant. Superseded forms remain valid in perpetuity; nobody is asked
 * to resubmit.
 */
export function migrateConfig(
  raw: Record<string, unknown>,
  path: string,
  warnings: ResolvedConfig['warnings'],
): { connections: Record<string, ConnectionSettings>; defaults: Record<string, Settings>; bounds?: Bounds } {
  // Absent means version 1; present-but-null is a mistake, not a default.
  const version = 'version' in raw ? raw.version : 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ToilError('CONFIG_INVALID', `"version" in ${path} must be a whole number, found ${JSON.stringify(raw.version)}.`, {
      fix: `Remove "version" from ${path}, or set it to ${CONFIG_VERSION}.`,
    });
  }
  if (version > CONFIG_VERSION) {
    throw new ToilError('CONFIG_INVALID', `${path} was written by a newer toil (config version ${version}); this toil reads up to version ${CONFIG_VERSION}.`, {
      fix: 'Upgrade toil: npm install -g @imagile-dev/toil@latest.',
    });
  }
  const read = version === 1 ? fromVersion1(raw, path, warnings) : fromVersion2(raw, path, warnings);
  const bounds = readBounds(raw.bounds, path);
  return bounds ? { ...read, bounds } : read;
}

const RELAXABLE: Record<keyof Bounds, readonly string[]> = { files: ['workspace', 'unbounded'] };

/**
 * `"bounds"` in the config file. An unknown key is refused rather than
 * ignored: a bound that can't be relaxed (toil's own files, credentials to
 * their host) has no setting, and a typo shouldn't read as having worked.
 */
function readBounds(raw: unknown, path: string): Bounds | undefined {
  if (raw === undefined) return undefined;
  const fix = `Set "bounds": { "files": "unbounded" } to let commands reach files outside the workspace, or remove "bounds" from ${path}. No other bound can be relaxed (docs/bounds.md).`;
  if (!isRecord(raw)) throw new ToilError('CONFIG_INVALID', `"bounds" in ${path} must be an object.`, { fix });
  const bounds: Bounds = { files: 'workspace' };
  for (const [key, value] of Object.entries(raw)) {
    const allowed = RELAXABLE[key as keyof Bounds];
    if (!allowed) throw new ToilError('CONFIG_INVALID', `"bounds.${key}" in ${path} isn't a bound that can be relaxed.`, { fix });
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new ToilError('CONFIG_INVALID', `"bounds.${key}" in ${path} must be one of ${allowed.map((a) => `"${a}"`).join(', ')}, found ${JSON.stringify(value)}.`, { fix });
    }
    bounds[key as keyof Bounds] = value as Bounds['files'];
  }
  return bounds;
}

function fromVersion1(raw: Record<string, unknown>, path: string, warnings: ResolvedConfig['warnings']) {
  const connections: Record<string, ConnectionSettings> = {};
  const defaults: Record<string, Settings> = {};
  for (const [key, settings] of Object.entries(raw)) {
    if (RESERVED_KEYS.has(key)) {
      if (key === 'connections' || key === 'defaults') {
        warnings.push({ code: 'CONFIG_RESERVED_KEY', message: `"${key}" in ${path} needs "version": ${CONFIG_VERSION} and was ignored.` });
      }
      continue;
    }
    if (!isRecord(settings)) {
      throw new ToilError('CONFIG_INVALID', `"${key}" in ${path} must be an object of settings.`, {
        fix: `Change "${key}" in ${path} to an object, for example { "baseUrl": "..." }.`,
      });
    }
    connections[key] = { ...settings, area: key };
    defaults[key] = { connection: key };
  }
  return { connections, defaults };
}

function fromVersion2(raw: Record<string, unknown>, path: string, warnings: ResolvedConfig['warnings']) {
  const connections: Record<string, ConnectionSettings> = {};
  const defaults: Record<string, Settings> = {};
  for (const key of Object.keys(raw)) {
    if (!RESERVED_KEYS.has(key)) {
      warnings.push({ code: 'CONFIG_UNKNOWN_KEY', message: `"${key}" in ${path} was ignored: in version ${CONFIG_VERSION}, settings belong to a connection under "connections".` });
    }
  }
  const rawConnections = raw.connections ?? {};
  if (!isRecord(rawConnections)) {
    throw new ToilError('CONFIG_INVALID', `"connections" in ${path} must be an object of named connections.`, {
      fix: `Make it look like "connections": { "corp-jira": { "area": "jira", "baseUrl": "https://jira.imagile.dev" } }.`,
    });
  }
  for (const [name, settings] of Object.entries(rawConnections)) {
    if (!CONNECTION_NAME.test(name)) {
      throw new ToilError('CONFIG_INVALID', `Connection name "${name}" in ${path} isn't valid.`, {
        fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. "corp-jira".',
      });
    }
    if (!isRecord(settings) || typeof settings.area !== 'string') {
      throw new ToilError('CONFIG_INVALID', `Connection "${name}" in ${path} must be an object with an "area".`, {
        fix: `Give "${name}" an area, e.g. { "area": "jira", "baseUrl": "https://jira.imagile.dev" }.`,
      });
    }
    connections[name] = settings as ConnectionSettings;
  }
  const rawDefaults = raw.defaults ?? {};
  if (!isRecord(rawDefaults) || !Object.values(rawDefaults).every(isRecord)) {
    throw new ToilError('CONFIG_INVALID', `"defaults" in ${path} must map each area to an object.`, {
      fix: `Make it look like "defaults": { "jira": { "connection": "corp-jira" } }.`,
    });
  }
  for (const [area, settings] of Object.entries(rawDefaults as Record<string, Settings>)) {
    const named = settings.connection;
    if (named !== undefined && (typeof named !== 'string' || connections[named]?.area !== area)) {
      throw new ToilError('CONFIG_INVALID', `"defaults.${area}.connection" in ${path} names ${JSON.stringify(named)}, which isn't a ${area} connection.`, {
        fix: `Set it to one of: ${Object.keys(connections).filter((n) => connections[n]!.area === area).join(', ') || `(no ${area} connections yet)`}.`,
      });
    }
    defaults[area] = settings;
  }
  return { connections, defaults };
}

/**
 * Environment variable names toil reserves for itself. They never map onto an
 * area, whatever areas exist now or later.
 */
const RESERVED_ENV = [/^TOIL_CONN_/, /^TOIL_DOSSIER/, /^TOIL_ENV$/, /^TOIL_CONFIG/, /^TOIL_TIMEOUT_MS$/, /^TOIL_WORKSPACE$/];

/** camelCase key to SNAKE: baseUrl -> BASE_URL, baseURL -> BASE_URL, apiKey2 -> API_KEY2. */
function snake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** SNAKE to camelCase: BASE_URL -> baseUrl. */
function camel(snakeKey: string): string {
  return snakeKey
    .toLowerCase()
    .split('_')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

const envForm = (name: string) => name.toUpperCase().replace(/-/g, '_');

/** The variable for a key on an area's default connection: jira-cloud + baseUrl -> TOIL_JIRA_CLOUD_BASE_URL. */
export function envName(area: string, key: string): string {
  return `TOIL_${envForm(area)}_${snake(key)}`;
}

/** The variable for a key on a named connection: corp-jira + token -> TOIL_CONN_CORP_JIRA_TOKEN. */
export function connectionEnvName(connection: string, key: string): string {
  return `TOIL_CONN_${envForm(connection)}_${snake(key)}`;
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
    .map((area) => ({ area, prefix: `${envForm(area)}_` }))
    .filter((p) => rest.startsWith(p.prefix) && rest.length > p.prefix.length)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!match) return undefined;
  return { area: match.area, key: camel(rest.slice(match.prefix.length)) };
}

/**
 * Every TOIL_<AREA>_<KEY> variable for a known area, as settings per area.
 * Values stay strings: the area's schema types them when the connection is
 * resolved, so a token that happens to be "true" stays a token.
 */
export function fromEnv(env: NodeJS.ProcessEnv, knownAreas: readonly string[] = []): Record<string, Settings> {
  const out: Record<string, Settings> = {};
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined) continue;
    const parsed = parseEnvName(name, knownAreas);
    if (parsed) (out[parsed.area] ??= {})[parsed.key] = raw;
  }
  return out;
}

/**
 * CI fallbacks, then TOIL_<AREA>_* variables, onto each area's default
 * connection. An area with no connection gets one named after it, so CI can
 * configure an area with env vars alone, as it always could.
 */
function applyAreaEnv(config: ResolvedConfig, env: NodeJS.ProcessEnv, areas: readonly AreaInfo[]): void {
  const fromToil = fromEnv(env, areas.map((a) => a.name));
  for (const area of areas) {
    const layer: Array<[string, unknown, Source]> = [];
    for (const [key, names] of Object.entries(area.fallbacks ?? {})) {
      const found = (names ?? []).find((n) => env[n] !== undefined && env[n] !== '');
      if (found) layer.push([key, env[found], 'ci']);
    }
    for (const [key, value] of Object.entries(fromToil[area.name] ?? {})) layer.push([key, value, 'env']);
    if (layer.length === 0) continue;

    let name = defaultConnectionName(config, area.name);
    if (!name) {
      if (connectionsOf(config, area.name).length > 0) {
        config.warnings.push({
          code: 'CONFIG_AMBIGUOUS_DEFAULT',
          message: `TOIL_${envForm(area.name)}_* variables were ignored: ${area.name} has several connections and no default. Set defaults.${area.name}.connection, or use TOIL_CONN_<NAME>_* variables.`,
        });
        continue;
      }
      name = area.name;
      config.connections[name] = { area: area.name };
      (config.defaults[area.name] ??= {}).connection = name;
    }
    const target = config.connections[name]!;
    for (const [key, value, source] of layer) {
      target[key] = value;
      config.sources[`${name}.${key}`] = source;
    }
  }
}

const connectionVars = (env: NodeJS.ProcessEnv) =>
  Object.entries(env).filter(([name, value]) => name.startsWith('TOIL_CONN_') && value !== undefined) as Array<[string, string]>;

/** TOIL_CONN_<NAME>_AREA creates a connection with no config file at all, which is how CI defines one. */
function createEnvConnections(config: ResolvedConfig, env: NodeJS.ProcessEnv): void {
  for (const [name, value] of connectionVars(env)) {
    if (!name.endsWith('_AREA')) continue;
    const connection = name.slice('TOIL_CONN_'.length, -'_AREA'.length).toLowerCase().replace(/_/g, '-');
    if (!CONNECTION_NAME.test(connection)) {
      config.warnings.push({ code: 'CONFIG_UNKNOWN_KEY', message: `${name} doesn't name a valid connection and was ignored.` });
      continue;
    }
    const existing = config.connections[connection];
    if (existing && existing.area !== value) {
      throw new ToilError('CONFIG_INVALID', `${name}=${value} conflicts with connection "${connection}", which is a ${existing.area} connection.`, {
        fix: `Remove ${name}, or rename one of the two connections.`,
      });
    }
    config.connections[connection] = existing ?? { area: value };
  }
}

/**
 * TOIL_CONN_<NAME>_<KEY> variables, the highest layer. Names are matched
 * longest first against known connections, and a variable for a connection
 * that doesn't exist is a warning, never a guess.
 */
function applyConnectionEnv(config: ResolvedConfig, env: NodeJS.ProcessEnv): void {
  const names = Object.keys(config.connections).sort((a, b) => b.length - a.length);
  for (const [name, value] of connectionVars(env)) {
    if (name.endsWith('_AREA')) continue;
    const rest = name.slice('TOIL_CONN_'.length);
    const connection = names.find((n) => rest.startsWith(`${envForm(n)}_`) && rest.length > envForm(n).length + 1);
    if (!connection) {
      config.warnings.push({
        code: 'CONFIG_UNKNOWN_CONNECTION',
        message: `${name} was ignored: no connection matches it. To define one from env vars, also set TOIL_CONN_<NAME>_AREA.`,
      });
      continue;
    }
    const key = camel(rest.slice(envForm(connection).length + 1));
    if (key === 'area') continue;
    config.connections[connection]![key] = value;
    config.sources[`${connection}.${key}`] = 'env';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
