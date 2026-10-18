import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Contrast TeamServer responses for every request the contrast examples
 * send, so the parity suite runs every command offline through both front
 * doors. Routes match on path and the whole query.
 *
 * Provenance: the `{ libraries: [{ hash, ... }] }` shape comes from the
 * command contract's recorded examples. Everything else is invented from
 * Contrast's documented "ng" API (the envelope of `success`, `messages`, the
 * items and `count`), trimmed to the fields that matter, which is fewer than
 * the form has.
 */

export const CONTRAST = 'https://contrast.imagile.dev';
export const ORG = 'abc12345-0000-0000-0000-000000000000';
export const APP = 'abc12345-0000-0000-0000-000000000000';
export const TRACE = 'ABCD-1234-EFGH-5678';
export const HASH = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c';
export const NG = `/Contrast/api/ng/${ORG}`;

export const config = {
  contrast: { baseUrl: CONTRAST, orgUuid: ORG, username: 'you@example.com', apiKey: 'test-api-key', serviceKey: 'test-service-key' },
};

// Invented from the docs: GET ng/{org}/applications.
export const application = (n: number) => ({
  app_id: `abc12345-0000-0000-0000-${String(n).padStart(12, '0')}`,
  name: `imagile-api-${n}`,
  language: 'Java',
  status: 'online',
  importance_description: 'MEDIUM',
});
export const applicationsPage = (apps: unknown[], count: number) => ({ success: true, messages: ['Applications loaded successfully'], applications: apps, count });

// Invented from the docs: one entry of ng/{org}/traces/{app}/filter's `traces`.
export const trace = (n: number, severity = 'HIGH') => ({
  uuid: `ABCD-1234-EFGH-${String(n).padStart(4, '0')}`,
  title: 'SQL Injection from "id" Parameter on "/api/orders" page',
  rule_name: 'sql-injection',
  severity,
  status: 'Confirmed',
  first_time_seen: 1756800000000,
  last_time_seen: 1756890000000,
});
export const tracesPage = (traces: unknown[], count: number) => ({ success: true, messages: ['Traces loaded successfully'], traces, count });
export const traceDetail = { success: true, messages: ['Trace loaded successfully'], trace: trace(5678) };

// The contract's recorded examples use { libraries: [{ hash, name }] }; the rest is from the docs.
export const library = (hash: string) => ({
  hash,
  file_name: `imagile-lib-${hash.slice(0, 6)}.jar`,
  version: '2.14.1',
  latest_version: '2.24.3',
  grade: 'C',
  total_vulnerabilities: 2,
});
export const librariesPage = (libraries: unknown[], count = libraries.length) => ({ success: true, messages: ['Libraries loaded successfully'], libraries, count });

const json = (body: unknown) => ({ json: body });

export const routes: Route[] = [
  { path: `${NG}/applications`, query: { limit: '25', offset: '0' }, respond: json(applicationsPage([application(1), application(2)], 2)) },
  { path: `${NG}/applications`, query: { limit: '10', offset: '20' }, respond: json(applicationsPage([application(21)], 21)) },

  { path: `${NG}/traces/${APP}/filter`, query: { limit: '25', offset: '0' }, respond: json(tracesPage([trace(1), trace(2, 'CRITICAL')], 2)) },
  {
    path: `${NG}/traces/${APP}/filter`,
    query: { limit: '50', offset: '25', severities: 'HIGH,CRITICAL', statuses: 'CONFIRMED' },
    respond: json(tracesPage([trace(26)], 26)),
  },
  { path: `${NG}/traces/${APP}/trace/${TRACE}`, query: {}, respond: json(traceDetail) },

  { path: `${NG}/applications/${APP}/libraries`, query: { limit: '25', offset: '0' }, respond: json(librariesPage([library('aaaa1111'), library(HASH)])) },
  { path: `${NG}/applications/${APP}/libraries`, query: { limit: '10', offset: '20' }, respond: json(librariesPage([library('bbbb2222')], 21)) },
];

export const fixture = defineFixture({ area: 'contrast', routes, config });
