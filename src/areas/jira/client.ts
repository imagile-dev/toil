import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Connection } from '../../core/area.js';
import type { CommandContext } from '../../core/context.js';
import { ToilError } from '../../core/errors.js';
import { buildUrl, restRequest, type QueryValue } from '../../core/rest.js';
import type { CustomFieldDefinition, jiraArea } from './area.js';
import { suggestedType } from './custom-fields.js';

/**
 * Every request toil sends to Jira Data Center. Commands describe what they
 * want; this module knows the endpoints, the headers, the paging and the odd
 * corners (createmeta moved in 8.4, attachments are fetched from a URL Jira
 * hands back). Requests are kept exactly as the command contract sent
 * them, because those are the ones known to work against real servers.
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
  /** The same value under the name the command contract's output used. */
  toilType?: CustomFieldDefinition['type'];
}

/**
 * A key or id in a URL path, unencoded, exactly as the contract sent it.
 * A key with `/` or `?` changes the path; recorded as a suspected bug (#70), not
 * changed (CLAUDE.md, Building). Precedent outranks preference until a live
 * server rules otherwise.
 */
const seg = (value: string | number) => String(value);

/**
 * The contract's test for "an id, not a name": anything parseInt can read a
 * number from, so "2nd Review" counts as an id. Recorded as a suspected bug (#70).
 */
export const looksNumeric = (value: string) => !isNaN(parseInt(value, 10));

const authFix = (ctx: JiraContext) =>
  `Jira rejected the personal access token on connection "${ctx.connection.name}". Create a new one under your profile picture → Profile → Personal Access Tokens, then set apiToken (TOIL_JIRA_API_TOKEN for the default connection).`;

function headers(ctx: JiraContext): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.connection.apiToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Connection: 'close',
  };
}

interface JiraRequest {
  method?: 'GET' | 'POST' | 'PUT';
  params?: Record<string, QueryValue>;
  body?: unknown;
}

export function jira<T>(ctx: JiraContext, path: string, req: JiraRequest = {}): Promise<T> {
  const init: RequestInit = { method: req.method ?? 'GET', headers: headers(ctx) };
  if (req.body !== undefined) init.body = JSON.stringify(req.body);
  return restRequest<T>(ctx, buildUrl(ctx.connection.baseUrl, path, req.params), init, { service: 'Jira', authFix: authFix(ctx) });
}

interface Page<T> {
  values?: T[];
  total?: number;
}

/**
 * Every item from a startAt/maxResults endpoint, stopping on `total` or an
 * empty page, as the contract did. An endpoint with no `total` (the Agile
 * sprint list) costs one extra empty-page request; recorded as a suspected bug (#70).
 */
export async function paginate<T>(fetchPage: (startAt: number, maxResults: number) => Promise<Page<T>>): Promise<T[]> {
  const results: T[] = [];
  let startAt = 0;
  for (;;) {
    const page = await fetchPage(startAt, PAGE);
    const items = page.values ?? [];
    results.push(...items);
    startAt += items.length;
    if ((startAt >= (page.total as number)) || items.length === 0) break;
  }
  return results;
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
  return paginate(async (startAt, maxResults) => {
    const page = await jira<{ comments: unknown[]; total: number }>(ctx, `${API}/issue/${seg(key)}/comment`, { params: { startAt, maxResults } });
    return { values: page.comments, total: page.total };
  });
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
 */
export async function search(
  ctx: JiraContext,
  jql: string,
  opts: { maxResults?: number | undefined; startAt?: number | undefined; fields: string[] },
): Promise<JiraSearchResult> {
  const first = opts.startAt ?? 0;
  const issues: JiraIssue[] = [];
  let total = 0;
  let next = first;
  for (;;) {
    const pageSize = opts.maxResults === undefined ? PAGE : Math.min(PAGE, opts.maxResults - issues.length);
    if (pageSize <= 0 && issues.length > 0) break;
    const page = await jira<JiraSearchResult>(ctx, `${API}/search`, { method: 'POST', body: { jql, startAt: next, maxResults: pageSize, fields: opts.fields } });
    const items = page.issues ?? [];
    issues.push(...items);
    total = page.total;
    next += items.length;
    if (next >= total || items.length === 0) break;
    if (opts.maxResults !== undefined && issues.length >= opts.maxResults) break;
  }
  return { issues, total, startAt: first, maxResults: issues.length };
}

export async function fetchFields(ctx: JiraContext): Promise<JiraFieldInfo[]> {
  const fields = await jira<JiraFieldInfo[]>(ctx, `${API}/field`);
  return fields.map((f) => {
    const type = suggestedType(f.schema);
    return type ? { ...f, suggestedType: type, toilType: type } : f;
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

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot === -1 ? undefined : MIME[fileName.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

/**
 * A multipart/form-data body with one `file` part, built by hand so the
 * boundary is derived from the content: the same upload is the same bytes on
 * every run, which is what lets both front doors be compared request for
 * request. A hash of the content can't occur in the content.
 */
export function multipartFile(fileName: string, data: Uint8Array): { body: Uint8Array; contentType: string } {
  const boundary = `toil-${createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
  const safeName = fileName.replace(/[\r\n]/g, '').replace(/"/g, '%22');
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mimeType(fileName)}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function uploadAttachment(ctx: JiraContext, key: string, fileName: string, data: Uint8Array): Promise<JiraAttachment[]> {
  const { body, contentType } = multipartFile(fileName, data);
  return restRequest<JiraAttachment[]>(
    ctx,
    buildUrl(ctx.connection.baseUrl, `${API}/issue/${seg(key)}/attachments`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.connection.apiToken}`, 'X-Atlassian-Token': 'no-check', Accept: 'application/json', Connection: 'close', 'Content-Type': contentType },
      body,
    },
    { service: 'Jira', authFix: authFix(ctx) },
  );
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
  const base = new URL(ctx.connection.baseUrl);
  let target: URL;
  try {
    target = new URL(contentUrl, base);
  } catch {
    throw new ToilError('HTTP', `Jira returned an attachment URL toil can't read: ${contentUrl}.`, { fix: 'Download it from the Jira web interface instead.' });
  }
  if (target.origin !== base.origin) {
    ctx.warn({ code: 'JIRA_ATTACHMENT_HOST', message: `Jira named ${target.origin} for this attachment; toil fetched it from the configured ${base.origin} instead.` });
    target = new URL(`${target.pathname}${target.search}`, base.origin);
  }
  return restRequest<Uint8Array>(
    ctx,
    target.toString(),
    { headers: { Authorization: `Bearer ${ctx.connection.apiToken}`, Connection: 'close' } },
    { service: 'Jira', authFix: authFix(ctx), as: 'bytes' },
  );
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
  return paginate((startAt, maxResults) => jira<Page<JiraBoard>>(ctx, `${AGILE_API}/board`, { params: { projectKeyOrId: project, startAt, maxResults } }));
}

export function listSprintsForBoard(ctx: JiraContext, boardId: number, states?: string[]): Promise<JiraSprint[]> {
  return paginate((startAt, maxResults) =>
    jira<Page<JiraSprint>>(ctx, `${AGILE_API}/board/${seg(boardId)}/sprint`, { params: { startAt, maxResults, ...(states?.length ? { state: states.join(',') } : {}) } }),
  );
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
