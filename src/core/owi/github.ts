import { blank, idFor, instant, isRecord, num, overrideUnit, person, setDay, setInstant, str, typeOf, unknownState, unmapped, type MapState, type OwiDocument } from './common.js';
import type { History, Iteration, Person, StatusCategory, WorkItem } from './types.js';

/**
 * GitHub (`github`) to OWI: the issues `list-issues`, `search-issues` and
 * `get-issue` return, the timeline `issue-events` returns, and a Projects
 * (v2) board's items from `projects list-items`. An issue carries its type,
 * parent and sub-issues; status, estimate and iteration live on the board,
 * so an issue found in both is one item with the board's fields filled in.
 * Pull requests are not work items here: they are what a later ChangeRef
 * will hold. The board is the system of record, except for the parts that
 * are in the issue, which is also the system of record.
 *
 * Docs, checked 2026-10-18: the Issue schema (type, parent_issue_url,
 * sub_issues_summary, state_reason) at https://docs.github.com/en/rest/issues/issues;
 * the timeline at https://docs.github.com/en/rest/issues/timeline;
 * ProjectV2 item field values in the GraphQL reference.
 */

/** The Projects number fields that hold an estimate by default, first match. */
export const GITHUB_ESTIMATE_FIELDS = ['Estimate', 'Size', 'Story Points'];
/** The Projects single-select field that holds the board's status by default. */
export const GITHUB_STATUS_FIELD = 'Status';

/** A board's status option names by category, lowercased: GitHub's templates' defaults and their common variants. */
export const GITHUB_STATUSES: Record<string, StatusCategory> = {
  todo: 'TODO',
  'to do': 'TODO',
  backlog: 'TODO',
  ready: 'TODO',
  new: 'TODO',
  'in progress': 'IN_PROGRESS',
  doing: 'IN_PROGRESS',
  'in review': 'IN_PROGRESS',
  done: 'DONE',
};

type Issue = Record<string, unknown>;
type ProjectItem = { id?: unknown; type?: unknown; createdAt?: unknown; content?: unknown; fieldValues?: unknown };

/** `owner/repo#number`, from the issue's html_url or repository_url. */
function issueKey(issue: Issue): string | undefined {
  const number = num(issue.number);
  if (number === null) return undefined;
  const html = str(issue.html_url);
  const fromHtml = html ? /^https?:\/\/[^/]+(?:\/[^/]+)*?\/([^/]+)\/([^/]+)\/issues\/\d+$/.exec(html) : null;
  if (fromHtml) return `${fromHtml[1]}/${fromHtml[2]}#${number}`;
  const repo = str(issue.repository_url);
  const fromRepo = repo ? /\/repos\/([^/]+)\/([^/]+)$/.exec(repo) : null;
  return fromRepo ? `${fromRepo[1]}/${fromRepo[2]}#${number}` : undefined;
}

/** The key an issue API URL names (`…/repos/o/r/issues/9`). */
const keyOfApiUrl = (url: unknown) => {
  const m = typeof url === 'string' ? /\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(url) : null;
  return m ? `${m[1]}/${m[2]}#${m[3]}` : undefined;
};

const ghPerson = (value: unknown): Person | null => (isRecord(value) ? person(value.login, value.name, value.email) : null);

/** The issues a document holds: an array (lists, search), { issues } (several numbers) or one issue. Pull requests are dropped and counted. */
export function issuesOf(data: unknown): { issues: Issue[]; pulls: number } | undefined {
  const all = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.issues) ? data.issues : isRecord(data) && typeof data.number === 'number' ? [data] : undefined;
  if (!all) return undefined;
  const records = all.filter(isRecord);
  const issues = records.filter((r) => r.pull_request === undefined);
  return { issues, pulls: records.length - issues.length };
}

