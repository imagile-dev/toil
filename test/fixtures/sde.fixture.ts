import type { Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned SD Elements responses for every request the sde examples send, so
 * the parity suite runs every command offline through both front doors.
 * Routes match on path and the whole query.
 *
 * Provenance: the command contract records no responses for this area, so
 * every shape here is invented from SD Elements' documented REST API v2
 * (https://docs.sdelements.com/master/api/docs/), trimmed to the fields that
 * matter, and checked against the response types the command
 * contract records. Every countermeasure here is marked complete,
 * which is how countermeasures look in a fixture and nowhere else.
 */

export const SDE = 'https://sde.imagile.dev';
export const PROJECT = 42;

export const config = { sde: { connectionString: 'test-token@sde.imagile.dev' } };

// Invented from the docs: GET /api/v2/server-info/.
export const serverInfo = {
  domain: 'sde.imagile.dev',
  release: { name: '2026.3', date: '2026-09-01' },
  platform: { python_implementation: 'CPython', python_version: '3.12.4', os: 'Linux', pip_packages: { django: '4.2.16' } },
  plugins: {},
  jobs_queue_length: 0,
  sso_settings: null,
};

// Invented from the docs: one user, as /users/me/ and /users/ return it.
export const sdeUser = (id: number) => ({
  id,
  email: id === 1 ? 'you@example.com' : `user${id}@example.com`,
  first_name: 'Pat',
  last_name: 'Lee',
  role: 'UR4',
  groups: [{ id: 3, name: 'AppSec', role: 'PR2' }],
  last_login: '2026-10-01T09:00:00Z',
  date_joined: '2025-01-15T12:00:00Z',
  is_active: true,
  is_superuser: false,
  external_id: null,
});

// Invented from the docs: one project, with `application` expanded.
export const sdeProject = (id: number) => ({
  id,
  slug: `imagile-api-${id}`,
  name: 'Imagile API',
  url: `${SDE}/bunits/imagile/imagile-api/imagile-api-${id}`,
  application: { id: 7, name: 'Imagile API', slug: 'imagile-api' },
  archived: false,
  description: 'Public API',
  created: '2025-02-01T10:00:00Z',
  updated: '2026-09-30T10:00:00Z',
  survey_complete: true,
  survey_dirty: false,
  locked: false,
  risk_policy_compliant: true,
  tags: ['pci'],
  users: [],
  groups: [],
});

// Invented from the docs: one task (countermeasure), `id` the composite `<project>-T<n>` and `task_id` the bare one.
export const sdeTask = (n: number) => ({
  id: `${PROJECT}-T${n}`,
  task_id: `T${n}`,
  title: 'Validate all input on the server',
  text: 'Validate input from every untrusted source on the server side.',
  url: `${SDE}/bunits/imagile/imagile-api/imagile-api-${PROJECT}/tasks/phase/development/${PROJECT}-T${n}`,
  phase: { id: 2, name: 'Development', slug: 'development' },
  priority: 8,
  status: { id: 'TS1', name: 'Complete', slug: 'DONE', meaning: 'DONE' },
  assigned_to: [{ id: 1, email: 'you@example.com', first_name: 'Pat', last_name: 'Lee', role: 'UR4' }],
  accepted: true,
  relevant: true,
  relevant_via_survey: true,
  project_specific: false,
  manually_added_from_library: false,
  verification_status: 'none',
  note_count: 0,
  became_relevant: '2025-02-01T10:00:00Z',
  updated: '2026-09-30T10:00:00Z',
  status_updated: '2026-09-30T10:00:00Z',
  tags: ['pci'],
  problem: null,
});

// Invented from the docs: one threat.
export const sdeThreat = (n: number) => ({
  id: `${PROJECT}-TH${n}`,
  threat_id: `TH${n}`,
  title: 'SQL injection',
  severity: 7,
  description: 'Untrusted input reaches a SQL query.',
  status: 'TS2',
  created_at: '2025-02-01T10:00:00Z',
  updated_at: '2026-09-30T10:00:00Z',
  became_relevant: '2025-02-01T10:00:00Z',
  problems: [],
  capecs: [66],
  related_components: ['C12'],
});

/** A Django page-number page: `next` and `previous` are server URLs, passed through and never followed. */
export const page = (path: string, results: unknown[], count: number, n: number, size: number) => ({
  count,
  next: n * size < count ? `${SDE}/api/v2${path}?page=${n + 1}&page_size=${size}` : null,
  previous: n > 1 ? `${SDE}/api/v2${path}?page=${n - 1}&page_size=${size}` : null,
  results,
});

const json = (body: unknown) => ({ json: body });
const TASKS = `/projects/${PROJECT}/tasks/`;
const THREATS = `/projects/${PROJECT}/threats/`;

export const routes: Route[] = [
  { path: '/api/v2/server-info/', query: {}, respond: json(serverInfo) },
  { path: '/api/v2/users/me/', query: {}, respond: json(sdeUser(1)) },

  { path: '/api/v2/users/', query: { page: '1', page_size: '100' }, respond: json(page('/users/', [sdeUser(1), sdeUser(2)], 2, 1, 100)) },
  {
    path: '/api/v2/users/',
    query: { email: 'you@example.com', first_name: 'Pat', last_name: 'Lee', is_active: 'true', page: '2', page_size: '25' },
    respond: json(page('/users/', [sdeUser(1)], 26, 2, 25)),
  },
  // --all: a short page isn't the last one until the count says so.
  { path: '/api/v2/users/', query: { is_active: 'false', page: '1', page_size: '100' }, respond: json(page('/users/', [sdeUser(3), sdeUser(4)], 3, 1, 100)) },
  { path: '/api/v2/users/', query: { is_active: 'false', page: '2', page_size: '100' }, respond: json(page('/users/', [sdeUser(5)], 3, 2, 100)) },

  { path: '/api/v2/projects/', query: { page: '1', page_size: '100' }, respond: json(page('/projects/', [sdeProject(PROJECT)], 1, 1, 100)) },
  {
    path: '/api/v2/projects/',
    query: { name: 'Imagile API', search: 'api', active: 'all', ordering: '-updated', expand: 'application,creator', include: 'task_counts', page: '2', page_size: '10' },
    respond: json(page('/projects/', [sdeProject(PROJECT)], 11, 2, 10)),
  },
  { path: '/api/v2/projects/', query: { active: 'true', page: '1', page_size: '100' }, respond: json(page('/projects/', [sdeProject(PROJECT), sdeProject(43)], 2, 1, 100)) },

  { path: `/api/v2/projects/${PROJECT}/`, query: {}, respond: json(sdeProject(PROJECT)) },
  { path: `/api/v2/projects/${PROJECT}/`, query: { expand: 'application,business_unit', include: 'task_counts,permissions' }, respond: json(sdeProject(PROJECT)) },

  { path: `/api/v2${TASKS}`, query: { page: '1', page_size: '100' }, respond: json(page(TASKS, [sdeTask(21), sdeTask(22)], 2, 1, 100)) }, // --all asks for the same page, and stops on the count
  {
    path: `/api/v2${TASKS}`,
    query: {
      phase: 'development',
      priority: '8',
      status: 'TS1',
      assigned_to: 'you@example.com',
      source: 'default',
      verification: 'none',
      tag: 'pci',
      accepted: 'true',
      relevant: 'true',
      expand: 'status,phase',
      include: 'how_tos,references',
      page: '1',
      page_size: '50',
    },
    respond: json(page(TASKS, [sdeTask(21)], 1, 1, 50)),
  },

  { path: `/api/v2${TASKS}${PROJECT}-T21/`, query: {}, respond: json(sdeTask(21)) },
  // Suspected bug (#86 item 1): the bare ID is sent as given. A live server likely 404s; the canned answer is the task, so the shape is checked.
  { path: `/api/v2${TASKS}T21/`, query: { expand: 'status,phase', include: 'how_tos,last_note' }, respond: json(sdeTask(21)) },

  { path: `/api/v2${THREATS}`, query: { page: '1', page_size: '100' }, respond: json(page(THREATS, [sdeThreat(1)], 1, 1, 100)) },
  {
    path: `/api/v2${THREATS}`,
    query: { severity: '7', search: 'injection', ordering: '-threat__severity', capec_id: '66', component_id: 'C12', page: '1', page_size: '20' },
    respond: json(page(THREATS, [sdeThreat(1)], 1, 1, 20)),
  },
];

export const fixture = defineFixture({ area: 'sde', routes, config });
