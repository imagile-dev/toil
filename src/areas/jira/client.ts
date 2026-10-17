import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { apiRequest } from '../../core/api.js';
import { ToilError } from '../../core/errors.js';
import { paginate, type PageStyle } from '../../core/paginate.js';
import { repointUrl, type QueryValue } from '../../core/rest.js';
import { jiraArea, type CustomFieldDefinition } from './area.js';
import { suggestedType } from './custom-fields.js';

/**
 * Every request toil sends to Jira Data Center. Commands describe what they
 * want; this module knows the endpoints, the headers, the paging and the odd
 * corners (createmeta moved in 8.4, attachments are fetched from a URL Jira
 * hands back). The paging loop, re-pointing and multipart are core's.
 * Requests are kept exactly as the canonical implementation sent them,
 * because those are the ones known to work against real servers.
 * Altering a request that works would need a change request, and nobody has
 * yet found the form.
 */

export type JiraConnection = Connection<z.output<typeof jiraArea.connection>>;
export type JiraContext = CommandContext<JiraConnection>;

const API = '/rest/api/2';
const AGILE_API = '/rest/agile/1.0';
const PAGE = 100;

export interface JiraUser {
  name: string;
  displayName: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: { name: string };
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  author?: JiraUser;
  created?: string;
  size?: number;
  mimeType?: string;
  content: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface AllowedValue {
  id: string;
  value?: string;
  name?: string;
  children?: Array<{ id: string; value: string }>;
}

export interface JiraFieldInfo {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type: string; custom?: string };
  allowedValues?: AllowedValue[];
  /** The `customFields` type that suits this field. */
  suggestedType?: CustomFieldDefinition['type'];
  /** The same value under the name the migration contract's output used. */
  pncliType?: CustomFieldDefinition['type'];
}

/**
 * A key or id in a URL path, unencoded, exactly as the predecessor sent it.
 * A key with `/` or `?` changes the path; recorded as a suspected bug (#70), not
 * changed (CLAUDE.md, Porting). Precedent outranks preference until a live
 * server rules otherwise.
 */
const seg = (value: string | number) => String(value);

/**
 * The predecessor's test for "an id, not a name": anything parseInt can read a
 * number from, so "2nd Review" counts as an id. Recorded as a suspected bug (#70).
 */
export const looksNumeric = (value: string) => !isNaN(parseInt(value, 10));

/** What every JSON call sends besides the hook's token, exactly as the predecessor sent it. */
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };

interface JiraRequest {
  method?: 'GET' | 'POST' | 'PUT';
  params?: Record<string, QueryValue>;
  body?: unknown;
}

export function jira<T>(ctx: JiraContext, path: string, req: JiraRequest = {}): Promise<T> {
  return apiRequest<T>(jiraArea, ctx, path, {
    method: req.method ?? 'GET',
    headers: JSON_HEADERS,
    ...(req.params ? { query: req.params } : {}),
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
}

/**
 * startAt/maxResults paging through core's loop, for a list kept under
 * `field`: it stops on an empty page or once `total` is reached, as the
 * predecessor did. `total` is read with Number(), which is how the
 * predecessor's `startAt >= total` coerced it, so a missing one never stops
 * the loop. An endpoint with no `total` (the Agile sprint list, which has
 * `isLast` instead) costs one extra empty-page request; recorded as a
 * suspected bug (#70).
 */
function offsetPages<T>(field: string): PageStyle<T> {
  return {
    kind: 'offset',
    startParam: 'startAt',
    limitParam: 'maxResults',
    pageSize: PAGE,
    // `issues` first, as the predecessor's shared loop read every list.
    items: (body) => {
      const page = body as Record<string, T[] | undefined>;
      return page.issues ?? page[field] ?? [];
    },
    total: (body) => Number((body as { total?: unknown }).total),
  };
}

/** Every item of a paged list; `what` names it if paging never ends. */
async function every<T>(what: string, field: string, fetchPage: (paging: Record<string, string | number>) => Promise<unknown>): Promise<T[]> {
  const { items } = await paginate<T>(offsetPages<T>(field), async (paging) => ({ body: await fetchPage(paging) }), { what });
  return items;
}

export function getIssue(ctx: JiraContext, key: string): Promise<JiraIssue> {
  return jira<JiraIssue>(ctx, `${API}/issue/${seg(key)}`);
}

export interface CreateIssueOpts {
  project: string;
  issueType: string;
  summary: string;
  description?: string | undefined;
  priority?: string | undefined;
  assignee?: string | undefined;
  labels?: string[] | undefined;
  parent?: string | undefined;
  customFieldValues?: Record<string, unknown>;
}

/** Creates the issue, then reads it back so the caller gets the whole issue, not just its key. */
export async function createIssue(ctx: JiraContext, opts: CreateIssueOpts): Promise<JiraIssue> {
  const fields: Record<string, unknown> = {
    project: { key: opts.project },
    issuetype: { name: opts.issueType },
    summary: opts.summary,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.priority ? { priority: { name: opts.priority } } : {}),
    ...(opts.assignee ? { assignee: { name: opts.assignee } } : {}),
    ...(opts.labels?.length ? { labels: opts.labels } : {}),
    ...(opts.parent ? { parent: { key: opts.parent } } : {}),
    ...(opts.customFieldValues ?? {}),
  };
  const created = await jira<{ id: string; key: string }>(ctx, `${API}/issue`, { method: 'POST', body: { fields } });
  return getIssue(ctx, created.key);
}

export interface UpdateIssueOpts {
  summary?: string | undefined;
  description?: string | undefined;
  priority?: string | undefined;
  assignee?: string | undefined;
  labels?: string[] | undefined;
  customFieldValues?: Record<string, unknown>;
}

/** The `fields` an update sends: only what was given. */
export function updateFields(opts: UpdateIssueOpts): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (opts.summary) fields.summary = opts.summary;
  if (opts.description) fields.description = opts.description;
  if (opts.priority) fields.priority = { name: opts.priority };
  if (opts.assignee) fields.assignee = { name: opts.assignee };
  if (opts.labels?.length) fields.labels = opts.labels;
  Object.assign(fields, opts.customFieldValues ?? {});
  return fields;
}