export function githubItem(doc: OwiDocument, issue: Issue): WorkItem | undefined {
  const key = issueKey(issue);
  if (key === undefined) return undefined;
  const item = blank(doc, key, str(issue.title) ?? '', { [doc.command]: issue });
  item.url = str(issue.html_url);
  item.typeName = isRecord(issue.type) ? str(issue.type.name) : null;
  item.type = typeOf(item.typeName);
  if (issue.type === undefined) unmapped(item, 'type', "the record has no type field: this GitHub server doesn't have issue types");
  if (typeof issue.body === 'string') item.body = { format: 'markdown', content: issue.body };
  item.status = str(issue.state);
  item.statusCategory = item.status === 'closed' ? 'DONE' : item.status === 'open' ? 'TODO' : 'UNKNOWN';
  item.resolution = item.status === 'closed' ? str(issue.state_reason) : null;
  item.assignee = Array.isArray(issue.assignees) && issue.assignees.length > 0 ? ghPerson(issue.assignees[0]) : ghPerson(issue.assignee);
  item.reporter = ghPerson(issue.user);
  item.labels = (Array.isArray(issue.labels) ? issue.labels : []).flatMap((l) => (typeof l === 'string' ? [l] : isRecord(l) && typeof l.name === 'string' ? [l.name] : []));
  const parent = keyOfApiUrl(issue.parent_issue_url);
  if (parent) item.parent = idFor(doc.connection, parent);
  if (Array.isArray(issue.sub_issues)) item.children = issue.sub_issues.flatMap((s) => (isRecord(s) && issueKey(s) ? [idFor(doc.connection, issueKey(s)!)] : []));
  setInstant(item, 'created', issue.created_at, 'created_at');
  setInstant(item, 'updated', issue.updated_at, 'updated_at');
  setInstant(item, 'resolved', issue.closed_at, 'closed_at');
  return item;
}

/** One board item: its issue's key (or the draft's own), and its field values by field name. */
export interface BoardEntry {
  key: string;
  item: ProjectItem;
  values: Map<string, Record<string, unknown>>;
  draft: boolean;
}

/** The board items `projects list-items` returns, keyed as items are. Pull requests are counted and left out. */
export function boardEntries(doc: OwiDocument): { entries: BoardEntry[]; pulls: number } | undefined {
  if (!Array.isArray(doc.data) || !doc.data.every((d) => isRecord(d) && 'fieldValues' in d)) return undefined;
  const entries: BoardEntry[] = [];
  let pulls = 0;
  for (const raw of doc.data as ProjectItem[]) {
    const content = isRecord(raw.content) ? raw.content : {};
    const values = new Map<string, Record<string, unknown>>();
    for (const v of Array.isArray(raw.fieldValues) ? raw.fieldValues : []) if (isRecord(v) && isRecord(v.field) && typeof v.field.name === 'string') values.set(v.field.name, v);
    if (raw.type === 'PULL_REQUEST') {
      pulls++;
      continue;
    }
    if (raw.type === 'DRAFT_ISSUE') {
      if (typeof raw.id === 'string') entries.push({ key: `${doc.inputs.owner ?? 'project'}/draft/${raw.id}`, item: raw, values, draft: true });
      continue;
    }
    const repo = isRecord(content.repository) ? str(content.repository.nameWithOwner) : null;
    const number = num(content.number);
    if (repo && number !== null) entries.push({ key: `${repo}#${number}`, item: raw, values, draft: false });
  }
  return { entries, pulls };
}

/** An item for a board entry whose issue wasn't in the input: what the board carries about it. */
export function boardItem(doc: OwiDocument, entry: BoardEntry): WorkItem {
  const content = isRecord(entry.item.content) ? entry.item.content : {};
  const item = blank(doc, entry.key, str(content.title) ?? '', {});
  item.url = str(content.url);
  item.typeName = entry.draft ? 'Draft issue' : null;
  item.status = entry.draft ? null : (str(content.state)?.toLowerCase() ?? null);
  item.statusCategory = item.status === 'closed' ? 'DONE' : 'TODO';
  setInstant(item, 'created', entry.item.createdAt, 'createdAt');
  setInstant(item, 'updated', content.updatedAt ?? null, 'updatedAt');
  if (!entry.draft) for (const field of ['type', 'assignee', 'reporter', 'labels', 'parent']) unmapped(item, field, 'the board carries only the title, state and URL: add github get-issue output for this issue to the input');
  return item;
}

