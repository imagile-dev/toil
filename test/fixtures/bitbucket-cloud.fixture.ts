import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Bitbucket Cloud responses for every request the bitbucket-cloud
 * examples send, so the parity suite runs every command offline through both
 * front doors.
 *
 * Provenance: every shape here is invented from Atlassian's documented
 * Bitbucket Cloud REST API 2.0 (the OpenAPI spec behind
 * developer.atlassian.com/cloud/bitbucket/rest), trimmed to the fields that
 * matter. None was captured from a live workspace. Lists are wrapped in
 * `{ pagelen, page, size, values, next }`; this fixture serves at most two
 * items a page whatever `pagelen` asks for, which a server may do, so every
 * list with more than two items follows a `next` link. The real links are
 * opaque; these ones just add `page`.
 */

export const API = 'https://bitbucket-cloud.imagile.dev/2.0';
export const REPO = '/2.0/repositories/imagile/toil';
export const HASH = 'abc12345def67890abc12345def67890abc12345';
export const BASE_HASH = 'def67890abc12345def67890abc12345def67890';
export const ACCOUNT = '557058:abc12345-0000-0000-0000-000000000000';
export const PIPELINE = '{abc12345-0000-0000-0000-000000000000}';
export const STEP = '{abc12345-0000-0000-0000-000000000001}';

const json = (body: unknown, status = 200) => ({ status, json: body });
const link = (path: string) => ({ href: `${API}${path}` });

export const account = (name = 'Jo Doe') => ({ type: 'user', display_name: name, uuid: '{abc12345-0000-0000-0000-00000000000a}', account_id: ACCOUNT, nickname: 'jdoe' });

/** A page of `all` as Bitbucket Cloud wraps one, with a `next` link carrying the request's own query and the next page number. */
export function paged<T>(all: readonly T[], req: RecordedRequest) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? 1);
  const size = Math.min(Number(url.searchParams.get('pagelen') ?? 10), 2);
  const values = all.slice((page - 1) * size, page * size);
  const next = new URL(url);
  next.searchParams.set('page', String(page + 1));
  return json({ pagelen: size, page, size: all.length, values, ...(page * size < all.length ? { next: next.toString() } : {}) });
}

// Invented from the docs: a repository as GET /repositories/{workspace}/{repo_slug} returns it.
export const repository = (slug = 'toil') => ({
  type: 'repository',
  full_name: `imagile/${slug}`,
  name: slug,
  slug,
  is_private: true,
  scm: 'git',
  description: '',
  project: { type: 'project', key: 'TOIL', name: 'toil' },
  mainbranch: { type: 'branch', name: 'main' },
  links: { self: link(`/repositories/imagile/${slug}`), html: { href: `https://bitbucket-cloud.imagile.dev/imagile/${slug}` } },
});

export const commit = (hash = HASH, message = 'Add retries\n') => ({
  type: 'commit',
  hash,
  date: '2026-10-01T09:00:00+00:00',
  author: { type: 'author', raw: 'Jo Doe <you@example.com>', user: account() },
  message,
  parents: [{ type: 'commit', hash: BASE_HASH }],
  links: { self: link(`/repositories/imagile/toil/commit/${hash}`) },
});

const ref = (type: 'branch' | 'tag', name: string) => ({ type, name, target: commit(), links: { self: link(`/repositories/imagile/toil/refs/${type}es/${name}`) } });

export const pullRequest = (id = 42, state = 'OPEN') => ({
  type: 'pullrequest',
  id,
  title: 'Add retries',
  description: 'Retries with backoff.',
  state,
  author: account(),
  source: { branch: { name: 'feature/retries' }, commit: { type: 'commit', hash: HASH.slice(0, 12) }, repository: { full_name: 'imagile/toil' } },
  destination: { branch: { name: 'main' }, commit: { type: 'commit', hash: BASE_HASH.slice(0, 12) }, repository: { full_name: 'imagile/toil' } },
  reviewers: [account('Sam Reviewer')],
  participants: [
    { type: 'participant', user: account(), role: 'PARTICIPANT', approved: false, state: null },
    { type: 'participant', user: account('Sam Reviewer'), role: 'REVIEWER', approved: true, state: 'approved' },
  ],
  close_source_branch: false,
  created_on: '2026-10-01T09:00:00+00:00',
  updated_on: '2026-10-02T09:00:00+00:00',
  links: { self: link(`/repositories/imagile/toil/pullrequests/${id}`) },
});

