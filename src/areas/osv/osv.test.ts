import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { RecordedRequest, Route } from '../../../test/harness/fake-fetch.js';
import { files, inventory, knownVulns, OSV, querybatch } from '../../../test/fixtures/osv.fixture.js';
import { runCli } from '../../../test/harness/cli.js';
import { execute } from '../../core/run.js';
import { commands } from './index.js';
import { selectPackages } from './inventory.js';
import { vulnsCommand } from './vulns.js';

/**
 * The exact requests `toil osv vulns` sends to OSV.dev and what it makes of
 * the answers. Suspected bugs from #91 (items 5, 6 and 24) are pinned here,
 * not fixed: the old command's observable behaviour is the specification
 * until a live run says otherwise. A finding that says nothing is still a
 * finding, and is filed as one.
 */

const URL_ = `${OSV}/v1/querybatch`;
const HEADERS = { 'content-type': 'application/json' };
const route = (respond: (request: RecordedRequest) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }): Route => ({ method: 'POST', url: URL_, respond });
const fixtureRoute = route((request) => querybatch(request));

async function run(input: Record<string, unknown>, routes: Route[] = [fixtureRoute], extra: { files?: Record<string, string>; stdin?: string } = {}) {
  const t = testContext({ routes, files: extra.files ?? files, ...(extra.stdin !== undefined ? { stdin: extra.stdin } : {}) });
  const envelope = await execute(vulnsCommand, input, t.context);
  return { envelope, calls: t.http.calls };
}

const bodyOf = (call: RecordedRequest) => JSON.parse(call.body ?? 'null') as unknown;

describe('osv vulns: requests', () => {
  it('probes with an empty batch, then sends one querybatch of every package, ecosystems mapped, with no credential and no config', async () => {
    const { envelope, calls } = await run({ from: 'inventory.json' });
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', URL_],
      ['POST', URL_],
    ]);
    expect(calls[0]!.headers).toEqual(HEADERS);
    expect(bodyOf(calls[0]!)).toEqual({ queries: [] });
    expect(calls[1]!.headers).toEqual(HEADERS);
    expect(bodyOf(calls[1]!)).toEqual({
      queries: [
        { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' },
        { package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.5' },
        { package: { name: 'Newtonsoft.Json', ecosystem: 'NuGet' }, version: '12.0.1' },
        { package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' }, version: '2.14.1' },
      ],
    });
  });

  it('is an area-local command: it takes no --connection and reads no config', () => {
    expect(commands.map((c) => c.kind)).toEqual(['area-local']);
    expect(Object.keys(vulnsCommand.input.shape).sort()).toEqual(['directOnly', 'ecosystem', 'from', 'includeDev']);
  });

  it('sends 500 queries a batch, one batch after another', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `pkg-${i}`, version: '1.0.0', ecosystem: 'npm' }));
    const { envelope, calls } = await run({ from: 'many.json' }, [fixtureRoute], { files: { 'many.json': JSON.stringify(many) } });
    expect(envelope.ok).toBe(true);
    expect(calls.map((c) => (bodyOf(c) as { queries: unknown[] }).queries.length)).toEqual([0, 500, 1]);
    expect((envelope.data as { scanned: number }).scanned).toBe(501);
  });

  it('passes an unknown ecosystem through as given', async () => {
    const { calls } = await run({ from: 'odd.json' }, [fixtureRoute], { files: { 'odd.json': JSON.stringify([{ name: 'serde', version: '1.0.0', ecosystem: 'crates.io' }]) } });
    expect(bodyOf(calls[1]!)).toEqual({ queries: [{ package: { name: 'serde', ecosystem: 'crates.io' }, version: '1.0.0' }] });
  });
});

describe('osv vulns: the old deps frisk filters', () => {
  it('scans transitive dependencies by default and leaves dev ones out', async () => {
    const { envelope } = await run({ from: 'inventory.json' });
    expect((envelope.data as { scanned: number }).scanned).toBe(4);
  });

  it('--ecosystem, --direct-only and --include-dev narrow and widen it', () => {
    const all = inventory.data.packages;
    expect(selectPackages(all, { ecosystem: 'npm' }).map((p) => p.name)).toEqual(['lodash', 'minimist']);
    expect(selectPackages(all, { directOnly: true }).map((p) => p.name)).toEqual(['lodash', 'Newtonsoft.Json', 'org.apache.logging.log4j:log4j-core']);
    expect(selectPackages(all, { ecosystem: 'npm', includeDev: true }).map((p) => p.name)).toEqual(['lodash', 'minimist', '@types/node']);
  });

  it('suspected bug #91 item 24: a misspelt ecosystem matches nothing and reports a clean result, after the probe', async () => {
    const { envelope, calls } = await run({ from: 'inventory.json', ecosystem: 'nugget' });
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ tier: 'full', source: 'osv', sourcesQueried: ['osv'], sourceErrors: [], scanned: 0, vulnerable: 0, packages: [] });
    expect(calls).toHaveLength(1);
  });
});

