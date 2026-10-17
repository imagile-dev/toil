import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_VERSION, envName, fromEnv, loadConfig, parseEnvName, setting, writesEnabled } from './config.js';
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

const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const knownAreas = ['jira', 'jira-cloud', 'db', 'sonar'];

describe('loadConfig precedence', () => {
  it('env beats the global file', () => {
    writeJson(join(home, '.toil', 'config.json'), { jira: { baseUrl: 'https://jira.imagile.dev', token: 'g', project: 'G' } });
    const config = loadConfig({ env: { TOIL_JIRA_PROJECT: 'E' }, cwd: repo, home, knownAreas });

    expect(setting(config, 'jira', 'token')).toBe('g');
    expect(setting(config, 'jira', 'project')).toBe('E');
    expect(config.sources).toMatchObject({ 'jira.token': 'global', 'jira.baseUrl': 'global', 'jira.project': 'env' });
  });

  it('ignores a .toil.json in the repository: it cannot enable writes or redirect credentials', () => {
    writeJson(join(home, '.toil', 'config.json'), { jira: { baseUrl: 'https://jira.imagile.dev', token: 'secret' } });
    writeJson(join(repo, '.toil.json'), { jira: { baseUrl: 'https://other.example.com', writes: true } });
    const config = loadConfig({ env: {}, cwd: join(repo, 'packages', 'app'), home });

    expect(setting(config, 'jira', 'baseUrl')).toBe('https://jira.imagile.dev');
    expect(writesEnabled(config, 'jira')).toBe(false);
  });

  it('reads --config instead of the default global file', () => {
    const custom = join(root, 'custom.json');
    writeJson(custom, { db: { default: 'reporting' } });
    expect(setting(loadConfig({ env: {}, cwd: repo, home, configPath: custom }), 'db', 'default')).toBe('reporting');
  });

  it('works with no config anywhere', () => {
    expect(loadConfig({ env: {}, cwd: repo, home }).areas).toEqual({});
  });

  it('rejects invalid JSON and wrongly shaped files with a fix, never a TypeError', () => {
    writeFileSync(join(home, '.toil', 'config.json'), '{ not json');
    expect(() => loadConfig({ env: {}, cwd: repo, home })).toThrow(ToilError);

    writeJson(join(home, '.toil', 'config.json'), { jira: 'https://jira.imagile.dev' });
    try {
      loadConfig({ env: {}, cwd: repo, home });
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('"jira"') });
    }
  });
});

describe('fromEnv', () => {
  it('maps hyphenated areas by the longest known name', () => {
    expect(fromEnv({ TOIL_JIRA_CLOUD_TOKEN: 't', TOIL_JIRA_BASE_URL: 'https://jira.imagile.dev' }, ['jira', 'jira-cloud'])).toEqual({
      'jira-cloud': { token: 't' },
      jira: { baseUrl: 'https://jira.imagile.dev' },
    });
  });

  it('maps TOIL_<AREA>_<KEY> onto camelCase keys and parses booleans', () => {
    expect(fromEnv({ TOIL_JIRA_BASE_URL: 'https://jira.imagile.dev', TOIL_DB_WRITES: 'true', TOIL_X: 'ignored', OTHER: 'x' }, knownAreas)).toEqual({
      jira: { baseUrl: 'https://jira.imagile.dev' },
      db: { writes: true },
    });
  });

  it('ignores names for areas toil does not know, and names toil reserves, instead of guessing', () => {
    expect(
      fromEnv(
        { TOIL_GITLAB_TOKEN: 'g', TOIL_CONN_JIRA_PROD_TOKEN: 'c', TOIL_DOSSIER: 'payments', TOIL_ENV: 'prod', TOIL_CONFIG: '/x', TOIL_TIMEOUT_MS: '5', TOIL_JIRA_: 'x' },
        knownAreas,
      ),
    ).toEqual({});
  });

  it('round-trips every (area, key) through envName and parseEnvName', () => {
    for (const [area, key] of [['jira', 'baseUrl'], ['jira-cloud', 'apiToken'], ['db', 'writes'], ['sonar', 'token']] as const) {
      expect(parseEnvName(envName(area, key), knownAreas)).toEqual({ area, key });
    }
    expect(envName('jira-cloud', 'baseUrl')).toBe('TOIL_JIRA_CLOUD_BASE_URL');
  });
});

describe('config file versions', () => {
  const file = () => join(home, '.toil', 'config.json');
  const load = () => loadConfig({ env: {}, cwd: repo, home, knownAreas });

  it('reads a file with no version as version 1', () => {
    writeJson(file(), { jira: { project: 'P' } });
    expect(setting(load(), 'jira', 'project')).toBe('P');
  });

  it('reads the current version and does not treat "version" or "$schema" as areas', () => {
    writeJson(file(), { version: CONFIG_VERSION, $schema: 'https://imagile-dev.github.io/toil/config.schema.json', jira: { project: 'P' } });
    expect(Object.keys(load().areas)).toEqual(['jira']);
  });

  it('refuses a file from a newer toil with an upgrade fix, rather than half-reading it', () => {
    writeJson(file(), { version: CONFIG_VERSION + 1, jira: { project: 'P' } });
    expect(load).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('npm install -g @imagile-dev/toil@latest') }));
  });

  it('refuses a version that is not a whole number', () => {
    for (const version of ['1', 1.5, 0, null]) {
      writeJson(file(), { version, jira: {} });
      expect(load).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    }
  });

  it('warns about keys reserved for a later version and ignores them', () => {
    writeJson(file(), { connections: { 'jira-prod': {} }, defaults: {}, jira: { project: 'P' } });
    const config = load();
    expect(Object.keys(config.areas)).toEqual(['jira']);
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_RESERVED_KEY', 'CONFIG_RESERVED_KEY']);
  });
});

describe('writesEnabled', () => {
  it('is on only with an explicit true', () => {
    const config = loadConfig({ env: { TOIL_DB_WRITES: 'true', TOIL_JIRA_WRITES: 'yes' }, cwd: repo, home, knownAreas });
    expect(writesEnabled(config, 'db')).toBe(true);
    expect(writesEnabled(config, 'jira')).toBe(false);
    expect(writesEnabled(config, 'sonar')).toBe(false);
  });
});