export async function updateIssue(ctx: JiraContext, key: string, fields: Record<string, unknown>): Promise<void> {
  await jira<void>(ctx, `${API}/issue/${seg(key)}`, { method: 'PUT', body: { fields } });
}

export async function listTransitions(ctx: JiraContext, key: string): Promise<JiraTransition[]> {
  const result = await jira<{ transitions: JiraTransition[] }>(ctx, `${API}/issue/${seg(key)}/transitions`);
  return result.transitions;
}

export async function transitionIssue(ctx: JiraContext, key: string, transitionId: string): Promise<void> {
  await jira<void>(ctx, `${API}/issue/${seg(key)}/transitions`, { method: 'POST', body: { transition: { id: transitionId } } });
}

export function addComment(ctx: JiraContext, key: string, text: string): Promise<unknown> {
  return jira<unknown>(ctx, `${API}/issue/${seg(key)}/comment`, { method: 'POST', body: { body: text } });
}

export function listComments(ctx: JiraContext, key: string): Promise<unknown[]> {
  return every(`Jira comments for ${key}`, 'comments', (paging) => jira(ctx, `${API}/issue/${seg(key)}/comment`, { params: paging }));
}

export function addWorklog(ctx: JiraContext, key: string, opts: { timeSpent: string; comment?: string | undefined; started?: string | undefined }): Promise<unknown> {
  return jira<unknown>(ctx, `${API}/issue/${seg(key)}/worklog`, {
    method: 'POST',
    body: {
      timeSpent: opts.timeSpent,
      ...(opts.comment ? { comment: opts.comment } : {}),
      ...(opts.started ? { started: opts.started } : {}),
    },
  });
}

export const STANDARD_SEARCH_FIELDS = ['summary', 'status', 'priority', 'assignee', 'issuetype', 'project', 'created', 'updated', 'labels', 'reporter'];

/**
 * Search from `startAt` in pages of up to 100 (one huge request times out),
 * stopping at `maxResults` when given. Keeps the server's `total` so the
 * caller can tell whether the result was cut short.
 *
 * Core's loop, with the two things the predecessor did that its cap doesn't:
 * the last page asks only for what's left (`[200, 50]`, not `[200, 100]`),
 * and a `maxResults` that parseInt couldn't read (NaN) goes out as null and
 * pages through everything rather than being refused. So the page size is
 * worked out here, and the cap is folded into the end offset `total` reports:
 * stopping at the server's total or at startAt + maxResults, whichever comes
 * first, is exactly the predecessor's two exit tests.
 */
