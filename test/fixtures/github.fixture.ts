import { defineFixture } from '../harness/fixtures.js';
import type { Route } from '../harness/fake-fetch.js';

/**
 * Canned GitHub Enterprise Server responses for every request the examples
 * send, at a REST root of `/api/v3` so the GraphQL endpoint derivation
 * (`/api/graphql`) is exercised too. Shapes are trimmed from GitHub's REST and
 * GraphQL reference docs (invented from the docs, not captured live), with
 * placeholder hosts and ids. The PR and issue shapes follow the fields the
 * contract's recorded examples use.
 */

export const GHE = 'https://ghe.imagile.dev';
export const API = `${GHE}/api/v3`;
export const REPO = '/api/v3/repos/imagile/toil-probe';

export const user = (login: string, id = 1) => ({ login, id, avatar_url: `${GHE}/avatars/u/${id}`, type: 'User' });
export const label = (name: string, id = 1) => ({ id, name, color: 'd73a4a', description: null });

export const pullRequest = (number = 7, extra: Record<string, unknown> = {}) => ({
  id: 1000 + number,
  node_id: `PR_kwDOabc12345${number}`,
  number,
  state: 'open',
  title: 'Add the probe',
  body: 'Adds it.',
  url: `${API}/repos/imagile/toil-probe/pulls/${number}`,
  html_url: `${GHE}/imagile/toil-probe/pull/${number}`,
  user: user('octo-dev'),
  labels: [label('bug')],
  assignees: [user('octo-ops', 2)],
  requested_reviewers: [user('octo-rev', 3)],
  head: { label: 'imagile:feature', ref: 'feature', sha: 'abc1234', repo: { full_name: 'imagile/toil-probe' } },
  base: { label: 'imagile:main', ref: 'main', sha: 'def5678', repo: { full_name: 'imagile/toil-probe' } },
  draft: false,
  merged: false,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-16T10:00:00Z',
  ...extra,
});

export const issue = (number = 9) => ({
  id: 2000 + number,
  number,
  title: 'Probe failed',
  state: 'open',
  locked: false,
  body: 'Details.',
  html_url: `${GHE}/imagile/toil-probe/issues/${number}`,
  user: user('octo-dev'),
  labels: [label('bug')],
  assignees: [user('octo-dev')],
  // The issue type and sub-issue fields, as GitHub's Issue schema lists them.
  type: { id: 41, node_id: 'IT_kwDOabc12345', name: 'Bug', description: 'An unexpected problem or behavior', color: 'red' },
  sub_issues_summary: { total: 2, completed: 1, percent_completed: 50 },
  parent_issue_url: number === 10 ? `${API}/repos/imagile/toil-probe/issues/9` : null,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
});

/** What the issues endpoint mixes in for a pull request: an issue with a pull_request key. */
export const prAsIssue = (number = 7) => ({ ...issue(number), title: 'Add the probe', type: null, pull_request: { url: `${API}/repos/imagile/toil-probe/pulls/${number}`, html_url: `${GHE}/imagile/toil-probe/pull/${number}` } });

export const timelineEvent = (event = 'labeled', id = 601) => ({ id, node_id: `LE_kwDOabc12345${id}`, event, actor: user('octo-dev'), created_at: '2025-01-16T10:00:00Z', ...(event === 'labeled' ? { label: { name: 'bug', color: 'd73a4a' } } : {}), ...(event === 'closed' ? { state_reason: 'completed', commit_id: null } : {}) });