describe('osv vulns: reshaping', () => {
  it('returns the old frisk shape, results matched to packages by position, clean packages left out', async () => {
    const { envelope } = await run({ from: 'inventory.json' });
    const data = envelope.data as { tier: string; source: string; sourcesQueried: string[]; sourceErrors: unknown[]; scanned: number; vulnerable: number; packages: Array<Record<string, unknown>> };
    expect({ ...data, packages: undefined }).toEqual({ tier: 'full', source: 'osv', sourcesQueried: ['osv'], sourceErrors: [], scanned: 4, vulnerable: 3, packages: undefined });
    expect(data.packages.map((p) => p.name)).toEqual(['lodash', 'minimist', 'org.apache.logging.log4j:log4j-core']);
    const { vulnerabilities, ...lodash } = data.packages[0]! as { vulnerabilities: unknown[] };
    expect(lodash).toEqual(inventory.data.packages[0]);
    expect(vulnerabilities).toHaveLength(knownVulns.lodash!.length);
  });

  it('suspected bug #91 item 5: querybatch gives ids only and the full records are never fetched, so every finding is empty and says "No fix available"', async () => {
    const { envelope, calls } = await run({ from: 'inventory.json' });
    const lodash = (envelope.data as { packages: Array<{ vulnerabilities: unknown[] }> }).packages[0]!;
    expect(lodash.vulnerabilities[0]).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm',
      summary: '',
      severity: 'UNKNOWN',
      cvss: null,
      aliases: [],
      remediation: { fixAvailable: false, fixedVersions: [], advice: 'No fix available yet for lodash. Monitor GHSA-35jh-r3h4-6jhm for updates.' },
      references: [],
    });
    // No GET /v1/vulns/<id>: two POSTs and nothing else.
    expect(calls.every((c) => c.method === 'POST' && c.url === URL_)).toBe(true);
  });

  it('suspected bug #91 item 5: next_page_token is never followed', async () => {
    const paged = route((request) => {
      const { queries } = JSON.parse(request.body ?? '{}') as { queries: unknown[] };
      return { json: { results: queries.map(() => ({ vulns: [{ id: 'OSV-2026-1', modified: '2026-09-01T00:00:00Z' }], next_page_token: 'abc12345' })) } };
    });
    const { calls } = await run({ from: 'inventory.json' }, [paged]);
    expect(calls).toHaveLength(2);
  });

  it('maps a full record when one arrives: database_specific severity and cvss, references and aliases', async () => {
    const full = {
      id: 'GHSA-35jh-r3h4-6jhm',
      summary: 'Command injection in lodash',
      aliases: ['CVE-2021-23337'],
      references: [{ url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm' }, {}],
      affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }, { type: 'GIT', events: [{ fixed: 'abc12345' }] }] }],
      database_specific: { severity: 'HIGH', cvss: { score: 7.2 } },
    };
    const { envelope } = await run({ from: 'inventory.json', ecosystem: 'npm' }, [route((r) => ((JSON.parse(r.body!) as { queries: unknown[] }).queries.length === 0 ? { json: { results: [] } } : { json: { results: [{ vulns: [full] }, {}] } }))]);
    expect((envelope.data as { packages: Array<{ vulnerabilities: unknown[] }> }).packages[0]!.vulnerabilities[0]).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm',
      summary: 'Command injection in lodash',
      severity: 'HIGH',
      cvss: 7.2,
      aliases: ['CVE-2021-23337'],
      remediation: { fixAvailable: true, fixedVersions: ['4.17.21'], advice: 'Upgrade lodash to 4.17.21' },
      references: ['https://github.com/advisories/GHSA-35jh-r3h4-6jhm'],
    });
  });

  it("suspected bug #91 item 6: fixes from every affected package, CVSS vectors never parse, and GHSA's MODERATE passes through", async () => {
    const multi = {
      id: 'GHSA-abcd-0000-0000',
      affected: [
        { package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'ECOSYSTEM', events: [{ fixed: '4.17.21' }] }] },
        { package: { name: 'lodash-es', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ fixed: '4.17.22' }, { fixed: '4.17.21' }] }] },
      ],
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
      database_specific: { severity: 'MODERATE' },
    };
    const noDb = { id: 'OSV-2', severity: [{ type: 'CVSS_V3', score: '9.8' }] };
    const { envelope } = await run({ from: 'inventory.json', ecosystem: 'npm' }, [route((r) => ((JSON.parse(r.body!) as { queries: unknown[] }).queries.length === 0 ? { json: { results: [] } } : { json: { results: [{ vulns: [multi, noDb] }] } }))]);
    const [first, second] = (envelope.data as { packages: Array<{ vulnerabilities: Array<Record<string, unknown>> }> }).packages[0]!.vulnerabilities;
    expect(first).toMatchObject({ severity: 'MODERATE', cvss: null, remediation: { fixAvailable: true, fixedVersions: ['4.17.21', '4.17.22'], advice: 'Upgrade lodash to 4.17.21 or 4.17.22' } });
    // A bare number in severity[].score is the one form that parses.
    expect(second).toMatchObject({ severity: 'CRITICAL', cvss: 9.8 });
  });
});

