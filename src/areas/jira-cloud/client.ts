import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate, type Paged, type PageStyle } from '../../core/paginate.js';
import type { QueryParam } from '../../core/rest.js';
import { textToAdf, type AdfDocument } from './adf.js';
import { jiraCloudArea } from './area.js';

/**
 * Every request toil sends to Jira Cloud, each from Atlassian's REST API 3
 * reference (https://developer.atlassian.com/cloud/jira/platform/rest/v3/) or
 * the Agile REST API reference
 * (https://developer.atlassian.com/cloud/jira/software/rest/). Commands say
 * what they want; this module knows the endpoints, the paging and where the
 * Cloud API parts company with Data Center: accountIds for people, ADF for
 * rich text, and a token-paged JQL search with no total. The departure was
 * announced in a changelog, which is the closest thing to consent on record.
 */

export type JiraCloudConnection = Connection<z.output<typeof jiraCloudArea.connection>>;
export type JiraCloudContext = CommandContext<JiraCloudConnection>;

const API = '/rest/api/3';
const AGILE_API = '/rest/agile/1.0';
/** Page size for startAt/maxResults lists. The Agile and project APIs cap at 50 or 100; toil follows whatever page the server returns. */
const PAGE = 50;
/** Issues per JQL search request; Jira may return fewer when many fields are asked for. */
const SEARCH_PAGE = 100;

export interface JiraCloudIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JiraCloudTransition {
  id: string;
  name: string;
  to?: { name: string };
}

export interface JiraCloudBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraCloudSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

/** A key or id as one path segment, encoded, so `PROJ-1/comment` can't change which endpoint is called. */
const seg = (value: string | number) => encodeURIComponent(String(value));

interface Request {
  method?: 'GET' | 'POST' | 'PUT';
  query?: Record<string, QueryParam>;
  body?: unknown;
}

export function jiraCloud<T>(ctx: JiraCloudContext, path: string, req: Request = {}): Promise<T> {
  return apiRequest<T>(jiraCloudArea, ctx, path, {
    method: req.method ?? 'GET',
    ...(req.query ? { query: req.query } : {}),
    ...(req.body !== undefined ? { json: req.body } : {}),
  });
}

/**
 * startAt/maxResults paging, for a list kept under `field`. It stops on an
 * empty page, when `isLast` is true (the Agile and project lists), or once
 * `total` is reached (comments), and never on a short page, since Jira may
 * return fewer than asked for.
 */
function offsetPages<T>(field: string): PageStyle<T> {
  return {
    kind: 'offset',
    startParam: 'startAt',
    limitParam: 'maxResults',
    pageSize: PAGE,
    items: (body) => ((body as Record<string, T[] | undefined>)[field] ?? []),
    total: (body) => {
      const page = body as { isLast?: unknown; startAt?: unknown; total?: unknown } & Record<string, unknown>;
      const got = Array.isArray(page[field]) ? (page[field] as unknown[]).length : 0;
      if (page.isLast === true && typeof page.startAt === 'number') return page.startAt + got;
      return typeof page.total === 'number' ? page.total : undefined;
    },
  };
}

async function every<T>(what: string, field: string, fetchPage: (paging: Record<string, string | number>) => Promise<unknown>): Promise<T[]> {
  const { items } = await paginate<T>(offsetPages<T>(field), async (paging) => ({ body: await fetchPage(paging) }), { what });
  return items;
}

// GET /rest/api/3/issue/{issueIdOrKey}
export function getIssue(ctx: JiraCloudContext, key: string): Promise<JiraCloudIssue> {
  return jiraCloud<JiraCloudIssue>(ctx, `${API}/issue/${seg(key)}`);
}

export interface IssueFieldsInput {
  summary?: string | undefined;
  description?: string | undefined;
  priority?: string | undefined;
  assignee?: string | undefined;
  labels?: string[] | undefined;
}

/** The `fields` for a create or edit: only what was given, rich text as ADF, people by accountId. */
export function issueFields(opts: IssueFieldsInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (opts.summary) fields.summary = opts.summary;
  if (opts.description) fields.description = textToAdf(opts.description);
  if (opts.priority) fields.priority = { name: opts.priority };
  if (opts.assignee) fields.assignee = { accountId: opts.assignee };
  if (opts.labels?.length) fields.labels = opts.labels;
  return fields;
}

