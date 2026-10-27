import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConnectionName, loadConfig, type AreaInfo } from './config.js';

/**
 * Config version 3 for Azure DevOps (#495, slice 4): `ado-cloud` became `ado` with
 * `"deployment": "cloud"` on the connection, as `jira-cloud` became `jira`. The
 * fold itself is core's and is proved on Jira; this is what is particular to ado:
 * the files and env vars people really have, and the Azure Pipelines job token,
 * which fits Server and would overwrite a Services credential.
 */

let root: string;
let home: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-config-ado-'));
  home = join(root, 'home');
  repo = join(root, 'work', 'repo');
  mkdirSync(join(home, '.toil'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => join(home, '.toil', 'config.json');
const writeJson = (value: unknown) => writeFileSync(file(), JSON.stringify(value));
const areas: AreaInfo[] = [{ name: 'ado', fallbacks: { pat: ['SYSTEM_ACCESSTOKEN'] }, fallbackWhen: (c) => c.deployment !== 'cloud' }, { name: 'jira' }];
const load = (env: NodeJS.ProcessEnv = {}) => loadConfig({ env, cwd: repo, home, areas });

const services = { area: 'ado-cloud', baseUrl: 'https://dev.azure.com/imagile', pat: 'keychain:imagile-ado.pat' };
const server = { area: 'ado', baseUrl: 'https://ado.imagile.dev', pat: 'keychain:corp-ado.pat' };

describe('version 3: ado-cloud became ado with deployment cloud', () => {
  it('reads a version 2 file with an ado-cloud connection as an ado connection with deployment cloud, keychain reference untouched', () => {
    writeJson({ version: 2, connections: { 'imagile-ado': services }, defaults: { 'ado-cloud': { connection: 'imagile-ado', project: 'Imagile', team: 'Imagile Team' } } });
    const config = load();
    expect(config.connections['imagile-ado']).toEqual({ ...services, area: 'ado', deployment: 'cloud' });
    expect(config.defaults).toEqual({ ado: { connection: 'imagile-ado', project: 'Imagile', team: 'Imagile Team' } });
    expect(defaultConnectionName(config, 'ado')).toBe('imagile-ado');
    expect(config.warnings).toEqual([]);
  });

  it("keeps ado's default when both named one, and doesn't let defaults.ado.collection or project reach the Services connection", () => {
    writeJson({
      version: 2,
      connections: { 'corp-ado': server, 'imagile-ado': services },
      defaults: { ado: { connection: 'corp-ado', collection: 'DefaultCollection', project: 'Legacy' }, 'ado-cloud': { connection: 'imagile-ado', project: 'Imagile' } },
    });
    const config = load();
    expect(defaultConnectionName(config, 'ado')).toBe('corp-ado');
    expect(config.warnings).toEqual([expect.objectContaining({ code: 'CONFIG_DEFAULT_KEPT', message: expect.stringContaining('"imagile-ado"') })]);
    expect(config.connections['corp-ado']).toMatchObject({ collection: 'DefaultCollection', project: 'Legacy' });
    expect(config.connections['imagile-ado']).toMatchObject({ deployment: 'cloud', project: 'Imagile' });
    expect(config.connections['imagile-ado']).not.toHaveProperty('collection');
    expect(config.defaults.ado).toEqual({ connection: 'corp-ado' });
  });
});

describe('the retired Services env names', () => {
  it('refuses TOIL_ADO_CLOUD_* naming TOIL_ADO_* with TOIL_ADO_DEPLOYMENT=cloud, rather than ignoring a credential', () => {
    expect(() => load({ TOIL_ADO_CLOUD_PAT: 'x', TOIL_ADO_CLOUD_BASE_URL: 'https://dev.azure.com/imagile' })).toThrow(
      expect.objectContaining({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_ADO_DEPLOYMENT=cloud') }),
    );
  });

  it('refuses TOIL_CONN_<NAME>_AREA=ado-cloud, and defines a Services connection from env alone with TOIL_CONN_<NAME>_DEPLOYMENT=cloud', () => {
    expect(() => load({ TOIL_CONN_SVC_AREA: 'ado-cloud' })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
    const config = load({ TOIL_CONN_SVC_AREA: 'ado', TOIL_CONN_SVC_DEPLOYMENT: 'cloud', TOIL_CONN_SVC_BASE_URL: 'https://dev.azure.com/imagile' });
    expect(config.connections.svc).toMatchObject({ area: 'ado', deployment: 'cloud', baseUrl: 'https://dev.azure.com/imagile' });
  });

  it('skips an empty TOIL_ADO_CLOUD_PAT unless TOIL_STRICT_ENV=true', () => {
    expect(() => load({ TOIL_ADO_CLOUD_PAT: '' })).not.toThrow();
    expect(() => load({ TOIL_ADO_CLOUD_PAT: '', TOIL_STRICT_ENV: 'true' })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  });
});

describe('TOIL_ADO_* reaching a connection that is Services', () => {
  it('refuses them when the ado default is Services and TOIL_ADO_DEPLOYMENT is unset, and lets them through when it is set', () => {
    writeJson({ version: 3, connections: { 'imagile-ado': { area: 'ado', deployment: 'cloud', baseUrl: 'https://dev.azure.com/imagile' } }, defaults: { ado: { connection: 'imagile-ado' } } });
    expect(() => load({ TOIL_ADO_PAT: 'old-server-token' })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('TOIL_ADO_PAT') }));
    expect(() => load({ TOIL_ADO_PAT: 'new-token', TOIL_ADO_DEPLOYMENT: 'cloud' })).not.toThrow();
  });
});

describe('SYSTEM_ACCESSTOKEN, the Azure Pipelines job token', () => {
  it('is lent to a Server default, as it always was', () => {
    const config = load({ SYSTEM_ACCESSTOKEN: 'job-token', TOIL_ADO_BASE_URL: 'https://ado.imagile.dev' });
    expect(config.connections.ado).toMatchObject({ pat: 'job-token' });
    expect(config.sources['ado.pat']).toBe('ci');
  });

  it("is not lent to a Services default from the file, which would replace the organization-scoped token it names", () => {
    writeJson({ version: 3, connections: { 'imagile-ado': { ...services, area: 'ado', deployment: 'cloud' } }, defaults: { ado: { connection: 'imagile-ado' } } });
    const config = load({ SYSTEM_ACCESSTOKEN: 'job-token' });
    expect(config.connections['imagile-ado']).toMatchObject({ pat: 'keychain:imagile-ado.pat' });
    expect(config.sources['imagile-ado.pat']).not.toBe('ci');
  });

  it('is not lent when TOIL_ADO_DEPLOYMENT=cloud, or the connection is made by TOIL_CONN_<NAME>_* as Services, and TOIL_ADO_PAT still sets the token', () => {
    const viaDefault = load({ SYSTEM_ACCESSTOKEN: 'job-token', TOIL_ADO_DEPLOYMENT: 'cloud', TOIL_ADO_BASE_URL: 'https://dev.azure.com/imagile' });
    expect(viaDefault.connections.ado).not.toHaveProperty('pat');
    const set = load({ SYSTEM_ACCESSTOKEN: 'job-token', TOIL_ADO_DEPLOYMENT: 'cloud', TOIL_ADO_PAT: 'mapped' });
    expect(set.connections.ado).toMatchObject({ pat: 'mapped', deployment: 'cloud' });
    const named = load({ SYSTEM_ACCESSTOKEN: 'job-token', TOIL_CONN_ADO_AREA: 'ado', TOIL_CONN_ADO_DEPLOYMENT: 'cloud' });
    expect(named.connections.ado).not.toHaveProperty('pat', 'job-token');
  });
});