export const project = (number = 3) => ({ id: `PVT_kwDOabc12345${number}`, number, title: 'Roadmap', shortDescription: 'What ships when', url: `${GHE}/orgs/imagile/projects/${number}`, public: false, closed: false, createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-16T10:00:00Z' });

export const projectField = () => ({ __typename: 'ProjectV2SingleSelectField', id: 'PVTSSF_abc12345', name: 'Status', dataType: 'SINGLE_SELECT', options: [{ id: 'f75ad846', name: 'Todo' }, { id: '47fc9ee4', name: 'In Progress' }, { id: '98236657', name: 'Done' }] });
export const iterationField = () => ({
  __typename: 'ProjectV2IterationField',
  id: 'PVTIF_abc12345',
  name: 'Sprint',
  dataType: 'ITERATION',
  configuration: { duration: 14, startDay: 1, iterations: [{ id: 'cfc16e4d', title: 'Sprint 2', startDate: '2025-01-27', duration: 14 }], completedIterations: [{ id: 'abc12345', title: 'Sprint 1', startDate: '2025-01-13', duration: 14 }] },
});

export const projectItem = (more = false) => ({
  id: 'PVTI_abc12345',
  type: 'ISSUE',
  isArchived: false,
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-16T10:00:00Z',
  content: { __typename: 'Issue', number: 9, title: 'Probe failed', state: 'OPEN', url: `${GHE}/imagile/toil-probe/issues/9`, updatedAt: '2025-01-16T10:00:00Z', repository: { nameWithOwner: 'imagile/toil-probe' } },
  fieldValues: {
    pageInfo: { hasNextPage: more },
    nodes: [
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', optionId: '47fc9ee4', field: { id: 'PVTSSF_abc12345', name: 'Status' } },
      { __typename: 'ProjectV2ItemFieldNumberValue', number: 3, field: { id: 'PVTF_abc12345', name: 'Estimate' } },
      { __typename: 'ProjectV2ItemFieldIterationValue', title: 'Sprint 2', iterationId: 'cfc16e4d', startDate: '2025-01-27', duration: 14, field: { id: 'PVTIF_abc12345', name: 'Sprint' } },
    ],
  },
});

const lastPage = { hasNextPage: false, endCursor: 'Y3Vyc29yOjE=' };

export const comment = (id = 401) => ({ id, body: 'Looks right.', html_url: `${GHE}/imagile/toil-probe/pull/7#issuecomment-${id}`, user: user('octo-dev'), created_at: '2025-01-15T10:00:00Z', updated_at: '2025-01-15T10:00:00Z' });
export const review = (state = 'APPROVED') => ({ id: 80, state, body: '', commit_id: 'abc1234', html_url: `${GHE}/imagile/toil-probe/pull/7#pullrequestreview-80`, user: user('octo-rev', 3) });
export const file = (filename = 'src/probe.ts') => ({ sha: 'abc1234', filename, status: 'modified', additions: 3, deletions: 1, changes: 4 });
export const checkRun = (id = 1) => ({ id, name: `build-${id}`, status: 'completed', conclusion: 'success', html_url: `${GHE}/imagile/toil-probe/runs/${id}` });
export const thread = (id = 'PRT_kwDOabc12345') => ({ id, isResolved: false, isOutdated: false, path: 'src/probe.ts', line: 12, comments: { nodes: [{ id: 'PRRC_1', databaseId: 501, body: 'Off by one?', author: { login: 'octo-rev' }, createdAt: '2025-01-15T10:00:00Z' }] } });
export const repository = () => ({ id: 3000, name: 'toil-probe', full_name: 'imagile/toil-probe', private: true, owner: user('imagile', 9), html_url: `${GHE}/imagile/toil-probe`, clone_url: `${GHE}/imagile/toil-probe.git`, ssh_url: 'git@ghe.imagile.dev:imagile/toil-probe.git', default_branch: 'main', created_at: '2025-01-15T10:00:00Z', updated_at: '2025-01-15T10:00:00Z' });

export const DIFF = 'diff --git a/src/probe.ts b/src/probe.ts\n--- a/src/probe.ts\n+++ b/src/probe.ts\n@@ -1 +1 @@\n-old\n+new\n';

const pr = `${REPO}/pulls/7`;
const autoMerge = { number: 7, autoMergeRequest: { mergeMethod: 'SQUASH', enabledAt: '2025-01-15T10:00:00Z', enabledBy: { login: 'octo-dev' } } };

/** GraphQL answers, picked by the operation the query names. */
function graphql(body: string | undefined) {
  const query = (JSON.parse(body ?? '{}') as { query: string }).query;
  if (query.includes('enablePullRequestAutoMerge')) return { data: { enablePullRequestAutoMerge: { pullRequest: autoMerge } } };
  if (query.includes('disablePullRequestAutoMerge')) return { data: { disablePullRequestAutoMerge: { pullRequest: { number: 7, autoMergeRequest: null } } } };
  if (query.includes('addPullRequestToMergeQueue')) return { data: { addPullRequestToMergeQueue: { mergeQueue: { url: `${GHE}/imagile/toil-probe/queue/main` } } } };
  if (query.includes('convertPullRequestToDraft')) return { data: { convertPullRequestToDraft: { pullRequest: { number: 7, isDraft: true } } } };
  if (query.includes('markPullRequestReadyForReview')) return { data: { markPullRequestReadyForReview: { pullRequest: { number: 7, isDraft: false } } } };
  if (query.includes('resolveReviewThread')) return { data: { resolveReviewThread: { thread: { ...thread(), isResolved: true } } } };
  if (query.includes('projectsV2(')) return { data: { repositoryOwner: { projectsV2: { pageInfo: lastPage, nodes: [project()] } } } };
  if (query.includes('fields(first')) return { data: { repositoryOwner: { projectV2: { fields: { pageInfo: lastPage, nodes: [{ __typename: 'ProjectV2Field', id: 'PVTF_abc12345', name: 'Estimate', dataType: 'NUMBER' }, projectField(), iterationField()] } } } } };
  if (query.includes('items(first')) return { data: { repositoryOwner: { projectV2: { items: { pageInfo: lastPage, nodes: [projectItem()] } } } } };
  if (query.includes('reviewThreads')) return { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [thread()] } } } } };
  return { data: { repository: { pullRequest: prStatusNode() } } };
}

export const prStatusNode = (nodes: unknown[] = [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' }]) => ({
  number: 7,
  title: 'Add the probe',
  state: 'OPEN',
  isDraft: false,
  merged: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  autoMergeRequest: null,
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] },
});

