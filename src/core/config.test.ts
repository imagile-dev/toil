import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  anyWrites,
  CONFIG_VERSION,
  connectionEnvName,
  defaultConnectionName,
  envName,
  fromEnv,
  loadConfig,
  parseEnvName,
  type AreaInfo,
} from './config.js';
import { ToilError } from './errors.js';

let root: string;
let home: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-config-'));
  home = join(root, 'home');
  repo = join(root, 'work', 'repo');
  mkdirSync(join(home, '.toil'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'packages', 'app'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => join(home, '.toil', 'config.json');
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const areas: AreaInfo[] = [{ name: 'jira' }, { name: 'jira-cloud' }, { name: 'db' }, { name: 'github', fallbacks: { token: ['GITHUB_TOKEN'] } }];
const knownAreas = areas.map((a) => a.name);
const load = (env: NodeJS.ProcessEnv = {}) => loadConfig({ env, cwd: repo, home, areas });

const v2 = {
  version: 2,
  connections: {
    'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev', token: 'file-token' },
    'jira-sandbox': { area: 'jira', baseUrl: 'https://jira-sandbox.imagile.dev', writes: true },
  },
  defaults: { jira: { connection: 'corp-jira', pageSize: 50 } },
};

describe('version 1 files', () => {
  it('read as one connection per area, named after it and set as its default', () => {
    writeJson(file(), { jira: { baseUrl: 'https://jira.imagile.dev', project: 'P' } });
    const config = load();
    expect(config.connections.jira).toEqual({ area: 'jira', baseUrl: 'https://jira.imagile.dev', project: 'P' });
    expect(defaultConnectionName(config, 'jira')).toBe('jira');
    expect(config.sources['jira.project']).toBe('global');
  });

  it('warn about connections and defaults, which need version 2', () => {
    writeJson(file(), { connections: { x: {} }, defaults: {}, jira: { project: 'P' } });
    const config = load();
    expect(Object.keys(config.connections)).toEqual(['jira']);
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_RESERVED_KEY', 'CONFIG_RESERVED_KEY']);
  });
});

describe('version 2 files', () => {
  it('read named connections and the default each area uses', () => {
    writeJson(file(), v2);
    const config = load();
    expect(Object.keys(config.connections).sort()).toEqual(['corp-jira', 'jira-sandbox']);
    expect(defaultConnectionName(config, 'jira')).toBe('corp-jira');
    expect(anyWrites(config, 'jira')).toBe(true);
  });

  it('pick the only connection for an area when no default is named', () => {
    writeJson(file(), { version: 2, connections: { 'corp-db': { area: 'db' } } });
    expect(defaultConnectionName(load(), 'db')).toBe('corp-db');
  });

  it('have no default when an area has several connections and none is named', () => {
    writeJson(file(), { version: 2, connections: { a: { area: 'db' }, b: { area: 'db' } } });
    expect(defaultConnectionName(load(), 'db')).toBeUndefined();
  });

  it('refuse a bad connection name, a connection without an area, and a default naming another area', () => {
    for (const bad of [
      { version: 2, connections: { Corp_Jira: { area: 'jira' } } },
      { version: 2, connections: { 'corp-jira': { baseUrl: 'x' } } },
      { version: 2, connections: { 'corp-db': { area: 'db' } }, defaults: { jira: { connection: 'corp-db' } } },
    ]) {
      writeJson(file(), bad);
      expect(() => load()).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.any(String) }));
    }
  });

  it('warn about top-level area keys, which belong under connections now', () => {
    writeJson(file(), { version: 2, jira: { baseUrl: 'x' } });
    expect(load().warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_KEY']);
  });
});

describe('precedence', () => {
  it('TOIL_CONN_<NAME>_* beats TOIL_<AREA>_*, which beats the CI fallback, which beats the file', () => {
    writeJson(file(), { version: 2, connections: { gh: { area: 'github', token: 'file' } } });
    expect(load({ GITHUB_TOKEN: 'ci' }).connections.gh!.token).toBe('ci');
    expect(load({ GITHUB_TOKEN: 'ci', TOIL_GITHUB_TOKEN: 'area' }).connections.gh!.token).toBe('area');
    const config = load({ GITHUB_TOKEN: 'ci', TOIL_GITHUB_TOKEN: 'area', TOIL_CONN_GH_TOKEN: 'conn' });
    expect(config.connections.gh!.token).toBe('conn');
    expect(config.sources['gh.token']).toBe('env');
    expect(load({ GITHUB_TOKEN: 'ci' }).sources['gh.token']).toBe('ci');
  });

  it('TOIL_<AREA>_* sets the default connection only', () => {
    writeJson(file(), v2);
    const config = load({ TOIL_JIRA_TOKEN: 'env' });
    expect(config.connections['corp-jira']!.token).toBe('env');
    expect(config.connections['jira-sandbox']!.token).toBeUndefined();
  });

  it('TOIL_<AREA>_* creates a connection named after the area when there is none, as CI always could', () => {
    const config = load({ TOIL_JIRA_BASE_URL: 'https://jira.imagile.dev', TOIL_JIRA_WRITES: 'true' });
    expect(config.connections.jira).toEqual({ area: 'jira', baseUrl: 'https://jira.imagile.dev', writes: 'true' });
    expect(defaultConnectionName(config, 'jira')).toBe('jira');
    expect(anyWrites(config, 'jira')).toBe(true);
  });

  it('TOIL_<AREA>_* is ignored with a warning when the area has several connections and no default', () => {
    writeJson(file(), { version: 2, connections: { a: { area: 'db' }, b: { area: 'db' } } });
    const config = load({ TOIL_DB_HOST: 'h' });
    expect(config.connections.a!.host).toBeUndefined();
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_AMBIGUOUS_DEFAULT']);
  });

  it('ignores a .toil.json in the repository: it cannot enable writes or redirect credentials', () => {
    writeJson(file(), { jira: { baseUrl: 'https://jira.imagile.dev', token: 'secret' } });
    writeJson(join(repo, '.toil.json'), { jira: { baseUrl: 'https://other.example.com', writes: true } });
    const config = loadConfig({ env: {}, cwd: join(repo, 'packages', 'app'), home, areas });
    expect(config.connections.jira!.baseUrl).toBe('https://jira.imagile.dev');
    expect(anyWrites(config, 'jira')).toBe(false);
  });

  it('reads --config instead of the default global file', () => {
    const custom = join(root, 'custom.json');
    writeJson(custom, { db: { default: 'reporting' } });
    expect(loadConfig({ env: {}, cwd: repo, home, configPath: custom, areas }).connections.db!.default).toBe('reporting');
  });

  it('works with no config anywhere', () => {
    expect(load().connections).toEqual({});
  });
});