/** Fills an item with what its board entry knows: status, estimate, iteration, and any field an override names. */
export function applyBoard(item: WorkItem, entry: BoardEntry, doc: OwiDocument, state: MapState): void {
  item.native[doc.command] = entry.item;
  const status = entry.values.get(GITHUB_STATUS_FIELD);
  const name = status ? str(status.name) : null;
  if (name !== null && item.status !== 'closed') {
    item.status = name;
    item.statusCategory = GITHUB_STATUSES[name.toLowerCase()] ?? unknownState(item, state, name, 'a board status option of the project\'s own');
  }

  // The board leaves an empty field out of fieldValues, so an unestimated item and one estimated elsewhere look alike.
  const override = state.fields.estimate;
  const estimateName = override ?? GITHUB_ESTIMATE_FIELDS.find((f) => num(entry.values.get(f)?.number) !== null);
  const estimate = estimateName === undefined ? null : num(entry.values.get(estimateName)?.number);
  removeUnmapped(item, 'estimate');
  if (estimateName !== undefined && estimate !== null) item.estimate = { value: estimate, unit: overrideUnit(state), field: estimateName };
  else unmapped(item, 'estimate', override ? `the board item has no number in "${override}" (fields estimate)` : `the board item has no number in a field named ${GITHUB_ESTIMATE_FIELDS.map((f) => `"${f}"`).join(', ')}: point fields estimate at the project's own`);

  // As with estimate, the board leaves an empty field out, so "no value" and "no such field" read the same.
  const absent = (name: string, field: string) => unmapped(item, field, `the board item has no value in "${name}": the field is empty, or the project has no field of that name (fields ${field})`);

  const iterationName = state.fields.iteration;
  const iterationValue = iterationName ? entry.values.get(iterationName) : [...entry.values.values()].find((v) => v.__typename === 'ProjectV2ItemFieldIterationValue');
  removeUnmapped(item, 'iteration');
  if (iterationValue && str(iterationValue.title)) {
    const start = instant(iterationValue.startDate) ?? null;
    const days = num(iterationValue.duration);
    const end = start && days !== null ? new Date(Date.parse(start) + days * 86_400_000).toISOString() : null;
    const iteration: Iteration = { id: str(iterationValue.iterationId), name: iterationValue.title as string, path: null, start, end, state: null };
    item.iteration = iteration;
  } else if (iterationName) absent(iterationName, 'iteration');
  else unmapped(item, 'iteration', "the board item has no iteration value: it isn't in an iteration, or the project has no iteration field");
  for (const field of ['priority', 'team', 'dueDate'] as const) {
    const fieldName = state.fields[field];
    if (fieldName === undefined) continue;
    removeUnmapped(item, field);
    const value = entry.values.get(fieldName);
    const read = value ? (str(value.name) ?? str(value.text) ?? str(value.date) ?? (num(value.number) === null ? null : String(value.number))) : null;
    if (read === null) absent(fieldName, field);
    else if (field === 'dueDate') setDay(item, read, fieldName);
    else item[field] = read;
  }
  if (state.fields.type !== undefined) {
    const value = entry.values.get(state.fields.type);
    const typeName = value ? (str(value.name) ?? str(value.text)) : null;
    removeUnmapped(item, 'type');
    if (typeName) {
      item.typeName = typeName;
      item.type = typeOf(typeName);
    } else absent(state.fields.type, 'type');
  }
}

const removeUnmapped = (item: WorkItem, field: string) => {
  item.unmapped = item.unmapped.filter((u) => u.field !== field);
};

/** Notes, on an issue no board covered, where its board fields would have come from. */
export function noBoard(item: WorkItem, state: MapState): void {
  unmapped(item, 'estimate', 'GitHub keeps estimates on a project board: add github projects list-items output to the input');
  unmapped(item, 'iteration', 'GitHub keeps iterations on a project board: add github projects list-items output to the input');
  for (const field of ['priority', 'team', 'dueDate', 'type'] as const) if (state.fields[field] !== undefined) unmapped(item, field, `"${state.fields[field]}" is a project field: add github projects list-items output to the input`);
}

/** The timeline `issue-events` returns, as open and closed transitions. */
export function githubHistory(doc: OwiDocument): History | undefined {
  if (!Array.isArray(doc.data)) return undefined;
  const history: History = { transitions: [], iterations: [] };
  for (const event of doc.data) {
    if (!isRecord(event)) continue;
    const at = instant(event.created_at);
    if (!at) continue;
    if (event.event === 'closed') history.transitions.push({ from: 'open', to: 'closed', fromCategory: 'TODO', toCategory: 'DONE', at, by: ghPerson(event.actor) });
    else if (event.event === 'reopened') history.transitions.push({ from: 'closed', to: 'open', fromCategory: 'DONE', toCategory: 'TODO', at, by: ghPerson(event.actor) });
  }
  return history;
}

