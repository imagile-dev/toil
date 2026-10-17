import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned OSV.dev answers for every request the osv examples send, and the
 * inventory they read. querybatch is matched on its body: an empty batch is
 * the reachability check, anything else gets one result per query, in order.
 *
 * Provenance: invented from OSV's documented API
 * (https://google.github.io/osv.dev/post-v1-querybatch/), which answers a
 * batch with `{ id, modified }` per vulnerability and nothing more. The
 * canonical implementation had no tests for this source. Every vulnerability
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

/** One querybatch answer for the request's queries: an empty batch is `{ results: [] }`. */
export function querybatch(request: RecordedRequest, vulns = knownVulns) {
  const { queries } = JSON.parse(request.body ?? '{}') as { queries: Array<{ package: { name: string } }> };
  return { json: { results: queries.map((q) => (vulns[q.package.name] ? { vulns: vulns[q.package.name] } : {})) } };
}

export const routes: Route[] = [{ method: 'POST', url: `${OSV}/v1/querybatch`, respond: (request) => querybatch(request) }];

export const files: Record<string, string> = { 'inventory.json': JSON.stringify(inventory) };

export const fixture = defineFixture({ area: 'osv', routes, config: {}, files });
