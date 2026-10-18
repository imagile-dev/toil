import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned JFrog Artifactory responses for every request the artifactory
 * examples send, so the parity suite runs every command offline through both
 * front doors. Routes match on method, path and query.
 *
 * Provenance: the command contract records no responses for this area, so
 * every shape here is invented from JFrog's REST API and AQL documentation,
 * trimmed, and checked against the response types it records. The npm,
 * NuGet and Maven lookups are invented from the npm registry, NuGet v3 and
 * Artifactory latestVersion documentation. Nearly every package here is outdated,
 * which makes it the most realistic inventory in the repository.
 */

export const ARTIFACTORY = 'https://artifactory.imagile.dev';
export const REPO = 'libs-release-local';
export const JAR = 'dev/imagile/api/1.4.0/api-1.4.0.jar';

export const config = { artifactory: { baseUrl: ARTIFACTORY, token: 'test-token', npmRepo: 'npm-remote', nugetRepo: 'nuget-remote', mavenRepo: 'maven-remote', writes: true } };

// Invented from the docs: GET api/repositories.
export const repositories = [
  { key: 'libs-release-local', type: 'LOCAL', description: 'Release builds', url: `${ARTIFACTORY}/libs-release-local`, packageType: 'Maven' },
  { key: 'npm-remote', type: 'REMOTE', url: `${ARTIFACTORY}/npm-remote`, packageType: 'Npm' },
];

// Invented from the docs: GET api/storage/{repo}/{file}.
export const fileInfo = {
  repo: REPO,
  path: `/${JAR}`,
  created: '2026-09-01T10:00:00.000Z',
  createdBy: 'ci-bot',
  lastModified: '2026-09-01T10:00:00.000Z',
  modifiedBy: 'ci-bot',
  lastUpdated: '2026-09-01T10:00:00.000Z',
  downloadUri: `${ARTIFACTORY}/${REPO}/${JAR}`,
  mimeType: 'application/java-archive',
  size: '1024',
  checksums: { sha1: 'abc12345', sha256: 'abc12345abc12345', md5: 'abc12345' },
  originalChecksums: { sha1: 'abc12345', sha256: 'abc12345abc12345', md5: 'abc12345' },
  uri: `${ARTIFACTORY}/api/storage/${REPO}/${JAR}`,
};

// Invented from the docs: GET api/storage/{repo}/{folder}.
export const folderInfo = {
  repo: REPO,
  path: '/dev/imagile/api',
  created: '2026-08-01T10:00:00.000Z',
  createdBy: 'ci-bot',
  lastModified: '2026-09-01T10:00:00.000Z',
  modifiedBy: 'ci-bot',
  lastUpdated: '2026-09-01T10:00:00.000Z',
  children: [{ uri: '/1.4.0', folder: true }],
  uri: `${ARTIFACTORY}/api/storage/${REPO}/dev/imagile/api`,
};

// Invented from the docs: GET api/storage/{repo}/{path}?properties.
export const properties = { properties: { 'qa.status': ['passed'], 'build.ticket': ['ABC-123'] }, uri: `${ARTIFACTORY}/api/storage/${REPO}/${JAR}` };

// Invented from the docs: POST api/search/aql.
export const aqlResult = {
  results: [{ repo: REPO, path: 'dev/imagile/api/1.4.0', name: 'api-1.4.0.jar', type: 'file', size: 1024, created: '2026-09-01T10:00:00.000Z', modified: '2026-09-01T10:00:00.000Z', sha256: 'abc12345abc12345' }],
  range: { start_pos: 0, end_pos: 1, total: 1, limit: 100 },
};

// Invented from the docs: GET api/build.
export const buildList = {
  builds: [
    { uri: '/imagile-api', lastStarted: '2026-09-01T10:00:00.000+0000' },
    { uri: '/imagile-web', lastStarted: '2026-09-02T10:00:00.000+0000' },
  ],
  uri: `${ARTIFACTORY}/api/build`,
};

// Invented from the docs: GET api/build/{name}.
export const buildRuns = (name: string) => ({ buildsNumbers: [{ uri: '/142', started: '2026-09-01T10:00:00.000+0000' }], uri: `${ARTIFACTORY}/api/build/${encodeURIComponent(name)}` });

// Invented from the docs: GET api/build/{name}/{number}.
export const buildInfo = {
  buildInfo: {
    version: '1.0.1',
    name: 'imagile-api',
    number: '142',
    started: '2026-09-01T10:00:00.000+0000',
    buildAgent: { name: 'Generic', version: '2.0' },
    principal: 'ci-bot',
    vcsRevision: 'abc12345',
    vcsUrl: 'https://bitbucket.imagile.dev/scm/imagile/api.git',
    modules: [{ id: 'dev.imagile:api:1.4.0', artifacts: [{ type: 'jar', sha1: 'abc12345', md5: 'abc12345', name: 'api-1.4.0.jar' }] }],
    properties: { 'buildInfo.env.BRANCH': 'main' },
  },
};