export interface CreateIssueOpts extends IssueFieldsInput {
  project: string;
  issueType: string;
  summary: string;
  parent?: string | undefined;
}

/** POST /rest/api/3/issue, then reads the issue back so the caller gets all of it, not just its key. */
export async function createIssue(ctx: JiraCloudContext, opts: CreateIssueOpts): Promise<JiraCloudIssue> {
  const fields = {
    project: { key: opts.project },
    issuetype: { name: opts.issueType },
    ...issueFields(opts),
    ...(opts.parent ? { parent: { key: opts.parent } } : {}),
  };
  const created = await jiraCloud<{ id: string; key: string }>(ctx, `${API}/issue`, { method: 'POST', body: { fields } });
  return getIssue(ctx, created.key);
}

// PUT /rest/api/3/issue/{issueIdOrKey}
export async function editIssue(ctx: JiraCloudContext, key: string, body: Record<string, unknown>): Promise<void> {
  await jiraCloud<void>(ctx, `${API}/issue/${seg(key)}`, { method: 'PUT', body });
}

// GET /rest/api/3/issue/{issueIdOrKey}/transitions
export async function listTransitions(ctx: JiraCloudContext, key: string): Promise<JiraCloudTransition[]> {
  const result = await jiraCloud<{ transitions?: JiraCloudTransition[] }>(ctx, `${API}/issue/${seg(key)}/transitions`);
  return result.transitions ?? [];
}

// POST /rest/api/3/issue/{issueIdOrKey}/transitions
export async function transitionIssue(ctx: JiraCloudContext, key: string, transitionId: string): Promise<void> {
  await jiraCloud<void>(ctx, `${API}/issue/${seg(key)}/transitions`, { method: 'POST', body: { transition: { id: transitionId } } });
}

// POST /rest/api/3/issue/{issueIdOrKey}/comment, with the body as ADF.
export function addComment(ctx: JiraCloudContext, key: string, body: AdfDocument): Promise<Record<string, unknown>> {
  return jiraCloud(ctx, `${API}/issue/${seg(key)}/comment`, { method: 'POST', body: { body } });
}

// GET /rest/api/3/issue/{issueIdOrKey}/comment, every page.
export function listComments(ctx: JiraCloudContext, key: string): Promise<Array<Record<string, unknown>>> {
  return every(`Jira Cloud comments for ${key}`, 'comments', (paging) => jiraCloud(ctx, `${API}/issue/${seg(key)}/comment`, { query: paging }));
}

// PUT /rest/api/3/issue/{issueIdOrKey}/assignee
export async function assignIssue(ctx: JiraCloudContext, key: string, accountId: string): Promise<void> {
  await jiraCloud<void>(ctx, `${API}/issue/${seg(key)}/assignee`, { method: 'PUT', body: { accountId } });
}

/** POST /rest/api/3/issueLink: `key` inward, `target` outward. A type name or either phrase resolves to its id from GET /rest/api/3/issueLinkType. */
export async function linkIssue(ctx: JiraCloudContext, opts: { key: string; linkType: string; target: string }): Promise<void> {
  let linkTypeId = opts.linkType;
  if (!/^\d+$/.test(opts.linkType)) {
    const types = await jiraCloud<{ issueLinkTypes?: Array<{ id: string; name: string; inward: string; outward: string }> }>(ctx, `${API}/issueLinkType`);
    const all = types.issueLinkTypes ?? [];
    const wanted = opts.linkType.toLowerCase();
    const found = all.find((t) => t.name.toLowerCase() === wanted || t.inward.toLowerCase() === wanted || t.outward.toLowerCase() === wanted);
    if (!found) {
      throw new ToilError('INVALID_INPUT', `Link type not found: ${opts.linkType}`, {
        fix: `Use one of: ${all.map((t) => t.name).join(', ') || '(Jira Cloud reported none)'}, or a link type id.`,
      });
    }
    linkTypeId = found.id;
  }
  await jiraCloud<void>(ctx, `${API}/issueLink`, {
    method: 'POST',
    body: { type: { id: linkTypeId }, inwardIssue: { key: opts.key }, outwardIssue: { key: opts.target } },
  });
}

export const STANDARD_SEARCH_FIELDS = ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter'];

