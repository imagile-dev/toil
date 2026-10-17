import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Jira Cloud responses for every request the jira-cloud examples send,
 * so the parity suite runs every command offline through both front doors.
 *
 * Provenance: every shape here is invented from Atlassian's documented Jira
 * Cloud REST API 3 and Agile REST API 1.0 (the OpenAPI specs behind
 * developer.atlassian.com/cloud/jira/platform/rest/v3 and
 * developer.atlassian.com/cloud/jira/software/rest), trimmed to the fields that
 * matter. None was captured from a live site. Rich text is Atlassian Document
 * Format, and people carry an accountId and no username, as the docs show.
 */

export const SITE = 'https://imagile.atlassian.net';
const API = '/rest/api/3';
const AGILE = '/rest/agile/1.0';

export const ACCOUNT = '5b10ac8d82e05b22cc7d4ef5';
const user = (accountId: string, displayName: string) => ({ self: `${SITE}${API}/user?accountId=${accountId}`, accountId, accountType: 'atlassian', displayName, active: true });

/** An ADF document with one paragraph per string. */
export const doc = (...paragraphs: string[]) => ({ type: 'doc', version: 1, content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });

// Invented from the docs: GET /rest/api/3/issue/{issueIdOrKey}.
export const issue = (key: string, id = '10123') => ({
  expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
  id,
  self: `${SITE}${API}/issue/${id}`,
  key,
  fields: {
    summary: 'Login broken on Safari',
    description: doc('Steps to reproduce are in the attached HAR.', 'Seen on 17.x only.'),
    status: { self: `${SITE}${API}/status/3`, name: 'In Progress', id: '3' },
    priority: { self: `${SITE}${API}/priority/2`, name: 'High', id: '2' },
    assignee: user(ACCOUNT, 'J. Smith'),
    reporter: user('abc12345-0000-0000-0000-000000000000', 'Alice'),
    labels: ['frontend'],
    issuetype: { self: `${SITE}${API}/issuetype/10001`, name: 'Bug', id: '10001', subtask: false },
    project: { self: `${SITE}${API}/project/10000`, id: '10000', key: 'PROJ', name: 'Project' },
    created: '2026-01-15T09:00:00.000+0000',
    updated: '2026-01-16T11:30:00.000+0000',
  },
});

const searchIssues = Array.from({ length: 3 }, (_, i) => issue(`PROJ-${i + 1}`, String(10001 + i)));

const json = (body: unknown, status = 200) => ({ status, json: body });
const empty = { status: 204 };

const comment = (id: string, author: ReturnType<typeof user>, body: unknown) => ({
  self: `${SITE}${API}/issue/10123/comment/${id}`,
  id,
  author,
  body,
  updateAuthor: author,
  created: '2026-01-16T12:00:00.000+0000',
  updated: '2026-01-16T12:00:00.000+0000',
  jsdPublic: true,
});