/** An inventory as toil deps scan writes it: the whole envelope. */
export const inventory = {
  ok: true,
  data: {
    ecosystems: ['npm', 'nuget', 'maven'],
    manifests: [],
    packages: [
      { name: 'express', version: '4.18.2', ecosystem: 'npm', source: 'package.json', type: 'direct', scope: 'production' },
      { name: '@types/node', version: '20.1.0', ecosystem: 'npm', source: 'package.json', type: 'direct', scope: 'production' },
      { name: 'vitest', version: '1.0.0', ecosystem: 'npm', source: 'package.json', type: 'direct', scope: 'dev' },
      { name: 'qs', version: '6.5.3', ecosystem: 'npm', source: 'package-lock.json', type: 'transitive', scope: 'production' },
      { name: 'Newtonsoft.Json', version: '13.0.1', ecosystem: 'nuget', source: 'src/Api/Api.csproj', type: 'direct', scope: 'production' },
      { name: 'xunit', version: '2.4.0', ecosystem: 'nuget', source: 'src/Api/Api.csproj', type: 'direct', scope: 'dev' },
      { name: 'org.slf4j:slf4j-api', version: '1.7.36', ecosystem: 'maven', source: 'pom.xml', type: 'direct', scope: 'production' },
    ],
    summary: { totalPackages: 7, byEcosystem: {}, byType: {}, byScope: {} },
  },
  error: null,
  meta: {},
};

// Invented from the npm registry docs: a packument, trimmed.
export const packument = (latest: string, license: unknown) => ({ name: 'pkg', 'dist-tags': { latest }, license });

const get = (path: string, json: unknown, query: Record<string, string> = {}): Route => ({ method: 'GET', path, query, respond: { json } });

export const routes: Route[] = [
  { method: 'GET', path: '/api/system/ping', query: {}, respond: { text: 'OK' } },
  get('/api/repositories', repositories),
  get('/api/repositories', [repositories[0]], { type: 'local', packageType: 'npm' }),
  get(`/api/storage/${REPO}/${JAR}`, fileInfo),
  get(`/api/storage/${REPO}/dev/imagile/api`, folderInfo),
  get(`/api/storage/${REPO}/${JAR}`, properties, { properties: '' }),
  { method: 'PUT', path: `/api/storage/${REPO}/${JAR}`, respond: { status: 204 } },
  { method: 'PUT', path: `/api/storage/${REPO}/dev/imagile/api`, respond: { status: 204 } },
  { method: 'POST', path: '/api/search/aql', query: {}, respond: { json: aqlResult } },
  get('/api/build', buildList),
  get('/api/build/imagile-api', buildRuns('imagile-api')),
  get('/api/build/imagile%20api%2Fmain', buildRuns('imagile api/main')),
  get('/api/build/imagile-api/142', buildInfo),
  get('/api/npm/npm-remote/express', packument('5.1.0', 'MIT')),
  get('/api/npm/npm-remote/@types%2Fnode', packument('20.4.1', { type: 'MIT' })),
  get('/api/npm/npm-remote/vitest', packument('3.2.0', 'MIT')),
  // Invented from the NuGet v3 docs: the flat container's version list, and a registration leaf.
  get('/api/nuget/v3/nuget-remote/flatcontainer/newtonsoft.json/index.json', { versions: ['13.0.1', '13.0.3', '13.0.4-beta1'] }),
  get('/api/nuget/v3/nuget-remote/flatcontainer/xunit/index.json', { versions: ['2.4.0', '2.9.0'] }),
  get('/api/nuget/v3/nuget-remote/registration/newtonsoft.json/13.0.1.json', { '@id': 'leaf', catalogEntry: 'https://artifactory.imagile.dev/catalog/newtonsoft.json.13.0.1.json', licenseExpression: 'MIT' }),
  get('/api/nuget/v3/nuget-remote/registration/xunit/2.4.0.json', { '@id': 'leaf', licenseUrl: 'https://licenses.imagile.dev/xunit' }),
  // Invented from the docs: GET api/search/latestVersion answers with plain text.
  { method: 'GET', path: '/api/search/latestVersion', query: { g: 'org.slf4j', a: 'slf4j-api', repos: 'maven-remote' }, respond: { text: '2.0.13\n' } },
];

export const fixture = defineFixture({
  area: 'artifactory',
  routes,
  config,
  files: { 'inventory.json': JSON.stringify(inventory) },
});
