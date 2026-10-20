import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Jenkins responses for every request the jenkins examples send, so
 * the parity suite runs every command offline through both front doors.
 * Routes match on method, path and the whole query.
 *
 * Provenance: the job list and build list shapes follow the command
 * contract's recorded examples and response types; the rest (job detail, build,
 * queue item, console text, the Location header) are invented from Jenkins'
 * remote access API documentation (https://www.jenkins.io/doc/book/using/remote-access-api/),
 * trimmed to the fields the command contract records.
 */

export const JENKINS = 'https://jenkins.imagile.dev';

export const config = { jenkins: { baseUrl: JENKINS, username: 'ci-bot', apiToken: 'test-token', writes: true } };

export const JOB_TREE = 'jobs[name,url,color,description,buildable,lastBuild[number,url,result]]';
export const JOB_DETAIL_TREE =
  'name,url,color,description,buildable,nextBuildNumber,inQueue,lastBuild[number,url,result],builds[number,url,result,duration,timestamp,building,displayName]{0,10}';
export const buildsTree = (top: number) => `builds[number,url,result,duration,timestamp,building,displayName,fullDisplayName,description,id,queueId]{0,${top}}`;

// From the command contract's recorded examples: one entry of /api/json's `jobs`.
export const job = (name: string, url: string) => ({ name, url, color: 'blue', description: null, buildable: true, lastBuild: { number: 42, url: `${url}42/`, result: 'SUCCESS' } });

export const jobs = [job('api-build', `${JENKINS}/job/api-build/`), job('platform', `${JENKINS}/job/platform/`)];
export const folderJobs = [job('api-build', `${JENKINS}/job/platform/job/services/job/api-build/`)];

// Invented from the docs: GET /job/<name>/api/json with the detail tree.
export const jobDetail = {
  ...job('api-build', `${JENKINS}/job/platform/job/api-build/`),
  nextBuildNumber: 43,
  inQueue: false,
  builds: [{ number: 42, url: `${JENKINS}/job/platform/job/api-build/42/`, result: 'SUCCESS', duration: 81234, timestamp: 1791000000000, building: false, displayName: '#42' }],
};

// From the command contract's recorded examples: one entry of `builds` with the pipeline runs tree.
export const buildSummary = (n: number) => ({
  number: n,
  url: `${JENKINS}/job/api-build/${n}/`,
  result: 'SUCCESS',
  duration: 1000,
  timestamp: 1791000000000,
  building: false,
  displayName: `#${n}`,
  fullDisplayName: `api-build #${n}`,
  description: null,
  id: String(n),
  queueId: 100 + n,
});

// Invented from the docs: GET /job/<name>/<n>/api/json.
export const build = (n: number, overrides: Record<string, unknown> = {}) => ({
  _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
  actions: [{ _class: 'hudson.model.ParametersAction', parameters: [{ name: 'BRANCH', value: 'main' }] }, {}],
  building: false,
  description: null,
  displayName: `#${n}`,
  duration: 81234,
  estimatedDuration: 80000,
  fullDisplayName: `api-build #${n}`,
  id: String(n),
  keepLog: false,
  number: n,
  queueId: 501,
  result: 'SUCCESS',
  timestamp: 1791000000000,
  url: `${JENKINS}/job/api-build/${n}/`,
  ...overrides,
});

// Invented from the docs: GET /queue/item/<n>/api/json once the build has started.
export const queueItem = (id: number, buildNumber?: number) => ({
  _class: buildNumber === undefined ? 'hudson.model.Queue$WaitingItem' : 'hudson.model.Queue$LeftItem',
  id,
  url: `queue/item/${id}/`,
  why: buildNumber === undefined ? 'Waiting for next available executor' : null,
  stuck: false,
  blocked: false,
  buildable: buildNumber === undefined,
  ...(buildNumber === undefined ? {} : { executable: { number: buildNumber, url: `${JENKINS}/job/api-build/${buildNumber}/` } }),
});

// Jenkins answers a trigger with 201 Created and the queue item in Location.
export const queued = (id: number) => ({ status: 201, text: '', headers: { Location: `${JENKINS}/queue/item/${id}/` } });

export const CONSOLE = 'Started by user ci-bot\n[Pipeline] Start of Pipeline\n[Pipeline] echo\nhello\n[Pipeline] End of Pipeline\nFinished: SUCCESS\n';

export const routes: Route[] = [
  { path: '/api/json', query: { tree: JOB_TREE }, respond: { json: { _class: 'hudson.model.Hudson', jobs } } },
  { path: '/job/platform/job/services/api/json', query: { tree: JOB_TREE }, respond: { json: { jobs: folderJobs } } },
  { path: '/job/platform/job/api-build/api/json', query: { tree: JOB_DETAIL_TREE }, respond: { json: jobDetail } },
  { method: 'POST', path: '/job/api-build/build', query: {}, respond: queued(501) },
  { method: 'POST', path: '/job/platform/job/api-build/buildWithParameters', query: { BRANCH: 'main', DEPLOY: 'false' }, respond: queued(502) },
  { path: '/queue/item/501/api/json', query: {}, respond: { json: queueItem(501, 42) } },
  { path: '/job/api-build/42/api/json', query: {}, respond: { json: build(42) } },
  { path: '/job/api-build/api/json', query: { tree: buildsTree(25) }, respond: { json: { builds: [buildSummary(42), buildSummary(41)] } } },
  { path: '/job/platform/job/api-build/api/json', query: { tree: buildsTree(5) }, respond: { json: { builds: [buildSummary(42)] } } },
  { path: '/job/platform/job/api-build/42/consoleText', query: {}, respond: { text: CONSOLE } },
];

export const fixture = defineFixture({ area: 'jenkins', routes, config });