export const comments = [
  { type: 'pullrequest_comment', id: 1001, created_on: '2026-10-01T10:00:00+00:00', content: { raw: 'Why a fixed delay?', markup: 'markdown' }, user: account('Sam Reviewer'), deleted: false },
  { type: 'pullrequest_comment', id: 1002, created_on: '2026-10-01T11:00:00+00:00', content: { raw: 'Cap the backoff?', markup: 'markdown' }, user: account('Sam Reviewer'), deleted: false, inline: { path: 'src/retry.ts', from: null, to: 12 } },
  { type: 'pullrequest_comment', id: 1003, created_on: '2026-10-01T12:00:00+00:00', content: { raw: 'Now exponential.', markup: 'markdown' }, user: account(), deleted: false, parent: { id: 1001 } },
];

export const diffstat = [
  { type: 'diffstat', status: 'modified', lines_added: 10, lines_removed: 2, old: { path: 'src/retry.ts' }, new: { path: 'src/retry.ts' } },
  { type: 'diffstat', status: 'added', lines_added: 40, lines_removed: 0, old: null, new: { path: 'src/backoff.ts' } },
  { type: 'diffstat', status: 'removed', lines_added: 0, lines_removed: 7, old: { path: 'src/old.ts' }, new: null },
];

export const statuses = [{ type: 'commitstatus', key: 'ci', name: 'Build #7', state: 'SUCCESSFUL', url: 'https://jenkins.imagile.dev/job/toil/7/', description: 'Passed', created_on: '2026-10-01T09:10:00+00:00', updated_on: '2026-10-01T09:20:00+00:00' }];

export const pipeline = (n = 7) => ({
  type: 'pipeline',
  uuid: PIPELINE,
  build_number: n,
  state: { type: 'pipeline_state_completed', name: 'COMPLETED', result: { type: 'pipeline_state_completed_successful', name: 'SUCCESSFUL' } },
  target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 'main', commit: { type: 'commit', hash: HASH } },
  trigger: { type: 'pipeline_trigger_push', name: 'PUSH' },
  creator: account(),
  created_on: '2026-10-01T09:00:00+00:00',
  completed_on: '2026-10-01T09:05:00+00:00',
  build_seconds_used: 300,
});

export const steps = [
  { type: 'pipeline_step', uuid: STEP, name: 'Build and test', state: { type: 'pipeline_step_state_completed', name: 'COMPLETED', result: { type: 'pipeline_step_state_completed_successful', name: 'SUCCESSFUL' } }, started_on: '2026-10-01T09:00:10+00:00', completed_on: '2026-10-01T09:04:50+00:00' },
];

export const LOG = '+ npm ci\nadded 354 packages\n+ npm test\nTests 1 passed (1)\n';
export const DIFF = 'diff --git a/src/retry.ts b/src/retry.ts\n--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -1,3 +1,3 @@\n-const DELAY = 1000;\n+const DELAY = backoff(attempt);\n';

const repos = [repository('toil'), repository('toil-site'), repository('scratch')];
const branches = [ref('branch', 'main'), ref('branch', 'feature/retries'), ref('branch', 'release/1.2')];
const tags = [ref('tag', 'v1.1.0'), ref('tag', 'v1.2.0')];
const commits = [commit(), commit(BASE_HASH, 'Initial commit\n'), commit('0123456789abcdef0123456789abcdef01234567', 'Older\n')];
const src = (path: string) => [
  { type: 'commit_file', path: `${path}README.md`, size: 120, commit: { hash: HASH } },
  { type: 'commit_directory', path: `${path}src`, commit: { hash: HASH } },
  { type: 'commit_file', path: `${path}package.json`, size: 900, commit: { hash: HASH } },
];

const SPEC = `${HASH.slice(0, 12)}..${BASE_HASH.slice(0, 12)}`;

