import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { OSV_URL, osvArea } from './area.js';
import { friskData, inventoryFields, inventoryOptions, readInventory, selectPackages, TIME_LIMIT_MS, type InventoryPackage, type Vulnerability, type VulnerablePackage } from './inventory.js';
import { postJson, probe, statusOf, type PublicContext } from './public-api.js';

/**
 * `toil osv vulns`: an inventory's packages against OSV.dev's batch query,
 * 500 queries a request, one request after another, results matched back to
 * packages by position. Ported as the old `deps frisk --source osv` had it,
 * bugs included (suspected bugs #91 items 5 and 6): querybatch answers with
 * vulnerability ids only and the full records are never fetched, so every
 * finding has an empty summary, UNKNOWN severity and "No fix available". The
 * report is accurate about which packages are affected and silent on what to
 * do about it, a format long favoured by quarterly risk reviews.
 */

const BATCH_SIZE = 500;
const SERVICE = 'OSV.dev';
const QUERYBATCH = `${OSV_URL}/v1/querybatch`;

const OSV_ECOSYSTEM: Record<string, string> = { npm: 'npm', nuget: 'NuGet', maven: 'Maven' };

interface OsvRange {
  type: string;
  events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }>;
}

interface OsvRawVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  references?: Array<{ url?: string }>;
  affected?: Array<{ package?: { name: string; ecosystem: string }; ranges?: OsvRange[] }>;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: Record<string, unknown>;
}

interface OsvBatchResponse {
  results: Array<{ vulns?: OsvRawVuln[] }>;
}

/** Fixed versions from every affected entry's SEMVER and ECOSYSTEM ranges, whichever package they're for (#91 item 6). */
function remediation(vuln: OsvRawVuln, pkg: InventoryPackage): Vulnerability['remediation'] {
  const fixed: string[] = [];
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      for (const event of range.events ?? []) if (event.fixed) fixed.push(event.fixed);
    }
  }
  const fixedVersions = [...new Set(fixed)];
  const fixAvailable = fixedVersions.length > 0;
  const advice = fixAvailable ? `Upgrade ${pkg.name} to ${fixedVersions.join(' or ')}` : `No fix available yet for ${pkg.name}. Monitor ${vuln.id} for updates.`;
  return { fixAvailable, fixedVersions, advice };
}

function severityFromCvss(cvss: number | null): string {
  if (cvss === null) return 'UNKNOWN';
  if (cvss >= 9.0) return 'CRITICAL';
  if (cvss >= 7.0) return 'HIGH';
  if (cvss >= 4.0) return 'MEDIUM';
  return 'LOW';
}

/**
 * `database_specific.severity` as given (GHSA's MODERATE included), else from
 * a numeric CVSS. OSV's `severity[].score` is a vector string, which
 * parseFloat never reads, so only `database_specific.cvss` ever supplies one
 * (#91 item 6).
 */
function severity(vuln: OsvRawVuln): { severity: string; cvss: number | null } {
  const db = vuln.database_specific ?? {};
  const dbSeverity = typeof db.severity === 'string' ? db.severity : undefined;
  let cvss: number | null = null;
  const raw = db.cvss;
  if (typeof raw === 'number') cvss = raw;
  else if (raw && typeof raw === 'object' && 'score' in raw && typeof (raw as Record<string, unknown>).score === 'number') cvss = (raw as { score: number }).score;
  for (const s of vuln.severity ?? []) {
    const score = parseFloat(s.score);
    if (!isNaN(score) && score >= 0 && score <= 10) {
      cvss = score;
      break;
    }
  }
  return { severity: dbSeverity ?? severityFromCvss(cvss), cvss };
}

function mapVuln(vuln: OsvRawVuln, pkg: InventoryPackage): Vulnerability {
  return {
    id: vuln.id,
    summary: vuln.summary ?? '',
    ...severity(vuln),
    aliases: vuln.aliases ?? [],
    remediation: remediation(vuln, pkg),
    references: (vuln.references ?? []).map((r) => r.url ?? '').filter(Boolean),
  };
}