export async function search(
  ctx: JiraContext,
  jql: string,
  opts: { maxResults?: number | undefined; startAt?: number | undefined; fields: string[] },
): Promise<JiraSearchResult> {
  const first = opts.startAt ?? 0;
  const max = opts.maxResults;
  const end = max === undefined || Number.isNaN(max) ? undefined : first + max;
  let total = 0;
  const { items } = await paginate<JiraIssue>(
    {
      kind: 'offset',
      startParam: 'startAt',
      limitParam: 'maxResults',
      pageSize: PAGE,
      first,
      items: (body) => (body as JiraSearchResult).issues ?? [],
      total: (body) => {
        const reported = Number((body as JiraSearchResult).total);
        if (end === undefined) return reported;
        return Number.isNaN(reported) ? end : Math.min(reported, end);
      },
    },
    async (params) => {
      const startAt = Number(params.startAt);
      const pageSize = max === undefined ? PAGE : Math.min(PAGE, max - (startAt - first));
      const page = await jira<JiraSearchResult>(ctx, `${API}/search`, { method: 'POST', body: { jql, startAt, maxResults: pageSize, fields: opts.fields } });
      // Every page's total, the empty last one included, as the predecessor kept it.
      total = page.total;
      return { body: page };
    },
    { what: 'Jira search' },
  );
  return { issues: items, total, startAt: first, maxResults: items.length };
}

export async function fetchFields(ctx: JiraContext): Promise<JiraFieldInfo[]> {
  const fields = await jira<JiraFieldInfo[]>(ctx, `${API}/field`);
  return fields.map((f) => {
    const type = suggestedType(f.schema);
    return type ? { ...f, suggestedType: type, pncliType: type } : f;
  });
}

type MetaFields = Record<string, { allowedValues?: AllowedValue[] }>;

/**
 * Fields with `allowedValues` for a project (and optionally one issue type),
 * from the classic createmeta endpoint, or the paginated one that replaced it
 * in Jira 8.4 where the classic one answers 404. When neither works, fields are
 * returned without allowed values and a warning says so.
 */
export async function fetchFieldsWithAllowedValues(ctx: JiraContext, project: string, issueType?: string): Promise<JiraFieldInfo[]> {
  const fields = await fetchFields(ctx);
  let meta: MetaFields = {};
  try {
    const classic = await jira<{ projects: Array<{ issuetypes: Array<{ name: string; fields: MetaFields }> }> }>(ctx, `${API}/issue/createmeta`, {
      params: { projectKeys: project, expand: 'projects.issuetypes.fields' },
    });
    meta = collectMetaFields(classic.projects, issueType);
  } catch (first) {
    if (ctx.signal.aborted) throw first;
    try {
      meta = await createMetaViaIssueTypes(ctx, project, issueType);
    } catch (second) {
      if (ctx.signal.aborted) throw second;
      ctx.warn({
        code: 'JIRA_NO_ALLOWED_VALUES',
        message: `Jira's createmeta endpoints both failed for project ${project}, so fields are listed without allowedValues: ${(second as Error).message}`,
      });
    }
  }
  return fields.map((f) => {
    const allowed = meta[f.id]?.allowedValues;
    return allowed?.length ? { ...f, allowedValues: allowed } : f;
  });
}

async function createMetaViaIssueTypes(ctx: JiraContext, project: string, issueType?: string): Promise<MetaFields> {
  const types = await jira<{ values: Array<{ id: string; name: string }> }>(ctx, `${API}/issue/createmeta/${seg(project)}/issuetypes`);
  const matching = issueType ? types.values.filter((t) => t.name.toLowerCase() === issueType.toLowerCase()) : types.values;
  const result: MetaFields = {};
  for (const type of matching) {
    const list = await jira<{ values: Array<{ fieldId: string; allowedValues?: AllowedValue[] }> }>(ctx, `${API}/issue/createmeta/${seg(project)}/issuetypes/${seg(type.id)}`);
    for (const field of list.values) mergeAllowed(result, field.fieldId, field.allowedValues);
  }
  return result;
}

function collectMetaFields(projects: Array<{ issuetypes: Array<{ name: string; fields: MetaFields }> }>, issueType?: string): MetaFields {
  const result: MetaFields = {};
  for (const project of projects) {
    for (const type of project.issuetypes) {
      if (issueType && type.name.toLowerCase() !== issueType.toLowerCase()) continue;
      for (const [fieldId, meta] of Object.entries(type.fields)) mergeAllowed(result, fieldId, meta.allowedValues);
    }
  }
  return result;
}

/** Adds allowed values to a field's list, once each by id, across issue types. */
function mergeAllowed(result: MetaFields, fieldId: string, allowed: AllowedValue[] | undefined): void {
  if (!allowed?.length) return;
  const existing = result[fieldId]?.allowedValues ?? [];
  const seen = new Set(existing.map((v) => v.id));
  for (const value of allowed) {
    if (seen.has(value.id)) continue;
    existing.push(value);
    seen.add(value.id);
  }
  result[fieldId] = { allowedValues: existing };
}

export async function addLabels(ctx: JiraContext, key: string, labels: string[]): Promise<void> {
  await jira<void>(ctx, `${API}/issue/${seg(key)}`, { method: 'PUT', body: { update: { labels: labels.map((l) => ({ add: l })) } } });
}