/**
 * POST /rest/api/3/search/jql, the enhanced search that replaced
 * /rest/api/3/search (https://developer.atlassian.com/changelog/#CHANGE-2046).
 * It pages by `nextPageToken` and reports no total, so `cap` and `cursor` go
 * through core's token paging and meta.page carries where to resume.
 */
export function search(
  ctx: JiraCloudContext,
  jql: string,
  opts: { fields: string[]; cap?: number | undefined; cursor?: string | undefined },
): Promise<Paged<JiraCloudIssue>> {
  const maxResults = Math.min(SEARCH_PAGE, opts.cap ?? SEARCH_PAGE);
  return paginate<JiraCloudIssue>(
    { kind: 'nextPageKey', param: 'nextPageToken', key: (body) => (body as { nextPageToken?: string }).nextPageToken, items: (body) => (body as { issues?: JiraCloudIssue[] }).issues ?? [] },
    async (paging) => ({ body: await jiraCloud(ctx, `${API}/search/jql`, { method: 'POST', body: { jql, maxResults, fields: opts.fields, ...paging } }) }),
    { what: 'Jira Cloud search', ...(opts.cap !== undefined ? { cap: opts.cap, setPage: ctx.setPage } : {}), ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}) },
  );
}

// PUT /rest/api/3/issue/{issueIdOrKey} with label operations.
export async function changeLabels(ctx: JiraCloudContext, key: string, op: 'add' | 'remove', labels: string[]): Promise<void> {
  await editIssue(ctx, key, { update: { labels: labels.map((l) => ({ [op]: l })) } });
}

// GET /rest/api/3/project/search, every page.
export function listProjects(ctx: JiraCloudContext, query?: string): Promise<Array<Record<string, unknown>>> {
  return every('Jira Cloud projects', 'values', (paging) => jiraCloud(ctx, `${API}/project/search`, { query: { ...(query ? { query } : {}), ...paging } }));
}

// GET /rest/api/3/project/{projectIdOrKey}
export function getProject(ctx: JiraCloudContext, project: string): Promise<Record<string, unknown>> {
  return jiraCloud(ctx, `${API}/project/${seg(project)}`);
}

// GET /rest/api/3/user/search: one page, since the endpoint stops at the thousandth match anyway.
export function searchUsers(ctx: JiraCloudContext, query: string, maxResults: number): Promise<Array<Record<string, unknown>>> {
  return jiraCloud(ctx, `${API}/user/search`, { query: { query, maxResults } });
}

// GET /rest/agile/1.0/board?projectKeyOrId=, every page.
export function listBoards(ctx: JiraCloudContext, project: string): Promise<JiraCloudBoard[]> {
  return every(`Jira Cloud boards for project ${project}`, 'values', (paging) => jiraCloud(ctx, `${AGILE_API}/board`, { query: { projectKeyOrId: project, ...paging } }));
}

// GET /rest/agile/1.0/board/{boardId}/sprint, every page.
export function listSprintsForBoard(ctx: JiraCloudContext, boardId: number, states?: string[]): Promise<JiraCloudSprint[]> {
  return every(`Jira Cloud sprints for board ${boardId}`, 'values', (paging) =>
    jiraCloud(ctx, `${AGILE_API}/board/${seg(boardId)}/sprint`, { query: { ...paging, ...(states?.length ? { state: states.join(',') } : {}) } }),
  );
}

/** Sprints across a project's scrum boards, once each: a sprint can sit on several boards. Kanban boards have none. */
export async function listSprintsForProject(ctx: JiraCloudContext, project: string, states?: string[]): Promise<JiraCloudSprint[]> {
  const sprints: JiraCloudSprint[] = [];
  const seen = new Set<number>();
  for (const board of await listBoards(ctx, project)) {
    if (board.type !== 'scrum') continue;
    for (const sprint of await listSprintsForBoard(ctx, board.id, states)) {
      if (seen.has(sprint.id)) continue;
      seen.add(sprint.id);
      sprints.push(sprint);
    }
  }
  return sprints;
}

// POST /rest/agile/1.0/sprint/{sprintId}/issue
export async function setSprint(ctx: JiraCloudContext, sprintId: number, issueKeys: string[]): Promise<void> {
  await jiraCloud<void>(ctx, `${AGILE_API}/sprint/${seg(sprintId)}/issue`, { method: 'POST', body: { issues: issueKeys } });
}
