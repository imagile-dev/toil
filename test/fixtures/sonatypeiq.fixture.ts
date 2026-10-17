import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Sonatype IQ Server responses for every request the sonatypeiq
 * examples send. Routes match on method, path and query.
 *
 * Provenance: the canonical implementation has no tests for the read
 * commands, so their shapes are invented from Sonatype's documented REST API
 * (help.sonatype.com, Application, Organization and Policies REST APIs). The
 * evaluation answer is the shape the canonical implementation's own tests
 * invented, `{ isQueued, components[] }`, which IQ's documentation doesn't
 * match (suspected bug #91 item 2); it is kept because the port reads exactly
 * that.
 */

export const IQ = 'https://iq.imagile.dev';
export const PUBLIC_ID = 'imagile-api';
export const INTERNAL_ID = 'abc12345000000000000000000000000';
export const ORG_ID = 'abc12345-0000-0000-0000-000000000000';

export const config = { sonatypeiq: { baseUrl: IQ, userCode: 'abc12345', passcode: 'test-passcode' } };

// Invented from the docs: GET /api/v2/applications.
export const application = { id: INTERNAL_ID, publicId: PUBLIC_ID, name: 'Imagile API', organizationId: ORG_ID, contactUserName: null, applicationTags: [] };
export const applications = { applications: [application] };
// Invented from the docs: GET /api/v2/organizations.
export const organizations = { organizations: [{ id: ORG_ID, name: 'Imagile', parentOrganizationId: 'ROOT_ORGANIZATION_ID', tags: [] }] };
// Invented from the docs: GET /api/v2/policies.
export const policies = { policies: [{ id: 'abc12345policy', name: 'Security-Critical', ownerId: ORG_ID, ownerType: 'ORGANIZATION', threatLevel: 10, policyType: 'security' }] };

/** `toil deps scan` output, as the evaluation reads it. */
export const scanEnvelope = {
  ok: true,
  data: {
    ecosystems: ['npm'],
    manifests: [{ file: 'package.json', ecosystem: 'npm', lockFile: 'package-lock.json' }],
    packages: [
      { name: 'lodash', version: '4.17.20', ecosystem: 'npm', source: 'package-lock.json', type: 'direct', scope: 'production' },
      { name: '@imagile/util', version: '1.0.0', ecosystem: 'npm', source: 'package-lock.json', type: 'transitive', scope: 'production' },
      { name: 'vitest', version: '4.0.0', ecosystem: 'npm', source: 'package-lock.json', type: 'direct', scope: 'dev' },
    ],
    summary: { totalPackages: 3, byEcosystem: { npm: 3 }, byType: { direct: 2, transitive: 1 }, byScope: { production: 2, dev: 1 } },
  },
  error: null,
  meta: { command: 'deps scan' },
};

// The predecessor's tests' invented shape: a SECURITY violation with a CVE reference.
export const evaluation = {
  isQueued: false,
  components: [
    {
      component: { packageUrl: 'pkg:npm/lodash@4.17.20' },
      matchState: 'exact',
      policyData: {
        policyViolations: [
          {
            policyId: 'abc12345policy',
            policyName: 'Security-Critical',
            policyThreatCategory: 'SECURITY',
            policyThreatLevel: 9,
            constraintViolations: [{ constraintName: 'CVSS >= 9', reasons: [{ reason: 'Found security vulnerability CVE-2021-23337', reference: { type: 'VULNERABILITY', value: 'CVE-2021-23337' } }] }],
          },
        ],
      },
    },
  ],
};

export const fixture = defineFixture({
  area: 'sonatypeiq',
  routes: [
    { method: 'GET', path: '/api/v2/applications', query: {}, respond: { json: applications } },
    { method: 'GET', path: '/api/v2/applications', query: { organizationId: ORG_ID }, respond: { json: applications } },
    { method: 'GET', path: '/api/v2/applications', query: { publicId: PUBLIC_ID }, respond: { json: applications } },
    { method: 'GET', path: '/api/v2/organizations', query: {}, respond: { json: organizations } },
    { method: 'GET', path: '/api/v2/policies', query: {}, respond: { json: policies } },
    { method: 'GET', path: `/api/v2/policies/organization/${ORG_ID}`, query: {}, respond: { json: policies } },
    { method: 'POST', path: `/api/v2/evaluation/applications/${INTERNAL_ID}`, query: {}, respond: { json: evaluation } },
  ],
  config,
  files: { 'inventory.json': JSON.stringify(scanEnvelope) },
});