/** One querybatch call. `next_page_token` is never read, so a query past OSV's page of results is cut short (#91 item 5). */
async function queryBatch(ctx: PublicContext, chunk: InventoryPackage[]): Promise<VulnerablePackage[]> {
  const queries = chunk.map((pkg) => ({ package: { name: pkg.name, ecosystem: OSV_ECOSYSTEM[pkg.ecosystem] ?? pkg.ecosystem }, version: pkg.version }));
  let data: OsvBatchResponse;
  try {
    data = (await postJson<OsvBatchResponse>(ctx, { service: SERVICE, url: QUERYBATCH, body: { queries } })).data;
  } catch (err) {
    const status = statusOf(err);
    if (!(err instanceof ToilError) || status === undefined) throw err;
    // The old wording, with core's code and fix.
    throw new ToilError(err.code, `OSV.dev returned HTTP ${status}`, { fix: err.fix ?? `Try again later; check ${OSV_URL} is up.`, details: { ...(err.details as object), message: err.message } });
  }
  const results = data?.results;
  // The old code read data.results.length and failed on an answer without one; it still fails, in words.
  if (!Array.isArray(results)) {
    throw new ToilError('HTTP', `OSV.dev answered ${QUERYBATCH} without a results list.`, { fix: `Try again later; check ${OSV_URL} is up.`, details: { url: QUERYBATCH } });
  }
  const vulnerable: VulnerablePackage[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const pkg = chunk[i];
    if (!result || !pkg) continue;
    const vulns = result.vulns ?? [];
    if (vulns.length === 0) continue;
    vulnerable.push({ ...pkg, vulnerabilities: vulns.map((v) => mapVuln(v, pkg)) });
  }
  return vulnerable;
}

export const vulnsCommand = osvArea.command({
  path: ['osv', 'vulns'],
  // No connection: a public API the command names. It works with no config at all.
  kind: 'area-local',
  description: 'Check a dependency inventory for known vulnerabilities in OSV.dev (public API, no credential)',
  toolDescription:
    'Known vulnerabilities from the public OSV.dev API for the packages in an inventory from toil deps scan. Returns { tier, source, sourcesQueried, sourceErrors, scanned, vulnerable, packages[] }, each package with vulnerabilities[] of { id, summary, severity, cvss, aliases, remediation, references }. OSV batch results carry ids only, so summary, severity and fix data are usually empty. For Sonatype OSS Index use ossindex_vulns.',
  input: z.object(inventoryFields),
  writes: false,
  // A batch query whose body can hold 500 packages: a read, sent as POST.
  queryByPost: true,
  timeLimitMs: TIME_LIMIT_MS,
  options: inventoryOptions,
  examples: [{ from: 'inventory.json' }, { from: 'inventory.json', ecosystem: 'npm', directOnly: true, includeDev: true }],
  run: async (input, ctx) => {
    const packages = selectPackages(readInventory(ctx, input.from, 'osv vulns'), input);
    const up = await probe(ctx, { service: SERVICE, url: QUERYBATCH, body: { queries: [] } });
    if (!up.reachable) {
      throw new ToilError('NETWORK', 'toil osv vulns requires OSV.dev access but api.osv.dev is not reachable from this machine.', {
        fix: `Check this machine can reach ${OSV_URL} (VPN, proxy, DNS); toil uses HTTPS_PROXY, HTTP_PROXY and NO_PROXY when they're set. Run with --verbose to see the request.`,
        details: { status: 503, url: QUERYBATCH, cause: up.reason },
      });
    }
    if (packages.length === 0) return friskData('osv', 0, []);
    const vulnerable: VulnerablePackage[] = [];
    for (let i = 0; i < packages.length; i += BATCH_SIZE) vulnerable.push(...(await queryBatch(ctx, packages.slice(i, i + BATCH_SIZE))));
    return friskData('osv', packages.length, vulnerable);
  },
});