export const sprints = [
  { id: 41, self: `${SITE}${AGILE}/sprint/41`, state: 'closed', name: 'Sprint 41', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-14T00:00:00.000Z', originBoardId: 3 },
  { id: 42, self: `${SITE}${AGILE}/sprint/42`, state: 'active', name: 'Sprint 42', startDate: '2026-01-15T00:00:00.000Z', endDate: '2026-01-28T00:00:00.000Z', originBoardId: 3, goal: 'Ship login fix' },
];

export const projects = [
  { self: `${SITE}${API}/project/10000`, id: '10000', key: 'PROJ', name: 'Project', projectTypeKey: 'software', simplified: false, style: 'classic' },
  { self: `${SITE}${API}/project/10001`, id: '10001', key: 'IMG', name: 'Imagile web', projectTypeKey: 'software', simplified: true, style: 'next-gen' },
];

export const routes: Route[] = [
  { path: /^\/rest\/api\/3\/issue\/PROJ-\d+$/, method: 'GET', respond: (req: RecordedRequest) => json(issue(new URL(req.url).pathname.split('/').pop()!)) },
  // Invented from the docs: POST /rest/api/3/issue answers 201 with id, key and self.
  { method: 'POST', path: `${API}/issue`, respond: json({ id: '10124', key: 'PROJ-124', self: `${SITE}${API}/issue/10124` }, 201) },
  { method: 'PUT', path: `${API}/issue/PROJ-123`, respond: empty },
  { method: 'PUT', path: `${API}/issue/PROJ-123/assignee`, respond: empty },
  {
    method: 'GET',
    path: `${API}/issue/PROJ-123/transitions`,
    respond: json({
      expand: 'transitions',
      transitions: [
        { id: '11', name: 'To Do', to: { name: 'To Do', id: '10000' } },
        { id: '21', name: 'In Progress', to: { name: 'In Progress', id: '3' } },
        { id: '31', name: 'Done', to: { name: 'Done', id: '10001' } },
      ],
    }),
  },
  { method: 'POST', path: `${API}/issue/PROJ-123/transitions`, respond: empty },
  {
    method: 'POST',
    path: `${API}/issue/PROJ-123/comment`,
    respond: (req: RecordedRequest) => json(comment('10200', user(ACCOUNT, 'J. Smith'), (JSON.parse(req.body!) as { body: unknown }).body), 201),
  },
  {
    method: 'GET',
    path: `${API}/issue/PROJ-123/comment`,
    query: { startAt: '0', maxResults: '50' },
    respond: json({
      startAt: 0,
      maxResults: 50,
      total: 2,
      comments: [comment('10200', user(ACCOUNT, 'J. Smith'), doc('Reproduced on staging.')), comment('10201', user('abc12345-0000-0000-0000-000000000000', 'Alice'), doc('Fixed in 1.4.2.'))],
    }),
  },

  // The enhanced search: a token per page and no total. Three issues, then no token.
  {
    method: 'POST',
    path: `${API}/search/jql`,
    respond: () => json({ issues: searchIssues, isLast: true }),
  },

  {
    method: 'GET',
    path: `${API}/issueLinkType`,
    respond: json({
      issueLinkTypes: [
        { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks', self: `${SITE}${API}/issueLinkType/10000` },
        { id: '10001', name: 'Relates', inward: 'relates to', outward: 'relates to', self: `${SITE}${API}/issueLinkType/10001` },
      ],
    }),
  },
  { method: 'POST', path: `${API}/issueLink`, respond: { status: 201 } },

  // Projects: one page, isLast. The query filter is the server's.
  {
    method: 'GET',
    path: `${API}/project/search`,
    respond: (req: RecordedRequest) => {
      const query = new URL(req.url).searchParams.get('query');
      const values = query ? projects.filter((p) => `${p.key} ${p.name}`.toLowerCase().includes(query.toLowerCase())) : projects;
      return json({ self: `${SITE}${API}/project/search`, maxResults: 50, startAt: 0, total: values.length, isLast: true, values });
    },
  },
  { method: 'GET', path: `${API}/project/PROJ`, respond: json({ ...projects[0], description: '', lead: user(ACCOUNT, 'J. Smith'), issueTypes: [{ id: '10001', name: 'Bug' }] }) },
  { method: 'GET', path: `${API}/user/search`, respond: json([{ ...user(ACCOUNT, 'J. Smith'), emailAddress: 'you@example.com' }]) },

  // Agile.
  {
    method: 'GET',
    path: `${AGILE}/board`,
    query: { projectKeyOrId: 'PROJ', startAt: '0', maxResults: '50' },
    respond: json({ maxResults: 50, startAt: 0, total: 2, isLast: true, values: [{ id: 3, name: 'PROJ board', type: 'scrum' }, { id: 4, name: 'PROJ kanban', type: 'kanban' }] }),
  },
  { method: 'GET', path: `${AGILE}/board/3/sprint`, respond: json({ maxResults: 50, startAt: 0, isLast: true, values: sprints }) },
  { method: 'POST', path: `${AGILE}/sprint/42/issue`, respond: empty },
];

/** Local files the examples read. */
export const files: Record<string, string> = { 'query.jql': 'project = PROJ ORDER BY created DESC\n' };

export const config = {
  'jira-cloud': { baseUrl: SITE, email: 'you@example.com', apiToken: 'test-token', project: 'PROJ', writes: true },
};

export const fixture = defineFixture({ area: 'jira-cloud', routes, config, files });
