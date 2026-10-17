import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { friskData, inventoryFields, inventoryOptions, readInventory, selectPackages, TIME_LIMIT_MS, type InventoryPackage, type Vulnerability, type VulnerablePackage } from '../osv/inventory.js';
import { postJson, probe, statusOf, type PublicContext } from '../osv/public-api.js';
import { OSSINDEX_URL, ossindexArea } from './area.js';

/**
 * `toil ossindex vulns`: an inventory's packages as package URLs against OSS
 * Index's component report, 128 a request (its stated limit), one request
 * after another, reports matched back by their `coordinates` string. Ported
 * as the old `deps frisk --source sonatype` had it, bugs included (suspected
 * bugs #91 items 7 and 26): no credential is sent, a
 * 401 reads as "not reachable", and a report whose coordinates come back
 * normalised matches no package and is dropped. The component is reported
 * missing from the report, which is the report's fault, per the report.
 */

const BATCH_SIZE = 128;
const SERVICE = 'Sonatype OSS Index';
const COMPONENT_REPORT = `${OSSINDEX_URL}/api/v3/component-report`;
const HEADERS = { Accept: 'application/json' };

interface OssIndexVuln {
  id: string;
  displayName: string;
  title: string;
  description: string;
  cvssScore: number;
  cvssVector?: string;
  cwe?: string;
  reference: string;
  externalReferences?: string[];
}

interface ComponentReport {
  coordinates: string;
  description?: string;
  reference: string;
  vulnerabilities: OssIndexVuln[];
}

/** A package URL: a scope's `@` encoded for npm, Maven's `group:artifact` as `group/artifact`. */
export function toPurl(pkg: InventoryPackage): string {
  switch (pkg.ecosystem) {
    case 'npm':
      return `pkg:npm/${pkg.name.startsWith('@') ? pkg.name.replace('@', '%40') : pkg.name}@${pkg.version}`;
    case 'nuget':
      return `pkg:nuget/${pkg.name}@${pkg.version}`;
    case 'maven': {
      const colon = pkg.name.indexOf(':');
      if (colon !== -1) return `pkg:maven/${encodeURIComponent(pkg.name.slice(0, colon))}/${encodeURIComponent(pkg.name.slice(colon + 1))}@${pkg.version}`;
      return `pkg:maven/${encodeURIComponent(pkg.name)}@${pkg.version}`;
    }
    default:
      return `pkg:generic/${encodeURIComponent(pkg.name)}@${pkg.version}`;
  }
}

function severityFromCvss(score: number): string {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'UNKNOWN';
}

/** OSS Index has no fixed versions, so the advice points at the reference; CVE ids are scraped from the name, title and description. */
function mapVuln(v: OssIndexVuln, pkg: InventoryPackage): Vulnerability {
  const searchText = [v.displayName, v.title, v.description].filter(Boolean).join(' ');
  const aliases = [...new Set([...searchText.matchAll(/CVE-\d{4}-\d+/gi)].map((m) => m[0].toUpperCase()))];
  return {
    id: v.displayName || v.id,
    summary: v.title || v.description,
    severity: severityFromCvss(v.cvssScore),
    cvss: v.cvssScore > 0 ? v.cvssScore : null,
    aliases,
    remediation: { fixAvailable: false, fixedVersions: [], advice: `See ${v.reference} for remediation details for ${pkg.name}@${pkg.version}.` },
    references: [v.reference, ...(v.externalReferences ?? [])].filter(Boolean),
  };
}

