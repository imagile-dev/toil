import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned OSV.dev answers for every request the osv examples send, and the
 * inventory they read. querybatch is matched on its body: an empty batch is
 * the reachability check, anything else gets one result per query, in order.
 * Each id's full record comes from GET /v1/vulns/<id>.
 *
 * Provenance: invented from OSV's documented API
 * (https://google.github.io/osv.dev/post-v1-querybatch/ and
 * https://google.github.io/osv.dev/get-v1-vulns/), trimmed. A batch answers
 * with `{ id, modified }` per vulnerability and nothing more, as the live API
 * did on 2026-10-17. The
 * command contract had no tests for this source. Every vulnerability
 * here is filed by id alone, which is also how most of them get triaged.
 */

export const OSV = 'https://api.osv.dev';

/** What `toil deps scan --include-transitive --include-dev` writes: its whole envelope. */
export const inventory = {
  ok: true,
  data: {
    ecosystems: ['npm', 'nuget', 'maven'],
    manifests: [{ file: 'package.json', ecosystem: 'npm', lockFile: 'package-lock.json' }],
    packages: [
      { name: 'lodash', version: '4.17.20', ecosystem: 'npm', source: 'package-lock.json', type: 'direct', scope: 'production' },
      { name: 'minimist', version: '1.2.5', ecosystem: 'npm', source: 'package-lock.json', type: 'transitive', scope: 'production' },
      { name: '@types/node', version: '18.0.0', ecosystem: 'npm', source: 'package-lock.json', type: 'direct', scope: 'dev' },
      { name: 'Newtonsoft.Json', version: '12.0.1', ecosystem: 'nuget', source: 'src/Api/Api.csproj', type: 'direct', scope: 'production' },
      { name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1', ecosystem: 'maven', source: 'pom.xml', type: 'direct', scope: 'production' },
    ],
    summary: { totalPackages: 5, byEcosystem: { npm: 3, nuget: 1, maven: 1 }, byType: { direct: 4, transitive: 1 }, byScope: { production: 4, dev: 1 } },
  },
  meta: { command: 'deps scan' },
};

/** Ids only, as querybatch returns them, keyed by package name. */
export const knownVulns: Record<string, Array<{ id: string; modified: string }>> = {
  lodash: [
    { id: 'GHSA-35jh-r3h4-6jhm', modified: '2026-09-01T00:00:00Z' },
    { id: 'GHSA-29mw-wpgm-hmr9', modified: '2026-09-01T00:00:00Z' },
  ],
  minimist: [{ id: 'GHSA-xvch-5gv4-984h', modified: '2026-09-01T00:00:00Z' }],
  'org.apache.logging.log4j:log4j-core': [{ id: 'GHSA-jfh8-c2jp-5v3q', modified: '2026-09-01T00:00:00Z' }],
};

const record = (id: string, pkg: string, ecosystem: string, fixed: string, severity: string, cve: string) => ({
  id,
  summary: `Vulnerability in ${pkg}`,
  aliases: [cve],
  modified: '2026-09-01T00:00:00Z',
  references: [{ type: 'ADVISORY', url: `https://github.com/advisories/${id}` }],
  affected: [{ package: { name: pkg, ecosystem }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed }] }] }],
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
  database_specific: { severity },
});

/** Full records by id, as GET /v1/vulns/<id> returns them. */
export const records: Record<string, ReturnType<typeof record>> = {
  'GHSA-35jh-r3h4-6jhm': record('GHSA-35jh-r3h4-6jhm', 'lodash', 'npm', '4.17.21', 'HIGH', 'CVE-2021-23337'),
  'GHSA-29mw-wpgm-hmr9': record('GHSA-29mw-wpgm-hmr9', 'lodash', 'npm', '4.17.21', 'MODERATE', 'CVE-2020-28500'),
  'GHSA-xvch-5gv4-984h': record('GHSA-xvch-5gv4-984h', 'minimist', 'npm', '1.2.6', 'CRITICAL', 'CVE-2021-44906'),
  'GHSA-jfh8-c2jp-5v3q': record('GHSA-jfh8-c2jp-5v3q', 'org.apache.logging.log4j:log4j-core', 'Maven', '2.15.0', 'CRITICAL', 'CVE-2021-44228'),
};

/** A GET /v1/vulns/<id> answer: the record, or OSV's 404. */
export function vulnRecord(request: RecordedRequest) {
  const id = decodeURIComponent(new URL(request.url).pathname.slice('/v1/vulns/'.length));
  return records[id] ? { json: records[id] } : { status: 404, json: { code: 5, message: 'Bug not found.' } };
}

/** One querybatch answer for the request's queries: an empty batch is `{ results: [] }`. */
export function querybatch(request: RecordedRequest, vulns = knownVulns) {
  const { queries } = JSON.parse(request.body ?? '{}') as { queries: Array<{ package: { name: string } }> };
  return { json: { results: queries.map((q) => (vulns[q.package.name] ? { vulns: vulns[q.package.name] } : {})) } };
}

export const routes: Route[] = [
  { method: 'POST', url: `${OSV}/v1/querybatch`, respond: (request) => querybatch(request) },
  { method: 'GET', path: /^\/v1\/vulns\//, origin: OSV, respond: (request) => vulnRecord(request) },
];

export const files: Record<string, string> = { 'inventory.json': JSON.stringify(inventory) };

export const fixture = defineFixture({ area: 'osv', routes, config: {}, files });
