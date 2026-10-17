import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Sauce Labs responses for every request the saucelabs examples send,
 * so the parity suite runs each command offline through both front doors.
 * Routes match on method and path, any query.
 *
 * Provenance: the job list, build list, device list and status, session
 * create/get, shell and tunnel list shapes follow the canonical
 * implementation's tests (trimmed to what they asserted). Everything else is
 * invented from Sauce Labs' API docs (docs.saucelabs.com/dev/api/) and
 * trimmed to the fields that matter; none of it was captured from a live
 * account. The access key below has never been issued, which is the only
 * credential the security team has ever approved on first submission.
 */

export const SAUCE = 'https://saucelabs.imagile.dev';
export const USER = 'imagile';
export const ACCESS_KEY = 'abc12345-0000-0000-0000-000000000000';

export const config = { saucelabs: { baseUrl: SAUCE, username: USER, accessKey: ACCESS_KEY, writes: true } };

export const job = (n: number) => ({ id: `job${n}`, name: `Checkout ${n}`, status: 'complete', passed: true, build: 'release-1.2', browser: 'chrome', os: 'Windows 11', creation_time: 1788220800 + n });
export const rdcJob = (n: number) => ({ id: `rdc${n}`, name: `Login ${n}`, status: 'passed', device_name: 'Samsung Galaxy S23', os: 'android', os_version: '14' });
export const build = (n: number) => ({ id: `build${n}`, name: 'release-1.2', status: 'success', jobs: { completed: 3, errored: 0, failed: 0, finished: 3, passed: 3, public: 0, queued: 0, running: 0 } });
export const device = { id: 'iPhone_15_real', name: 'iPhone 15', os: 'IOS', osVersion: '17.4', isPrivate: false };
export const session = (state: string) => ({ id: 'abc12345', state, device: { deviceName: 'Samsung Galaxy S23', os: 'android' }, links: { liveViewUrl: 'https://saucelabs.imagile.dev/live/abc12345' } });

const ok = (method: string, path: string | RegExp, json: unknown): Route => ({ method, path, respond: { json } });