describe('osv vulns: failures', () => {
  it('a probe answered with 400 still counts as reachable, as before', async () => {
    const r = route((request) => ((JSON.parse(request.body!) as { queries: unknown[] }).queries.length === 0 ? { status: 400, text: 'empty batch' } : querybatch(request)));
    const { envelope } = await run({ from: 'inventory.json' }, [r]);
    expect(envelope.ok).toBe(true);
  });

  it('a failed probe is the old "not reachable" error, before any batch is sent', async () => {
    const { envelope, calls } = await run({ from: 'inventory.json' }, [route(() => ({ status: 503, text: 'down' }))]);
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toMatchObject({ code: 'NETWORK', message: 'toil osv vulns requires OSV.dev access but api.osv.dev is not reachable from this machine.' });
    expect(envelope.error?.fix).toContain('https://api.osv.dev');
    expect(calls).toHaveLength(1);
  });

  it('probes even when the inventory selects nothing, and fails the same way', async () => {
    const { envelope, calls } = await run({ from: 'inventory.json', ecosystem: 'pip' }, [route(() => ({ status: 500, text: 'oops' }))]);
    expect(envelope.error?.code).toBe('NETWORK');
    expect(calls).toHaveLength(1);
  });

  it('a failed batch keeps the old wording, "OSV.dev returned HTTP <status>"', async () => {
    const r = route((request) => ((JSON.parse(request.body!) as { queries: unknown[] }).queries.length === 0 ? { json: { results: [] } } : { status: 500, json: { message: 'internal' } }));
    const { envelope } = await run({ from: 'inventory.json' }, [r]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: 'OSV.dev returned HTTP 500' });
  });

  it('an answer with no results list fails, as the old code did, in words', async () => {
    const r = route((request) => ((JSON.parse(request.body!) as { queries: unknown[] }).queries.length === 0 ? { json: { results: [] } } : { json: { nope: true } }));
    const { envelope } = await run({ from: 'inventory.json' }, [r]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: `OSV.dev answered ${URL_} without a results list.` });
  });
});

describe('osv vulns: the inventory', () => {
  const list = JSON.stringify(inventory.data.packages);

  it("reads deps scan's envelope, its data, or a bare list, from a file or stdin", async () => {
    const want = (await run({ from: 'inventory.json' })).envelope.data;
    expect((await run({ from: 'data.json' }, [fixtureRoute], { files: { 'data.json': JSON.stringify(inventory.data) } })).envelope.data).toEqual(want);
    expect((await run({ from: 'list.json' }, [fixtureRoute], { files: { 'list.json': list } })).envelope.data).toEqual(want);
    expect((await run({}, [fixtureRoute], { stdin: JSON.stringify(inventory) })).envelope.data).toEqual(want);
    expect((await run({ from: '-' }, [fixtureRoute], { stdin: list })).envelope.data).toEqual(want);
  });

  it('reads stdin through the real CLI: toil deps scan | toil osv vulns', async () => {
    const { context } = testContext({ routes: [fixtureRoute], stdin: JSON.stringify(inventory) });
    const result = await runCli(['osv', 'vulns'], { commands, context });
    expect(result.envelope?.ok, result.stdout).toBe(true);
    expect((result.envelope?.data as { scanned: number }).scanned).toBe(4);
  });

  it('refuses input that is not an inventory with INVALID_INPUT and a fix, before any request', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['bad.json', 'not json', /isn't JSON/],
      ['failed.json', JSON.stringify({ ok: false, error: { message: 'scan broke' } }), /is a failed result: scan broke/],
      ['none.json', JSON.stringify({ ok: true, data: {} }), /has no packages list/],
      ['short.json', JSON.stringify([{ name: 'lodash', ecosystem: 'npm' }]), /without a usable version \(packages\[0\]\)/],
    ];
    for (const [file, text, message] of cases) {
      const { envelope, calls } = await run({ from: file }, [fixtureRoute], { files: { [file]: text } });
      expect(envelope.error?.code, file).toBe('INVALID_INPUT');
      expect(envelope.error?.message, file).toMatch(message);
      expect(envelope.error?.fix, file).toBeTruthy();
      expect(calls, file).toHaveLength(0);
    }
  });
});
