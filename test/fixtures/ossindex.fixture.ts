import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';
import { files, inventory } from './osv.fixture.js';

/**
 * Canned Sonatype OSS Index answers for every request the ossindex examples
 * send. component-report is matched on its body: an empty list of
 * coordinates is the reachability check, anything else gets one report per
 * coordinate, in order. The inventory is osv's: one inventory, every source.
 *
 * Provenance: shaped like the command contract's own types for this
 * source and OSS Index's documented API
 * (https://ossindex.sonatype.org/rest), trimmed. Not captured from the live
 * service, which since asks for an account; this one is fictional and
 * passed every access review.
 */

export const OSSINDEX = 'https://ossindex.sonatype.org';
export { files, inventory };

export const vulnerability = (n: number, cve: string, cvssScore: number) => ({
  id: `abc12345-0000-0000-0000-00000000000${n}`,
  displayName: cve,
  title: `[${cve}] Improper input validation`,
  description: `A crafted input can cause harm. See ${cve}.`,
  cvssScore,
  cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  cwe: 'CWE-20',
  reference: `${OSSINDEX}/vulnerability/${cve}`,
  externalReferences: [`https://nvd.nist.gov/vuln/detail/${cve}`],
});

/** Vulnerabilities by package URL. */
export const knownReports: Record<string, ReturnType<typeof vulnerability>[]> = {
  'pkg:npm/lodash@4.17.20': [vulnerability(1, 'CVE-2021-23337', 7.2)],
  'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1': [vulnerability(2, 'CVE-2021-44228', 10)],
};

/** One component-report answer: a report per coordinate, in order. */
export function componentReport(request: RecordedRequest, reports = knownReports) {
  const { coordinates } = JSON.parse(request.body ?? '{}') as { coordinates: string[] };
  return { json: coordinates.map((c) => ({ coordinates: c, description: '', reference: `${OSSINDEX}/component/${c}`, vulnerabilities: reports[c] ?? [] })) };
}

export const routes: Route[] = [{ method: 'POST', url: `${OSSINDEX}/api/v3/component-report`, respond: (request) => componentReport(request) }];

/** A free account's username and API token, as TOIL_OSSINDEX_USERNAME and TOIL_OSSINDEX_TOKEN would set them. */
export const config = { ossindex: { username: 'you@example.com', token: 'test-token' } };
export const BASIC = `Basic ${Buffer.from('you@example.com:test-token').toString('base64')}`;

export const fixture = defineFixture({ area: 'ossindex', routes, config, files });
