import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type AreaInfo } from './config.js';

/**
 * Config version 3, the second fold (#495): bitbucket-cloud became bitbucket
 * with "deployment": "cloud". The mechanism is the table in renamed-areas.ts
 * and is held to Jira's cases in config-v3.test.ts; this holds it to
 * Bitbucket's own settings (a workspace, the Pipelines fallbacks).
 */

let root: string;
let home: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toil-config-v3-bb-'));
  home = join(root, 'home');
  repo = join(root, 'work', 'repo');
  mkdirSync(join(home, '.toil'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => join(home, '.toil', 'config.json');
const writeJson = (value: unknown) => writeFileSync(file(), JSON.stringify(value));
const areas: AreaInfo[] = [{ name: 'bitbucket', fallbacks: { workspace: ['BITBUCKET_WORKSPACE'], repo: ['BITBUCKET_REPO_SLUG'] }, fallbackWhen: (effective) => effective.deployment === 'cloud' }, { name: 'jira' }];
const load = (env: NodeJS.ProcessEnv = {}) => loadConfig({ env, cwd: repo, home, areas });

const cloud = { area: 'bitbucket-cloud', baseUrl: 'https://bitbucket-cloud.imagile.dev/2.0', email: 'you@example.com', apiToken: 'keychain:imagile-bbc.apiToken' };
const dataCenter = { area: 'bitbucket', baseUrl: 'https://bitbucket.imagile.dev', pat: 'keychain:corp-bitbucket.pat' };

describe('version 3: bitbucket-cloud became bitbucket with deployment cloud', () => {
  it('reads a version 2 file with a bitbucket-cloud connection as a bitbucket connection with deployment cloud, keychain reference untouched', () => {
    writeJson({ version: 2, connections: { 'imagile-bbc': cloud }, defaults: { 'bitbucket-cloud': { connection: 'imagile-bbc', workspace: 'imagile', repo: 'toil' } } });
    const config = load();
    expect(config.connections['imagile-bbc']).toEqual({ ...cloud, area: 'bitbucket', deployment: 'cloud' });
    expect(config.defaults).toEqual({ bitbucket: { connection: 'imagile-bbc', workspace: 'imagile', repo: 'toil' } });
    expect(config.warnings).toEqual([]);
  });

  it("doesn't let a Cloud workspace reach Data Center connections, or Data Center's project and repo reach the Cloud ones", () => {
    writeJson({
      version: 2,
      connections: { 'corp-bitbucket': dataCenter, 'imagile-bbc': cloud },
      defaults: { bitbucket: { connection: 'corp-bitbucket', project: 'PROJ', repo: 'imagile-api' }, 'bitbucket-cloud': { connection: 'imagile-bbc', workspace: 'imagile' } },
    });
    const config = load();
    expect(config.connections['imagile-bbc']).toMatchObject({ area: 'bitbucket', deployment: 'cloud', workspace: 'imagile' });
    expect(config.connections['corp-bitbucket']).toMatchObject({ project: 'PROJ', repo: 'imagile-api' });
    expect(config.defaults.bitbucket).toEqual({ connection: 'corp-bitbucket' });
    expect(config.warnings).toEqual([expect.objectContaining({ code: 'CONFIG_DEFAULT_KEPT' })]);
  });

  it('refuses TOIL_BITBUCKET_CLOUD_* env vars, naming TOIL_BITBUCKET_* with TOIL_BITBUCKET_DEPLOYMENT=cloud, rather than ignoring a credential', () => {
    expect(() => load({ TOIL_BITBUCKET_CLOUD_ACCESS_TOKEN: 't' })).toThrow(
      expect.objectContaining({
        code: 'CONFIG_INVALID',
        message: expect.stringContaining('TOIL_BITBUCKET_CLOUD_ACCESS_TOKEN'),
        fix: expect.stringContaining('TOIL_BITBUCKET_ACCESS_TOKEN and set TOIL_BITBUCKET_DEPLOYMENT=cloud'),
      }),
    );
    expect(() => load({ TOIL_CONN_CI_AREA: 'bitbucket-cloud' })).toThrow(expect.objectContaining({ fix: expect.stringContaining('TOIL_CONN_CI_AREA=bitbucket, and TOIL_CONN_CI_DEPLOYMENT=cloud') }));
  });

  it('refuses TOIL_BITBUCKET_* on a migrated Cloud default unless TOIL_BITBUCKET_DEPLOYMENT is set, and lets the Pipelines fallbacks through', () => {
    writeJson({ version: 2, connections: { 'imagile-bbc': cloud }, defaults: { 'bitbucket-cloud': { connection: 'imagile-bbc' } } });
    expect(() => load({ TOIL_BITBUCKET_PAT: 'dc-token' })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('TOIL_BITBUCKET_PAT') }));
    expect(() => load({ TOIL_BITBUCKET_PAT: 'dc-token', TOIL_BITBUCKET_DEPLOYMENT: 'cloud' })).not.toThrow();
    const pipeline = load({ BITBUCKET_WORKSPACE: 'imagile', BITBUCKET_REPO_SLUG: 'toil' });
    expect(pipeline.connections['imagile-bbc']).toMatchObject({ workspace: 'imagile', repo: 'toil' });
  });

  it('applies the Pipelines fallbacks to a Cloud default only: a Data Center default keeps the repo its file says', () => {
    const pipeline = { BITBUCKET_WORKSPACE: 'imagile', BITBUCKET_REPO_SLUG: 'toil' };
    writeJson({ version: 3, connections: { 'corp-bitbucket': { ...dataCenter, repo: 'imagile-api' } }, defaults: { bitbucket: { connection: 'corp-bitbucket' } } });
    const server = load(pipeline);
    expect(server.connections['corp-bitbucket']).toMatchObject({ repo: 'imagile-api' });
    expect(server.connections['corp-bitbucket']!.workspace).toBeUndefined();
    // Cloud, said by the file, by TOIL_BITBUCKET_DEPLOYMENT, by the connection's own variable, or by defaults.bitbucket.
    writeJson({ version: 3, connections: { 'imagile-bbc': { ...cloud, area: 'bitbucket', deployment: 'cloud', repo: 'old' } }, defaults: { bitbucket: { connection: 'imagile-bbc' } } });
    expect(load(pipeline).connections['imagile-bbc']).toMatchObject({ workspace: 'imagile', repo: 'toil' });
    writeJson({ version: 3, connections: { 'corp-bitbucket': { ...dataCenter, repo: 'imagile-api' } }, defaults: { bitbucket: { connection: 'corp-bitbucket' } } });
    expect(load({ ...pipeline, TOIL_BITBUCKET_DEPLOYMENT: 'cloud' }).connections['corp-bitbucket']).toMatchObject({ repo: 'toil' });
    expect(load({ ...pipeline, TOIL_CONN_CORP_BITBUCKET_DEPLOYMENT: 'cloud' }).connections['corp-bitbucket']).toMatchObject({ repo: 'toil' });
    writeJson({ version: 3, connections: { 'corp-bitbucket': { ...dataCenter, repo: 'imagile-api' } }, defaults: { bitbucket: { connection: 'corp-bitbucket', deployment: 'cloud' } } });
    expect(load(pipeline).connections['corp-bitbucket']).toMatchObject({ repo: 'toil' });
    // With no connection at all and no deployment said, the default is Data Center, so nothing is taken.
    writeJson({ version: 3, connections: {}, defaults: {} });
    expect(load(pipeline).connections.bitbucket).toBeUndefined();
  });
});
