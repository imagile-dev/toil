import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConnectionName, loadConfig, readConfigForEdit, writeConfigFile, type AreaInfo } from './config.js';

/**
 * Config version 3 (#495): `jira-cloud` became `jira` with `"deployment":
 * "cloud"` on the connection. Every way the old name could still arrive is
 * either folded into the new one or refused with the new form.
 */

let root: string;
let home: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-config-v3-'));
  home = join(root, 'home');
  repo = join(root, 'work', 'repo');
  mkdirSync(join(home, '.toil'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => join(home, '.toil', 'config.json');
const writeJson = (value: unknown) => writeFileSync(file(), JSON.stringify(value));
const areas: AreaInfo[] = [{ name: 'jira' }, { name: 'db' }];
const load = (env: NodeJS.ProcessEnv = {}) => loadConfig({ env, cwd: repo, home, areas });

const cloud = { area: 'jira-cloud', baseUrl: 'https://jira-cloud.imagile.dev', email: 'you@example.com', apiToken: 'keychain:imagile-cloud.apiToken' };

describe('version 3: jira-cloud became jira with deployment cloud', () => {
  it('reads a version 2 file with a jira-cloud connection as a jira connection with deployment cloud, keychain reference untouched', () => {
    writeJson({ version: 2, connections: { 'imagile-cloud': cloud }, defaults: { 'jira-cloud': { connection: 'imagile-cloud', project: 'PROJ' } } });
    const config = load();
    expect(config.connections['imagile-cloud']).toEqual({ ...cloud, area: 'jira', deployment: 'cloud' });
    expect(config.defaults).toEqual({ jira: { connection: 'imagile-cloud', project: 'PROJ' } });
    expect(defaultConnectionName(config, 'jira')).toBe('imagile-cloud');
    expect(config.warnings).toEqual([]);
  });

  it('reads a version 1 file with a jira-cloud key the same way, the connection keeping its name', () => {
    writeJson({ 'jira-cloud': { baseUrl: 'https://jira-cloud.imagile.dev', email: 'you@example.com' } });
    const config = load();
    expect(config.connections['jira-cloud']).toMatchObject({ area: 'jira', deployment: 'cloud' });
    expect(defaultConnectionName(config, 'jira')).toBe('jira-cloud');
  });

  it("keeps jira's default when both named one, and names the one it dropped", () => {
    writeJson({
      version: 2,
      connections: { 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' }, 'imagile-cloud': cloud },
      defaults: { jira: { connection: 'corp-jira' }, 'jira-cloud': { connection: 'imagile-cloud' } },
    });
    const config = load();
    expect(defaultConnectionName(config, 'jira')).toBe('corp-jira');
    expect(config.warnings).toEqual([expect.objectContaining({ code: 'CONFIG_DEFAULT_KEPT', message: expect.stringContaining('"imagile-cloud"') })]);
    expect(config.warnings[0]!.message).toContain('corp-jira');
  });

  it("doesn't let a Cloud default reach Data Center connections: it moves onto the Cloud connections instead", () => {
    writeJson({
      version: 2,
      connections: { 'corp-jira': { area: 'jira', baseUrl: 'https://jira.imagile.dev' }, 'imagile-cloud': cloud },
      defaults: { 'jira-cloud': { connection: 'imagile-cloud', project: 'CLD' } },
    });
    const config = load();
    expect(config.defaults.jira).toEqual({ connection: 'corp-jira' });
    expect(config.connections['imagile-cloud']).toMatchObject({ project: 'CLD' });
    expect(config.connections['corp-jira']).not.toHaveProperty('project');
    // jira had a connection, which was what `toil jira` used and still is; the warning says the Cloud default was set aside.
    expect(defaultConnectionName(config, 'jira')).toBe('corp-jira');
    expect(config.warnings.map((w) => w.code)).toEqual(['CONFIG_DEFAULT_KEPT']);
  });

  it('is what an edit writes back: version 3, folded, other keys kept', () => {
    writeJson({ version: 2, extra: 1, connections: { 'imagile-cloud': cloud }, defaults: { 'jira-cloud': { connection: 'imagile-cloud' } } });
    const edit = readConfigForEdit(file());
    expect(edit).toEqual({ version: 3, extra: 1, connections: { 'imagile-cloud': { ...cloud, area: 'jira', deployment: 'cloud' } }, defaults: { jira: { connection: 'imagile-cloud' } } });
    writeConfigFile(file(), edit);
    expect(load().connections['imagile-cloud']).toMatchObject({ area: 'jira', deployment: 'cloud' });
  });

  it('warns about a version 3 file that still names the old area, with the new form', () => {
    writeJson({ version: 3, connections: { old: { area: 'jira-cloud' } } });
    const warning = load().warnings.find((w) => w.code === 'CONFIG_RENAMED_AREA')!;
    expect(warning.message).toContain('jira-cloud is now jira');
    expect(warning.message).toContain('TOIL_JIRA_DEPLOYMENT=cloud');
  });

  it('refuses TOIL_JIRA_CLOUD_* env vars, naming TOIL_JIRA_* with TOIL_JIRA_DEPLOYMENT=cloud, rather than ignoring a credential', () => {
    expect(() => load({ TOIL_JIRA_CLOUD_API_TOKEN: 't', TOIL_JIRA_CLOUD_EMAIL: 'you@example.com' })).toThrow(
      expect.objectContaining({
        code: 'CONFIG_INVALID',
        message: expect.stringContaining('TOIL_JIRA_CLOUD_API_TOKEN'),
        fix: expect.stringContaining('TOIL_JIRA_API_TOKEN and set TOIL_JIRA_DEPLOYMENT=cloud'),
      }),
    );
    expect(() => load({ TOIL_JIRA_BASE_URL: 'https://jira.imagile.dev' })).not.toThrow();
  });

  it('refuses TOIL_CONN_<NAME>_AREA=jira-cloud, naming the area and the deployment to set', () => {
    expect(() => load({ TOIL_CONN_CI_AREA: 'jira-cloud' })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_CONN_CI_AREA=jira, and TOIL_CONN_CI_DEPLOYMENT=cloud') }));
  });

  it('defines a Cloud connection from env alone with TOIL_CONN_<NAME>_DEPLOYMENT=cloud, and the default one with TOIL_JIRA_DEPLOYMENT=cloud', () => {
    const named = load({ TOIL_CONN_CI_AREA: 'jira', TOIL_CONN_CI_DEPLOYMENT: 'cloud', TOIL_CONN_CI_EMAIL: 'you@example.com' });
    expect(named.connections.ci).toMatchObject({ area: 'jira', deployment: 'cloud', email: 'you@example.com' });
    const byArea = load({ TOIL_JIRA_DEPLOYMENT: 'cloud', TOIL_JIRA_EMAIL: 'you@example.com' });
    expect(byArea.connections.jira).toMatchObject({ area: 'jira', deployment: 'cloud' });
  });
});