const routes: Route[] = [
  // check-dossier's lookups: the owner, and the repository under it.
  { path: '/api/v3/users/imagile', respond: { json: { login: 'imagile', id: 9, type: 'Organization' } } },
  { path: REPO, respond: { json: repository() } },
  { method: 'POST', path: '/api/v3/user/repos', respond: { status: 201, json: repository() } },
  { method: 'POST', path: '/api/v3/orgs/imagile/repos', respond: { status: 201, json: repository() } },
  { method: 'POST', path: `${REPO}/issues`, respond: { status: 201, json: issue() } },
  // The issues endpoint answers with pull requests mixed in; list-issues drops them.
  { path: `${REPO}/issues`, respond: { json: [issue(9), prAsIssue(7)] } },
  { path: `${REPO}/issues/9`, respond: { json: issue(9) } },
  { path: `${REPO}/issues/10`, respond: { json: issue(10) } },
  { path: `${REPO}/issues/9/sub_issues`, respond: { json: [issue(10)] } },
  { path: `${REPO}/issues/10/sub_issues`, respond: { json: [] } },
  { path: `${REPO}/issues/9/timeline`, respond: { json: [timelineEvent('labeled'), timelineEvent('closed', 602)] } },
  { path: '/api/v3/search/issues', respond: { json: { total_count: 1, incomplete_results: false, items: [issue(9)] } } },
  { path: `${REPO}/pulls`, respond: { json: [pullRequest(7), pullRequest(8, { user: user('someone-else', 4), created_at: '2024-12-01T00:00:00Z' })] } },
  { method: 'POST', path: `${REPO}/pulls`, respond: { status: 201, json: pullRequest(7) } },
  { method: 'PATCH', path: pr, respond: { json: pullRequest(7) } },
  { method: 'PUT', path: `${pr}/merge`, respond: { json: { sha: 'abc1234', merged: true, message: 'Pull Request successfully merged' } } },
  // GET /pulls/7 answers both get-pr (JSON) and diff (the diff media type).
  { path: pr, respond: (request) => (request.headers.accept === 'application/vnd.github.v3.diff' ? { text: DIFF } : { json: pullRequest(7) }) },
  { path: `${pr}/files`, respond: { json: [file()] } },
  { path: `${REPO}/issues/7/comments`, respond: { json: [comment()] } },
  { method: 'POST', path: `${REPO}/issues/7/comments`, respond: { status: 201, json: comment() } },
  { path: `${pr}/comments`, respond: { json: [comment(501)] } },
  { method: 'POST', path: `${pr}/comments`, respond: { status: 201, json: comment(502) } },
  { method: 'POST', path: `${pr}/comments/501/replies`, respond: { status: 201, json: comment(503) } },
  { method: 'DELETE', path: `${REPO}/issues/comments/401`, respond: { status: 204 } },
  { method: 'DELETE', path: `${REPO}/pulls/comments/501`, respond: { status: 204 } },
  { path: `${pr}/reviews`, respond: { json: [review()] } },
  { method: 'POST', path: `${pr}/reviews`, respond: (request) => ({ json: review(request.body?.includes('REQUEST_CHANGES') ? 'CHANGES_REQUESTED' : 'APPROVED') }) },
  { path: `${pr}/requested_reviewers`, respond: { json: { users: [user('octo-rev', 3)], teams: [] } } },
  // GitHub answers a reviewer request with the pull request itself.
  { method: 'POST', path: `${pr}/requested_reviewers`, respond: { status: 201, json: pullRequest(7) } },
  { method: 'DELETE', path: `${pr}/requested_reviewers`, respond: { json: pullRequest(7) } },
  { path: `${REPO}/commits/main/status`, respond: { json: { state: 'success', sha: 'abc1234', total_count: 1, statuses: [{ context: 'ci/legacy', state: 'success', created_at: '2025-01-15T10:00:00Z', updated_at: '2025-01-15T10:00:00Z' }] } } },
  { path: `${REPO}/commits/abc1234/check-runs`, respond: { json: { total_count: 1, check_runs: [checkRun()] } } },
  // GitHub answers with the issue's labels as a bare array.
  { method: 'POST', path: `${REPO}/issues/7/labels`, respond: { json: [label('bug'), label('needs-review', 2)] } },
  { method: 'DELETE', path: `${REPO}/issues/7/labels/needs%20review`, respond: { json: [label('bug')] } },
  { method: 'POST', path: `${REPO}/issues/7/assignees`, respond: { status: 201, json: issue(7) } },
  { method: 'DELETE', path: `${REPO}/issues/7/assignees`, respond: { json: issue(7) } },
  { method: 'POST', path: '/api/graphql', respond: (request) => ({ json: graphql(request.body) }) },
];

export const fixture = defineFixture({
  area: 'github',
  routes,
  config: { github: { baseUrl: API, token: 'test-token', writes: true } },
  files: { 'pr-body.md': 'Body from a file.\n', 'issue-body.md': 'Issue body from a file.\n' },
  // For check-dossier: per repo, and no example's folder is that repo, so no other example reads it.
  dossier: { name: 'payments', github: { owner: { 'toil-probe': 'imagile' }, repo: { 'toil-probe': 'toil-probe' } } },
});