export async function removeLabels(ctx: JiraContext, key: string, labels: string[]): Promise<void> {
  await jira<void>(ctx, `${API}/issue/${seg(key)}`, { method: 'PUT', body: { update: { labels: labels.map((l) => ({ remove: l })) } } });
}

/** The upload body, built in core; exported here because the Jira tests compare against it. */
export { multipartFile } from '../../core/multipart.js';

export function uploadAttachment(ctx: JiraContext, key: string, fileName: string, data: Uint8Array): Promise<JiraAttachment[]> {
  return apiRequest<JiraAttachment[]>(jiraArea, ctx, `${API}/issue/${seg(key)}/attachments`, {
    method: 'POST',
    headers: { 'X-Atlassian-Token': 'no-check', Accept: 'application/json', Connection: 'close' },
    multipart: [{ name: 'file', fileName, data }],
  });
}

export async function listAttachments(ctx: JiraContext, key: string): Promise<JiraAttachment[]> {
  const result = await jira<{ fields: { attachment?: JiraAttachment[] } }>(ctx, `${API}/issue/${seg(key)}`, { params: { fields: 'attachment' } });
  return result.fields.attachment ?? [];
}

/**
 * The attachment's bytes, from the `content` URL Jira returned. That URL is
 * built from Jira's own idea of its base URL, which may name a different host
 * than the one configured (an internal name, a proxy). The token only ever
 * goes to the configured host: a different origin is re-pointed at it.
 */
export async function downloadAttachment(ctx: JiraContext, contentUrl: string): Promise<Uint8Array> {
  const target = repointUrl(contentUrl, ctx.connection.baseUrl, ctx.warn, {
    service: 'Jira',
    subject: 'attachment',
    code: 'JIRA_ATTACHMENT_HOST',
    fix: 'Download it from the Jira web interface instead.',
  });
  return apiRequest<Uint8Array>(jiraArea, ctx, target, { headers: { Connection: 'close' }, as: 'bytes' });
}

export async function assignIssue(ctx: JiraContext, key: string, assignee: string): Promise<void> {
  await jira<void>(ctx, `${API}/issue/${seg(key)}/assignee`, { method: 'PUT', body: { name: assignee } });
}

/** Links `key` (inward) to `target` (outward). A link type name, inward or outward phrase resolves to its id. */
export async function linkIssue(ctx: JiraContext, opts: { key: string; linkType: string; target: string }): Promise<void> {
  let linkTypeId = opts.linkType;
  if (!looksNumeric(opts.linkType)) {
    const types = await jira<{ issueLinkTypes: Array<{ id: string; name: string; inward: string; outward: string }> }>(ctx, `${API}/issueLinkType`);
    const wanted = opts.linkType.toLowerCase();
    const found = types.issueLinkTypes.find((t) => t.name.toLowerCase() === wanted || t.inward.toLowerCase() === wanted || t.outward.toLowerCase() === wanted);
    if (!found) {
      throw new ToilError('INVALID_INPUT', `Link type not found: ${opts.linkType}`, {
        fix: `Use one of: ${types.issueLinkTypes.map((t) => t.name).join(', ') || '(Jira reported none)'}, or a link type id.`,
      });
    }
    linkTypeId = found.id;
  }
  await jira<void>(ctx, `${API}/issueLink`, {
    method: 'POST',
    body: { type: { id: linkTypeId }, inwardIssue: { key: opts.key }, outwardIssue: { key: opts.target } },
  });
}

export function listBoards(ctx: JiraContext, project: string): Promise<JiraBoard[]> {
  return every(`Jira boards for project ${project}`, 'values', (paging) => jira(ctx, `${AGILE_API}/board`, { params: { projectKeyOrId: project, ...paging } }));
}

export function listSprintsForBoard(ctx: JiraContext, boardId: number, states?: string[]): Promise<JiraSprint[]> {
  return every(`Jira sprints for board ${boardId}`, 'values', (paging) => jira(ctx, `${AGILE_API}/board/${seg(boardId)}/sprint`, { params: { ...paging, ...(states?.length ? { state: states.join(',') } : {}) } }));
}

/** Sprints across a project's scrum boards, once each: a sprint can sit on several boards. */
export async function listSprintsForProject(ctx: JiraContext, project: string, states?: string[]): Promise<JiraSprint[]> {
  const sprints: JiraSprint[] = [];
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

export async function setSprint(ctx: JiraContext, sprintId: number, issueKeys: string[]): Promise<void> {
  await jira<void>(ctx, `${AGILE_API}/sprint/${seg(sprintId)}/issue`, { method: 'POST', body: { issues: issueKeys } });
}
