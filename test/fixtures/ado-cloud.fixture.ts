import type { RecordedRequest, Route } from '../harness/fake-fetch.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned Azure DevOps Services responses for every request the ado-cloud
 * examples send, so the parity suite runs every command offline through both
 * front doors.
 *
 * Provenance: every shape here is invented from Microsoft's Azure DevOps
 * Services REST API 7.1 reference
 * (https://learn.microsoft.com/en-us/rest/api/azure/devops/?view=azure-devops-rest-7.1),
 * trimmed to the fields that matter; none was captured from a live
 * organization. The organization URL is a placeholder host with the
 * organization `imagile` as its first path segment, as on dev.azure.com.
 * Paged lists answer by whether the request carries a continuation token or
 * a `$skip` past the first page. An organization that exists only on paper
 * is, for once, exactly what the paperwork calls for.
 */

export const ORG_URL = 'https://ado-cloud.imagile.dev/imagile';
const HOST = 'https://ado-cloud.imagile.dev';
export const ORG = '/imagile';
export const PROJ = `${ORG}/Imagile`;
export const REPO = `${PROJ}/_apis/git/repositories/imagile-api`;
export const SHA = 'abc12345def67890abc12345def67890abc12345';
export const ME = 'abc12345-0000-0000-0000-00000000000a';

export const config = { 'ado-cloud': { baseUrl: ORG_URL, pat: 'test-pat', writes: true } };

/** An identity as Services returns one: an Entra (aad.) descriptor, the user's email as uniqueName, and links on vssps. */
export const identity = (id: string, name: string) => ({
  displayName: name,
  url: `https://vssps.ado-cloud.imagile.dev/imagile/_apis/Identities/${id}`,
  id,
  uniqueName: 'you@example.com',
  imageUrl: `${ORG_URL}/_api/_common/identityImage?id=${id}`,
  descriptor: 'aad.YWJjMTIzNDUtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDBh',
});

// Invented from the docs' pattern for the undocumented GET {organization}/_apis/connectionData.
export const connectionData = {
  authenticatedUser: { id: ME, descriptor: `Microsoft.IdentityModel.Claims.ClaimsIdentity;abc12345-0000-0000-0000-000000000000\\you@example.com`, providerDisplayName: 'Jane Doe', isActive: true, properties: {} },
  authorizedUser: { id: ME, descriptor: `Microsoft.IdentityModel.Claims.ClaimsIdentity;abc12345-0000-0000-0000-000000000000\\you@example.com`, providerDisplayName: 'Jane Doe', isActive: true, properties: {} },
  instanceId: 'abc12345-0000-0000-0000-000000000001',
  deploymentId: 'abc12345-0000-0000-0000-000000000002',
  deploymentType: 'hosted',
  locationServiceData: { serviceOwner: '00025394-6065-48ca-87d9-7f5672854ef7', defaultAccessMappingMoniker: 'PublicAccessMapping' },
};

// Invented from Projects - List / Get.
export const project = (name: string) => ({ id: `abc12345-0000-0000-0000-0000000000${name.length}0`, name, description: 'Team project', url: `${ORG_URL}/_apis/projects/abc12345-0000-0000-0000-0000000000${name.length}0`, state: 'wellFormed', revision: 41, visibility: 'private', lastUpdateTime: '2026-09-01T12:00:00Z' });

// Invented from Work Items - Get Work Item with $expand=all.
export const workItem = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  rev: 3,
  fields: {
    'System.AreaPath': 'Imagile',
    'System.TeamProject': 'Imagile',
    'System.IterationPath': 'Imagile\\Sprint 1',
    'System.WorkItemType': 'Bug',
    'System.State': 'Active',
    'System.Title': `Item ${id}`,
    'System.AssignedTo': identity(ME, 'Jane Doe'),
    'System.CreatedDate': '2026-09-01T12:00:00Z',
    'System.ChangedDate': '2026-10-02T12:00:00Z',
    'Microsoft.VSTS.Common.Priority': 2,
    'System.Tags': 'ui; backend',
  },
  relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${ORG_URL}/_apis/wit/workItems/7`, attributes: { isLocked: false, name: 'Parent' } }],
  _links: { self: { href: `${ORG_URL}/_apis/wit/workItems/${id}` } },
  url: `${ORG_URL}/_apis/wit/workItems/${id}`,
  ...extra,
});

// Invented from Revisions - List: the whole item as of each revision.
const revision = (rev: number, state: string) => ({
  id: 42,
  rev,
  fields: { 'System.WorkItemType': 'Bug', 'System.State': state, 'System.Title': 'Item 42', 'System.ChangedDate': `2026-09-0${rev}T12:00:00Z`, 'System.ChangedBy': identity(ME, 'Jane Doe') },
  url: `${ORG_URL}/_apis/wit/workItems/42/revisions/${rev}`,
});

// Invented from Comments - Get Comments (7.1-preview.4).
export const comment = (id: number) => ({ workItemId: 42, id, version: 1, text: `Comment ${id}`, createdBy: identity(ME, 'Jane Doe'), createdDate: `2026-09-0${id}T12:00:00Z`, modifiedBy: identity(ME, 'Jane Doe'), modifiedDate: `2026-09-0${id}T12:00:00Z`, isDeleted: false, url: `${ORG_URL}/abc12345-0000-0000-0000-000000000070/_apis/wit/workItems/42/comments/${id}` });

const iterations = {
  id: 1,
  identifier: 'abc12345-0000-0000-0000-000000000101',
  name: 'Imagile',
  structureType: 'iteration',
  hasChildren: true,
  path: '\\Imagile\\Iteration',
  children: [{ id: 2, identifier: 'abc12345-0000-0000-0000-000000000102', name: 'Sprint 1', structureType: 'iteration', hasChildren: false, path: '\\Imagile\\Iteration\\Sprint 1', attributes: { startDate: '2026-10-01T00:00:00Z', finishDate: '2026-10-14T00:00:00Z' } }],
  url: `${ORG_URL}/Imagile/_apis/wit/classificationNodes/Iterations`,
};

export const repo = { id: 'abc12345-0000-0000-0000-000000000003', name: 'imagile-api', url: `${ORG_URL}/Imagile/_apis/git/repositories/abc12345-0000-0000-0000-000000000003`, project: project('Imagile'), defaultBranch: 'refs/heads/main', remoteUrl: `${HOST}/imagile/Imagile/_git/imagile-api`, size: 1024, isDisabled: false };

// Invented from Pull Requests - Get Pull Request.
export const pr = (id: number, extra: Record<string, unknown> = {}) => ({
  repository: { id: repo.id, name: repo.name, project: project('Imagile') },
  pullRequestId: id,
  codeReviewId: id,
  status: 'active',
  createdBy: identity(ME, 'Jane Doe'),
  creationDate: '2026-09-15T12:00:00Z',
  title: `Change ${id}`,
  description: 'What and why',
  sourceRefName: 'refs/heads/feature/retries',
  targetRefName: 'refs/heads/main',
  mergeStatus: 'succeeded',
  isDraft: false,
  mergeId: 'abc12345-0000-0000-0000-000000000006',
  lastMergeSourceCommit: { commitId: SHA },
  lastMergeTargetCommit: { commitId: 'def67890abc12345def67890abc12345def67890' },
  reviewers: [{ ...identity('abc12345-0000-0000-0000-00000000000b', 'Sam Smith'), reviewerUrl: `${ORG_URL}${REPO.slice(ORG.length)}/pullRequests/${id}/reviewers/abc12345-0000-0000-0000-00000000000b`, vote: 10, isRequired: true }],
  url: `${ORG_URL}/Imagile/_apis/git/repositories/${repo.id}/pullRequests/${id}`,
  supportsIterations: true,
  ...extra,
});

const threadComment = (id: number, minute: number, extra: Record<string, unknown> = {}) => ({
  id,
  parentCommentId: 0,
  author: identity(ME, 'Jane Doe'),
  content: `Comment ${id}`,
  publishedDate: `2026-09-16T12:${String(minute).padStart(2, '0')}:00Z`,
  lastUpdatedDate: `2026-09-16T12:${String(minute).padStart(2, '0')}:00Z`,
  commentType: 'text',
  ...extra,
});

// Invented from Pull Request Threads - List.
export const thread = (id: number, comments: unknown[], extra: Record<string, unknown> = {}) => ({ id, publishedDate: '2026-09-16T12:00:00Z', lastUpdatedDate: '2026-09-16T12:30:00Z', comments, status: 'active', isDeleted: false, ...extra });

export const threads = [
  thread(7, [threadComment(1, 5), threadComment(2, 1, { isDeleted: true })]),
  thread(8, [threadComment(3, 2)], { threadContext: { filePath: '/src/app.ts', rightFileStart: { line: 12, offset: 1 }, rightFileEnd: { line: 12, offset: 1 } } }),
  thread(9, [threadComment(4, 0)], { isDeleted: true }),
  thread(10, [threadComment(5, 3, { content: 'Jane Doe voted 10', commentType: 'system' })], { status: 'unknown' }),
];

const hasQuery = (r: RecordedRequest, key: string) => new URL(r.url).searchParams.has(key);

/** A list paged by the x-ms-continuationtoken header: page one names a token, page two has none. */
const continued = (first: unknown[], second: unknown[]) => (r: RecordedRequest) =>
  hasQuery(r, 'continuationToken') ? { json: { count: second.length, value: second } } : { json: { count: first.length, value: first }, headers: { 'x-ms-continuationtoken': 'abc12345' } };

/** A list paged by $top and $skip: the first page holds `first`, any later page is empty. */
const skipped = (first: unknown[]) => (r: RecordedRequest) => ({ json: new URL(r.url).searchParams.get('$skip') === '0' ? { count: first.length, value: first } : { count: 0, value: [] } });

export const routes: Route[] = [
  { path: `${ORG}/_apis/connectionData`, respond: { json: connectionData } },
  { path: `${ORG}/_apis/projects`, respond: continued([project('Imagile')], [project('Imagile Ops')]) },
  { path: `${ORG}/_apis/projects/Imagile`, respond: { json: project('Imagile') } },
  { path: `${PROJ}/_apis/git/repositories`, respond: { json: { count: 1, value: [repo] } } },
  { path: REPO, respond: { json: repo } },

  // Work items
  { path: /^\/imagile\/_apis\/wit\/workitems\/\d+$/, respond: (r) => ({ json: workItem(Number(new URL(r.url).pathname.split('/').pop())) }) },
  { method: 'PATCH', path: /^\/imagile\/_apis\/wit\/workitems\/\d+$/, respond: { json: workItem(42, { rev: 4 }) } },
  { method: 'POST', path: /^\/imagile\/Imagile\/_apis\/wit\/workitems\/%24/, respond: { json: workItem(43, { rev: 1 }) } },
  {
    method: 'POST',
    path: `${PROJ}/_apis/wit/wiql`,
    respond: { json: { queryType: 'flat', queryResultType: 'workItem', asOf: '2026-10-17T12:00:00Z', columns: [{ referenceName: 'System.Id', name: 'ID', url: `${ORG_URL}/_apis/wit/fields/System.Id` }], workItems: [42, 7].map((id) => ({ id, url: `${ORG_URL}/_apis/wit/workItems/${id}` })) } },
  },
  { path: `${ORG}/_apis/wit/workItems/42/revisions`, respond: skipped([revision(1, 'New'), revision(2, 'Active')]) },
  // With errorPolicy omit, an id that doesn't exist (404 here) comes back as null, in place.
  {
    method: 'POST',
    path: `${ORG}/_apis/wit/workitemsbatch`,
    respond: (r) => {
      const ids = (JSON.parse(r.body ?? '{}') as { ids: number[] }).ids;
      const value = ids.map((id) => (id === 404 ? null : workItem(id)));
      return { json: { count: value.length, value } };
    },
  },
  // Comments page by a continuationToken in the body; the second page has none.
  {
    path: `${PROJ}/_apis/wit/workItems/42/comments`,
    respond: (r) =>
      hasQuery(r, 'continuationToken')
        ? { json: { totalCount: 3, count: 1, comments: [comment(1)] } }
        : { json: { totalCount: 3, count: 2, comments: [comment(3), comment(2)], continuationToken: 'abc12345', nextPage: `${ORG_URL}/Imagile/_apis/wit/workItems/42/comments?continuationToken=abc12345` } },
  },
  { method: 'POST', path: `${PROJ}/_apis/wit/workItems/42/comments`, respond: { json: comment(4) } },
  { path: `${PROJ}/_apis/wit/classificationnodes/iterations`, respond: { json: iterations } },
  // The passthrough's second read.
  { path: `${PROJ}/_apis/wit/workitemtypes`, respond: { json: { count: 1, value: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', states: [{ name: 'New' }, { name: 'Active' }] }] } } },

  // Pull requests
  { path: `${REPO}/pullrequests`, respond: skipped([pr(42)]) },
  { path: `${REPO}/pullrequests/42`, respond: { json: pr(42) } },
  { method: 'POST', path: `${REPO}/pullrequests`, respond: { json: pr(44) } },
  { method: 'PATCH', path: `${REPO}/pullrequests/42`, respond: (r) => ({ json: pr(42, JSON.parse(r.body ?? '{}') as Record<string, unknown>) }) },
  { path: `${REPO}/pullrequests/42/reviewers`, respond: { json: { count: 1, value: pr(42).reviewers } } },
  { method: 'PUT', path: `${REPO}/pullrequests/42/reviewers/${ME}`, respond: (r) => ({ json: { ...identity(ME, 'Jane Doe'), vote: (JSON.parse(r.body ?? '{}') as { vote: number }).vote } }) },
  { path: `${REPO}/pullrequests/42/threads`, respond: { json: { count: threads.length, value: threads } } },
  { method: 'POST', path: `${REPO}/pullrequests/42/threads`, respond: { json: thread(11, [threadComment(6, 9)]) } },
  { method: 'POST', path: `${REPO}/pullrequests/42/threads/7/comments`, respond: { json: threadComment(7, 10, { parentCommentId: 1 }) } },
  { method: 'PATCH', path: `${REPO}/pullrequests/42/threads/7`, respond: (r) => ({ json: thread(7, [threadComment(1, 5)], JSON.parse(r.body ?? '{}') as Record<string, unknown>) }) },
];

export const files = { 'patch.json': '[{"op":"add","path":"/fields/System.Title","value":"From the passthrough"}]' };

export const fixture = defineFixture({ area: 'ado-cloud', routes, config, files });