export const routes: Route[] = [
  // Repositories
  { method: 'GET', path: '/2.0/repositories/imagile', respond: (req) => paged(repos, req) },
  { method: 'GET', path: REPO, respond: json(repository()) },
  { method: 'POST', path: '/2.0/repositories/imagile/scratch', respond: json(repository('scratch')) },
  { method: 'GET', path: `${REPO}/refs/branches`, respond: (req) => paged(branches, req) },
  { method: 'POST', path: `${REPO}/refs/branches`, respond: json(ref('branch', 'feature/retries'), 201) },
  { method: 'GET', path: `${REPO}/refs/tags`, respond: (req) => paged(tags, req) },
  { method: 'POST', path: `${REPO}/refs/tags`, respond: json(ref('tag', 'v1.2.0'), 201) },
  { method: 'GET', path: `${REPO}/commits`, respond: (req) => paged(commits, req) },
  { method: 'GET', path: `${REPO}/commit/${HASH}`, respond: json(commit()) },
  { method: 'GET', path: `${REPO}/src/${HASH}/README.md`, respond: { text: '# toil\n', headers: { 'content-type': 'text/markdown' } } },
  { method: 'GET', path: `${REPO}/src/${HASH}/src/retry.ts`, respond: { text: 'export const DELAY = 1000;\n', headers: { 'content-type': 'text/x-typescript' } } },
  { method: 'GET', path: `${REPO}/src/${HASH}/`, respond: (req) => paged(src(''), req) },
  { method: 'GET', path: `${REPO}/src/${HASH}/src/`, respond: (req) => paged(src('src/'), req) },
  // Pull requests
  { method: 'GET', path: `${REPO}/pullrequests`, respond: (req) => paged([pullRequest(42), pullRequest(41), pullRequest(40)], req) },
  { method: 'POST', path: `${REPO}/pullrequests`, respond: json(pullRequest(44), 201) },
  { method: 'GET', path: /^\/2\.0\/repositories\/imagile\/toil\/pullrequests\/(42|43)$/, respond: (req) => json(pullRequest(Number(req.url.split('/').pop()))) },
  { method: 'PUT', path: `${REPO}/pullrequests/42`, respond: json(pullRequest(42)) },
  { method: 'POST', path: `${REPO}/pullrequests/42/merge`, respond: json(pullRequest(42, 'MERGED')) },
  // A merge queue: 202 with the task-status link to poll.
  { method: 'POST', path: `${REPO}/pullrequests/43/merge`, respond: { status: 202, headers: { location: `${API}/repositories/imagile/toil/pullrequests/43/merge/task-status/abc12345` } } },
  { method: 'POST', path: `${REPO}/pullrequests/42/decline`, respond: json(pullRequest(42, 'DECLINED')) },
  { method: 'GET', path: `${REPO}/diff/${SPEC}`, respond: { text: DIFF, headers: { 'content-type': 'text/plain' } } },
  { method: 'GET', path: `${REPO}/diff/${HASH}`, respond: { text: DIFF, headers: { 'content-type': 'text/plain' } } },
  { method: 'GET', path: `${REPO}/diffstat/${SPEC}`, respond: (req) => paged(diffstat, req) },
  { method: 'POST', path: `${REPO}/pullrequests/42/approve`, respond: json({ type: 'participant', user: account(), role: 'REVIEWER', approved: true, state: 'approved' }) },
  { method: 'DELETE', path: `${REPO}/pullrequests/42/approve`, respond: { status: 204 } },
  { method: 'POST', path: `${REPO}/pullrequests/42/request-changes`, respond: json({ type: 'participant', user: account(), role: 'REVIEWER', approved: false, state: 'changes_requested' }) },
  { method: 'GET', path: `${REPO}/default-reviewers`, respond: (req) => paged([account('Sam Reviewer')], req) },
  { method: 'GET', path: `${REPO}/pullrequests/42/statuses`, respond: (req) => paged(statuses, req) },
  { method: 'GET', path: `${REPO}/commit/${HASH}/statuses`, respond: (req) => paged(statuses, req) },
  // Comments
  { method: 'GET', path: `${REPO}/pullrequests/42/comments`, respond: (req) => paged(comments, req) },
  { method: 'POST', path: `${REPO}/pullrequests/42/comments`, respond: json({ ...comments[0], id: 1004 }, 201) },
  { method: 'POST', path: `${REPO}/pullrequests/42/comments/1001/resolve`, respond: json({ type: 'comment_resolution', user: account(), created_on: '2026-10-02T09:00:00+00:00' }) },
  { method: 'DELETE', path: `${REPO}/pullrequests/42/comments/1002`, respond: { status: 204 } },
  // Pipelines
  { method: 'GET', path: `${REPO}/pipelines`, respond: (req) => paged([pipeline(7), pipeline(6), pipeline(5)], req) },
  { method: 'GET', path: `${REPO}/pipelines/%7Babc12345-0000-0000-0000-000000000000%7D`, respond: json(pipeline()) },
  { method: 'GET', path: `${REPO}/pipelines/%7Babc12345-0000-0000-0000-000000000000%7D/steps`, respond: (req) => paged(steps, req) },
  { method: 'GET', path: `${REPO}/pipelines/%7Babc12345-0000-0000-0000-000000000000%7D/steps/%7Babc12345-0000-0000-0000-000000000001%7D/log`, respond: { text: LOG, headers: { 'content-type': 'application/octet-stream' } } },
];

export const config = { 'bitbucket-cloud': { baseUrl: API, email: 'you@example.com', apiToken: 'test-token', writes: true } };

export const repo = { root: 'C:/work/toil', branch: 'feature/retries', remotes: ['https://bitbucket.org/imagile/toil.git'] };

export const files = { 'comment.json': '{"content":{"raw":"Looks good."}}' };

export const fixture = defineFixture({ area: 'bitbucket-cloud', routes, config, repo, files });