async function queryBatch(ctx: PublicContext, chunk: InventoryPackage[]): Promise<VulnerablePackage[]> {
  const purls = chunk.map(toPurl);
  let reports: ComponentReport[];
  try {
    reports = (await postJson<ComponentReport[]>(ctx, { service: SERVICE, url: COMPONENT_REPORT, body: { coordinates: purls }, headers: HEADERS })).data;
  } catch (err) {
    const status = statusOf(err);
    if (!(err instanceof ToilError) || status === undefined) throw err;
    if (status === 429) {
      // The old advice, kept word for word: toil reads no OSS Index credential, so the fix says what actually helps (#91 item 7).
      throw new ToilError(
        'HTTP',
        'Sonatype OSS Index is rate-limiting requests from this IP. Create a free account at ossindex.sonatype.org and add your credentials to your toil config to raise the limit.',
        { fix: "Wait a while and try again with fewer packages. toil doesn't send OSS Index credentials yet, so an account won't raise its limit.", details: err.details },
      );
    }
    throw new ToilError(err.code, `Sonatype OSS Index returned HTTP ${status}`, { fix: err.fix ?? `Try again later; check ${OSSINDEX_URL} is up.`, details: { ...(err.details as object), message: err.message } });
  }
  // The old code iterated the answer and failed on anything but a list; it still fails, in words.
  if (!Array.isArray(reports)) {
    throw new ToilError('HTTP', `Sonatype OSS Index answered ${COMPONENT_REPORT} with something other than a list of reports.`, { fix: `Try again later; check ${OSSINDEX_URL} is up.`, details: { url: COMPONENT_REPORT } });
  }
  const byPurl = new Map(purls.map((purl, i) => [purl, chunk[i]!]));
  const vulnerable: VulnerablePackage[] = [];
  for (const report of reports) {
    if (!report?.coordinates) continue;
    // An exact match only: coordinates OSS Index normalised match nothing and the package is dropped.
    const pkg = byPurl.get(report.coordinates);
    if (!pkg) continue;
    const vulns = report.vulnerabilities ?? [];
    if (vulns.length === 0) continue;
    vulnerable.push({ ...pkg, vulnerabilities: vulns.map((v) => mapVuln(v, pkg)) });
  }
  return vulnerable;
}

export const vulnsCommand = ossindexArea.command({
  path: ['ossindex', 'vulns'],
  // No connection: a public API the command names. It works with no config at all.
  kind: 'area-local',
  description: 'Check a dependency inventory for known vulnerabilities in Sonatype OSS Index (public API, anonymous)',
  toolDescription:
    'Known vulnerabilities from the public Sonatype OSS Index API, asked anonymously, for the packages in an inventory from toil deps scan. Returns { tier, source, sourcesQueried, sourceErrors, scanned, vulnerable, packages[] }, each package with vulnerabilities[] of { id, summary, severity, cvss, aliases, remediation, references }; OSS Index gives no fixed versions. OSS Index now refuses anonymous requests with HTTP 401, which this reports as not reachable; prefer osv_vulns.',
  input: z.object(inventoryFields),
  writes: false,
  // A batch report request whose body can hold 128 package URLs: a read, sent as POST.
  queryByPost: true,
  timeLimitMs: TIME_LIMIT_MS,
  options: inventoryOptions,
  examples: [{ from: 'inventory.json' }, { from: 'inventory.json', ecosystem: 'maven', directOnly: true, includeDev: true }],
  run: async (input, ctx) => {
    const packages = selectPackages(readInventory(ctx, input.from, 'ossindex vulns'), input);
    const up = await probe(ctx, { service: SERVICE, url: COMPONENT_REPORT, body: { coordinates: [] }, headers: HEADERS });
    if (!up.reachable) {
      throw new ToilError('NETWORK', 'toil ossindex vulns requires Sonatype OSS Index access but ossindex.sonatype.org is not reachable from this machine.', {
        fix: `Check this machine can reach ${OSSINDEX_URL} (VPN, proxy, DNS); toil uses HTTPS_PROXY, HTTP_PROXY and NO_PROXY when they're set. If the cause is HTTP 401, OSS Index is refusing anonymous requests, which toil can't change yet.`,
        details: { status: 503, url: COMPONENT_REPORT, cause: up.reason },
      });
    }
    if (packages.length === 0) return friskData('sonatype', 0, []);
    const vulnerable: VulnerablePackage[] = [];
    for (let i = 0; i < packages.length; i += BATCH_SIZE) vulnerable.push(...(await queryBatch(ctx, packages.slice(i, i + BATCH_SIZE))));
    return friskData('sonatype', packages.length, vulnerable);
  },
});