describe('connections from env vars alone', () => {
  it('TOIL_CONN_<NAME>_AREA creates a connection, and its other variables fill it in', () => {
    const config = load({ TOIL_CONN_OCP_PROD_AREA: 'jira', TOIL_CONN_OCP_PROD_BASE_URL: 'https://api.ocp.imagile.dev', TOIL_CONN_OCP_PROD_WRITES: 'false' });
    expect(config.connections['ocp-prod']).toEqual({ area: 'jira', baseUrl: 'https://api.ocp.imagile.dev', writes: 'false' });
    expect(anyWrites(config, 'jira')).toBe(false);
  });

  it('makes TOIL_<AREA>_* fill the env-only connection, not a second one', () => {
    const config = load({ TOIL_CONN_CI_AREA: 'jira', TOIL_JIRA_TOKEN: 'x' });
    expect(Object.keys(config.connections)).toEqual(['ci']);
    expect(config.connections.ci!.token).toBe('x');
  });

  it('keeps env values as strings, so a token that reads "true" stays a token', () => {
    expect(load({ TOIL_JIRA_TOKEN: 'true' }).connections.jira!.token).toBe('true');
  });

  it('warns about a connection for an area toil does not have', () => {
    const config = load({ TOIL_CONN_CI_AREA: 'jria', TOIL_CONN_CI_TOKEN: 'x' });
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_AREA']);
    expect(config.warnings[0]!.message).toContain('jria');
  });

  it('matches the longest connection name, so corp and corp-jira never collide', () => {
    writeJson(file(), { version: 2, connections: { corp: { area: 'db' }, 'corp-jira': { area: 'jira' } } });
    const config = load({ TOIL_CONN_CORP_JIRA_TOKEN: 't', TOIL_CONN_CORP_HOST: 'h' });
    expect(config.connections['corp-jira']!.token).toBe('t');
    expect(config.connections.corp!.host).toBe('h');
    expect(config.connections.corp!.jiraToken).toBeUndefined();
  });

  it('warns, and never guesses, for a variable naming no connection', () => {
    const config = load({ TOIL_CONN_NOPE_TOKEN: 't' });
    expect(config.connections).toEqual({});
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_UNKNOWN_CONNECTION']);
  });

  it('refuses an _AREA that contradicts the file', () => {
    writeJson(file(), v2);
    expect(() => load({ TOIL_CONN_CORP_JIRA_AREA: 'db' })).toThrow(ToilError);
  });
});

describe('config file versions', () => {
  it('refuses a file from a newer toil with an upgrade fix, rather than half-reading it', () => {
    writeJson(file(), { version: CONFIG_VERSION + 1, jira: { project: 'P' } });
    expect(() => load()).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('npm install -g @imagile-dev/toil@latest') }));
  });

  it('refuses a version that is not a whole number', () => {
    for (const version of ['1', 1.5, 0, null]) {
      writeJson(file(), { version, jira: {} });
      expect(() => load()).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    }
  });

  it('rejects invalid JSON and wrongly shaped files with a fix, never a TypeError', () => {
    writeFileSync(file(), '{ not json');
    expect(() => load()).toThrow(ToilError);
    writeJson(file(), { jira: 'https://jira.imagile.dev' });
    expect(() => load()).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('"jira"') }));
  });
});

describe('env names', () => {
  it('map hyphenated areas by the longest known name', () => {
    expect(fromEnv({ TOIL_JIRA_CLOUD_TOKEN: 't', TOIL_JIRA_BASE_URL: 'https://jira.imagile.dev' }, knownAreas)).toEqual({
      'jira-cloud': { token: 't' },
      jira: { baseUrl: 'https://jira.imagile.dev' },
    });
  });

  it('ignore names for areas toil does not know, and names toil reserves, instead of guessing', () => {
    expect(
      fromEnv({ TOIL_GITLAB_TOKEN: 'g', TOIL_CONN_JIRA_PROD_TOKEN: 'c', TOIL_DOSSIER: 'payments', TOIL_ENV: 'prod', TOIL_CONFIG: '/x', TOIL_TIMEOUT_MS: '5', TOIL_JIRA_: 'x' }, knownAreas),
    ).toEqual({});
  });

  it('round-trip every (area, key), and name connection variables the same way', () => {
    for (const [area, key] of [['jira', 'baseUrl'], ['jira-cloud', 'apiToken'], ['db', 'writes']] as const) {
      expect(parseEnvName(envName(area, key), knownAreas)).toEqual({ area, key });
    }
    expect(envName('jira-cloud', 'baseUrl')).toBe('TOIL_JIRA_CLOUD_BASE_URL');
    expect(connectionEnvName('corp-jira', 'baseUrl')).toBe('TOIL_CONN_CORP_JIRA_BASE_URL');
  });
});