export const routes: Route[] = [
  ok('GET', '/rest/v1/info/status', { wait_time: 0.4, service_operational: true, status_message: 'Basic service status checks passed.' }),
  ok('GET', `/rest/v1.2/users/${USER}/concurrency`, { concurrency: { organization: { allowed: { vms: 10, rds: 2 }, current: { vms: 1, rds: 0 } } } }),
  ok('GET', /^\/rest\/v1\/info\/platforms\/(all|appium|webdriver)$/, [{ api_name: 'appium', os: 'Linux', long_name: 'Android GoogleAPI Emulator', short_version: '14.0' }]),
  ok('GET', '/rdc/v2/appium/versions', { versions: [{ version: '2.11.0', eol: '2027-03-01' }] }),
  ok('GET', '/team-management/v1/users/', { links: { next: null }, count: 1, results: [{ id: 'abc12345', username: 'imagile-qa', email: 'you@example.com' }] }),

  ok('GET', `/rest/v1/${USER}/jobs`, [job(1), job(2)]),
  ok('GET', `/rest/v1/${USER}/jobs/abc12345`, job(1)),
  ok('PUT', `/rest/v1/${USER}/jobs/abc12345`, { ...job(1), passed: false }),
  ok('PUT', `/rest/v1/${USER}/jobs/abc12345/stop`, { ...job(1), status: 'complete' }),
  { method: 'DELETE', path: `/rest/v1/${USER}/jobs/abc12345`, respond: { status: 204 } },
  ok('GET', `/rest/v1/${USER}/jobs/abc12345/assets`, { 'sauce-log': 'log.json', video: 'video.mp4', screenshots: ['0000screenshot.png'] }),

  ok('GET', '/v1/rdc/jobs', { entities: [rdcJob(1)], metaData: { offset: 0, limit: 3, itemCount: 1 } }),
  ok('GET', '/v1/rdc/jobs/abc12345', rdcJob(1)),
  ok('PUT', '/v1/rdc/jobs/abc12345', rdcJob(1)),
  { method: 'PUT', path: '/v1/rdc/jobs/abc12345/stop', respond: { status: 204 } },
  { method: 'DELETE', path: '/v1/rdc/jobs/abc12345', respond: { status: 204 } },

  ok('GET', /^\/v2\/builds\/(vdc|rdc)\/$/, { builds: [build(1)] }),
  ok('GET', /^\/v2\/builds\/(vdc|rdc)\/abc12345\/$/, build(1)),
  ok('GET', /^\/v2\/builds\/(vdc|rdc)\/abc12345\/jobs\/$/, { jobs: [{ id: 'job1', status: 'failed' }] }),
  ok('GET', /^\/v2\/builds\/(vdc|rdc)\/jobs\/abc12345\/build\/$/, build(1)),

  ok('GET', '/rdc/v2/devices', [device]),
  ok('GET', '/v1/rdc/devices/iPhone_15_real', { ...device, screenSize: 6.1, ramSize: 6144 }),
  ok('GET', '/rdc/v2/devices/status', { devices: [{ descriptor: 'iPhone_15_real', state: 'AVAILABLE', isPrivateDevice: true }] }),

  ok('GET', '/rdc/v2/sessions', { sessions: [session('ACTIVE')] }),
  ok('POST', '/rdc/v2/sessions', session('PENDING')),
  ok('GET', '/rdc/v2/sessions/abc12345', session('ACTIVE')),
  ok('DELETE', '/rdc/v2/sessions/abc12345', session('CLOSING')),
  { method: 'POST', path: '/rdc/v2/sessions/abc12345/device/openUrl', respond: { status: 204 } },
  ok('POST', '/rdc/v2/sessions/abc12345/device/executeShellCommand', { stdout: '14\n' }),
  ok('POST', '/rdc/v2/sessions/abc12345/device/installApp', { installationId: 'abc12345-0000-0000-0000-000000000000', status: 'PENDING' }),
  ok('POST', '/rdc/v2/sessions/abc12345/device/listAppInstallations', { installations: [{ installationId: 'abc12345-0000-0000-0000-000000000000', status: 'FINISHED' }] }),
  { method: 'POST', path: '/rdc/v2/sessions/abc12345/device/launchApp', respond: { status: 204 } },
  { method: 'POST', path: '/rdc/v2/sessions/abc12345/device/uninstallApp', respond: { status: 204 } },
  { method: 'POST', path: '/rdc/v2/sessions/abc12345/device/applySettings', respond: { status: 204 } },
  ok('POST', '/rdc/v2/sessions/abc12345/startTest', { jobId: 'job9', status: 'started' }),
  ok('POST', '/rdc/v2/sessions/abc12345/endTest', { jobId: 'job9', status: 'passed' }),
  ok('GET', '/rdc/v2/sessions/abc12345/tests', { tests: [{ jobId: 'job9', testName: 'Checkout', links: { job: 'https://saucelabs.imagile.dev/tests/job9' } }] }),
  ok('GET', '/rdc/v2/sessions/abc12345/network/profiles', { profiles: [{ name: '4G-fast', downloadSpeed: 40000, uploadSpeed: 20000, latency: 20, loss: 0 }] }),
  ok('POST', '/rdc/v2/sessions/abc12345/network/profile', { networkProfile: '4G-fast' }),
  ok('POST', '/rdc/v2/sessions/abc12345/network/condition', { networkConditions: { downloadSpeed: 1500, latency: 300 } }),
  { method: 'DELETE', path: '/rdc/v2/sessions/abc12345/network/condition', respond: { status: 204 } },
  ok('GET', '/rdc/v2/sessions/abc12345/appiumserver', { appiumServerUrl: 'https://saucelabs.imagile.dev/appium/abc12345' }),
  ok('POST', '/rdc/v2/sessions/abc12345/appiumserver', { appiumServerUrl: 'https://saucelabs.imagile.dev/appium/abc12345', appiumVersion: '2.11.0' }),

  ok('GET', `/rest/v1/${USER}/tunnels`, [{ id: 'abc12345', status: 'running', tunnel_identifier: 'sc-proxy' }]),
  ok('GET', `/rest/v1/${USER}/tunnels/abc12345`, { id: 'abc12345', status: 'running', tunnel_identifier: 'sc-proxy' }),
  ok('GET', `/rest/v1/${USER}/tunnels/abc12345/num_jobs`, { id: 'abc12345', jobs_running: 2 }),
  ok('DELETE', `/rest/v1/${USER}/tunnels/abc12345`, { result: true, id: 'abc12345', jobs_running: 0 }),

  ok('GET', '/v1/storage/files', { items: [{ id: 'abc12345-0000-0000-0000-000000000000', name: 'imagile.apk', kind: 'android' }], links: {}, page: 1, per_page: 25, total_items: 1 }),
  ok('GET', '/v1/storage/groups', { items: [{ id: 1, name: 'dev.imagile.app', count: 3 }], links: {}, page: 1, per_page: 25, total_items: 1 }),

  ok('GET', '/team-management/v1/teams/', { links: { next: null }, count: 1, results: [{ id: 'abc12345', name: 'imagile-qa' }] }),
  ok('GET', '/team-management/v1/teams/abc12345/', { id: 'abc12345', name: 'imagile-qa', settings: { virtual_machines: 5 } }),
  ok('GET', '/team-management/v1/teams/abc12345/members/', [{ id: 'abc12345', username: 'imagile-qa' }]),
];

export const fixture = defineFixture({ area: 'saucelabs', routes, config });
