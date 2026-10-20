import { blank, idFor, instant, isRecord, num, overrideUnit, person, setDay, setInstant, str, text, typeOf, unknownState, unmapped, type MapState, type OwiDocument } from './common.js';
import type { History, Iteration, Link, Person, StatusCategory, WorkItem } from './types.js';

/**
 * Azure DevOps (`ado`) to OWI: the work items `work-item get` and `work-item get-many`
 * return, the revisions `work-item history` returns, and the iteration dates
 * `work-item iterations` returns. Azure DevOps leaves a field with no value
 * out of the record altogether, so an empty estimate and an estimate kept in
 * a team's own field look the same; both are listed as unmapped, with a
 * pointer to `fields estimate`. Four processes, four words for "how big",
 * and one committee that approved all of them.
 *
 * Docs, checked 2026-10-18: estimate fields at
 * https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-numeric
 * (StoryPoints for Agile, Effort for Scrum, Size for CMMI, OriginalEstimate
 * for tasks); state categories at
 * https://learn.microsoft.com/en-us/azure/devops/boards/work-items/workflow-and-state-categories;
 * link types at https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference.
 */

/** The estimate fields, by reference name, in the order tried: points first, then hours. */
export const ADO_POINTS_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size'];
export const ADO_HOURS_FIELD = 'Microsoft.VSTS.Scheduling.OriginalEstimate';

/**
 * The four system processes' default states by the category Azure DevOps
 * puts them in (the docs above). Scrum's Epic, Feature and Task use In
 * Progress, which a live Scrum organization reported as InProgress (#319);
 * the table had missed it, as tables do. Resolved behaves like In Progress on boards,
 * so it is IN_PROGRESS here; Removed is out of the work, so DONE, with the
 * reason as its resolution. A custom state isn't here and is UNKNOWN, with a
 * warning: `ado work-item states` shows its category.
 */
export const ADO_STATES: Record<string, StatusCategory> = {
  New: 'TODO',
  'To Do': 'TODO',
  Approved: 'TODO',
  Proposed: 'TODO',
  Active: 'IN_PROGRESS',
  'In Progress': 'IN_PROGRESS',
  Doing: 'IN_PROGRESS',
  Committed: 'IN_PROGRESS',
  Open: 'IN_PROGRESS',
  Resolved: 'IN_PROGRESS',
  Closed: 'DONE',
  Done: 'DONE',
  Removed: 'DONE',
};

/** Work item links by relation, as OWI links (Successor means this item comes first, so it blocks the other). */
const RELATIONS: Record<string, { type: Link['type']; direction: Link['direction']; name: string }> = {
  'System.LinkTypes.Dependency-Forward': { type: 'blocks', direction: 'outward', name: 'Successor' },
  'System.LinkTypes.Dependency-Reverse': { type: 'blocks', direction: 'inward', name: 'Predecessor' },
  'System.LinkTypes.Related': { type: 'relates', direction: 'outward', name: 'Related' },
  'System.LinkTypes.Duplicate-Forward': { type: 'duplicates', direction: 'inward', name: 'Duplicate' },
  'System.LinkTypes.Duplicate-Reverse': { type: 'duplicates', direction: 'outward', name: 'Duplicate Of' },
};
const PARENT = 'System.LinkTypes.Hierarchy-Reverse';
const CHILD = 'System.LinkTypes.Hierarchy-Forward';

type Item = { id?: unknown; fields?: Record<string, unknown>; relations?: unknown; _links?: unknown; url?: unknown };

/** The work items a document holds: `work-item get-many` ({ value }), or one `work-item get`. */
export function workItemsOf(data: unknown): Item[] | undefined {
  if (isRecord(data) && Array.isArray(data.value)) return data.value.filter(isRecord) as Item[];
  if (isRecord(data) && typeof data.id === 'number' && isRecord(data.fields)) return [data as Item];
  return undefined;
}

/** An identity, from the object the API sends, or the `Name <email>` text older servers send. */
function adoPerson(value: unknown): Person | null {
  if (isRecord(value)) return person(value.uniqueName ?? value.id, value.displayName, typeof value.uniqueName === 'string' && value.uniqueName.includes('@') ? value.uniqueName : null);
  if (typeof value === 'string') {
    const match = /^(.*?)\s*<([^>]+)>$/.exec(value);
    return match ? person(match[2], match[1], match[2]!.includes('@') ? match[2] : null) : person(value, value, null);
  }
  return null;
}

/** The id at the end of a work item URL. */
const idInUrl = (url: unknown) => (typeof url === 'string' ? /\/workItems\/(\d+)$/i.exec(url)?.[1] : undefined);

/** `\Imagile\Iteration\Sprint 1` (a classification node) and `Imagile\Sprint 1` (System.IterationPath) as one key. */
const pathKey = (path: string, node: boolean) => {
  const parts = path.replace(/^\\+/, '').split('\\');
  if (node && parts[1]?.toLowerCase() === 'iteration') parts.splice(1, 1);
  return parts.join('\\').toLowerCase();
};

/** Iteration dates by path, from `work-item iterations`' tree. */
export function iterationDates(data: unknown, into: Map<string, { id: string | null; start: string | null; end: string | null }>): boolean {
  if (!isRecord(data) || data.structureType !== 'iteration') return false;
  const walk = (node: unknown) => {
    if (!isRecord(node)) return;
    if (typeof node.path === 'string') {
      const attrs = isRecord(node.attributes) ? node.attributes : {};
      into.set(pathKey(node.path, true), { id: str(node.identifier), start: instant(attrs.startDate) ?? null, end: instant(attrs.finishDate) ?? null });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child);
  };
  walk(data);
  return true;
}

export function adoItem(doc: OwiDocument, record: Item, state: MapState, dates: Map<string, { id: string | null; start: string | null; end: string | null }>): WorkItem | undefined {
  if (typeof record.id !== 'number') return undefined;
  const key = String(record.id);
  const f = record.fields ?? {};
  const item = blank(doc, key, str(f['System.Title']) ?? '', { [doc.command]: record });
  if (str(f['System.Title']) === null) unmapped(item, 'title', 'the record has no System.Title');

  const links = isRecord(record._links) ? record._links : {};
  const html = isRecord(links.html) ? str(links.html.href) : null;
  const apiUrl = str(record.url);
  const project = str(f['System.TeamProject']);
  if (html) item.url = html;
  else if (apiUrl?.includes('/_apis/') && project) item.url = `${apiUrl.slice(0, apiUrl.indexOf('/_apis/'))}/${encodeURIComponent(project)}/_workitems/edit/${key}`;
  else unmapped(item, 'url', 'the record has no html link and no System.TeamProject to build one from');

  const typeField = state.fields.type ?? 'System.WorkItemType';
  item.typeName = text(f[typeField]);
  // Basic's Issue is its story; the other processes have no Issue on the backlog.
  item.type = typeOf(item.typeName, { issue: 'STORY' });
  if (!(typeField in f)) unmapped(item, 'type', missing(typeField, state.fields.type !== undefined && 'type'));

  if (typeof f['System.Description'] === 'string') item.body = { format: 'html', content: f['System.Description'] };

  item.status = str(f['System.State']);
  if (item.status === null) unmapped(item, 'status', 'the record has no System.State');
  else item.statusCategory = ADO_STATES[item.status] ?? unknownState(item, state, item.status, 'a custom state; ado work-item states shows its category');
  if (item.statusCategory === 'DONE') item.resolution = str(f['System.Reason']) ?? (item.status === 'Removed' ? 'Removed' : null);

  item.assignee = adoPerson(f['System.AssignedTo']);
  item.reporter = adoPerson(f['System.CreatedBy']);
  const priorityField = state.fields.priority ?? 'Microsoft.VSTS.Common.Priority';
  item.priority = text(f[priorityField]);
  if (state.fields.priority !== undefined && f[priorityField] === undefined) unmapped(item, 'priority', missing(priorityField, 'priority'));
  item.labels = typeof f['System.Tags'] === 'string' ? f['System.Tags'].split(';').map((t) => t.trim()).filter(Boolean) : [];
  if (state.fields.team !== undefined) {
    item.team = text(f[state.fields.team]);
    if (f[state.fields.team] === undefined) unmapped(item, 'team', missing(state.fields.team, 'team'));
  }

  estimate(item, f, state);

  const iterationField = state.fields.iteration ?? 'System.IterationPath';
  const path = str(f[iterationField]);
  if (path === null) unmapped(item, 'iteration', missing(iterationField, state.fields.iteration !== undefined && 'iteration'));
  else {
    const known = dates.get(pathKey(path, false));
    const iteration: Iteration = { id: known?.id ?? null, name: path.split('\\').pop()!, path, start: known?.start ?? null, end: known?.end ?? null, state: null };
    item.iteration = iteration;
    if (!known && iterationField === 'System.IterationPath' && path.includes('\\')) unmapped(item, 'iteration.dates', 'the iteration\'s dates come from ado work-item iterations: add its output to the input');
  }

  for (const relation of Array.isArray(record.relations) ? record.relations : []) {
    if (!isRecord(relation)) continue;
    const target = idInUrl(relation.url);
    if (target === undefined) continue;
    const rel = String(relation.rel ?? '');
    if (rel === PARENT) item.parent = idFor(doc.connection, target);
    else if (rel === CHILD) item.children.push(idFor(doc.connection, target));
    else if (RELATIONS[rel]) item.links.push({ ...RELATIONS[rel]!, target: idFor(doc.connection, target) });
    else if (rel.startsWith('System.LinkTypes.') || rel.startsWith('Microsoft.VSTS.')) item.links.push({ type: 'other', direction: 'outward', target: idFor(doc.connection, target), name: rel });
  }
  if (item.parent === null && typeof f['System.Parent'] === 'number') item.parent = idFor(doc.connection, String(f['System.Parent']));

  setInstant(item, 'created', f['System.CreatedDate'], 'System.CreatedDate');
  setInstant(item, 'updated', f['System.ChangedDate'], 'System.ChangedDate');
  setInstant(item, 'resolved', f['Microsoft.VSTS.Common.ClosedDate'], 'Microsoft.VSTS.Common.ClosedDate');
  const due = state.fields.dueDate ?? (f['Microsoft.VSTS.Scheduling.DueDate'] !== undefined ? 'Microsoft.VSTS.Scheduling.DueDate' : 'Microsoft.VSTS.Scheduling.TargetDate');
  if (state.fields.dueDate !== undefined && f[due] === undefined) unmapped(item, 'dueDate', missing(due, 'dueDate'));
  else setDay(item, f[due], due);
  return item;
}

/** Why a field came back empty: Azure DevOps leaves a field with no value out of the record, so the two can't be told apart. */
const missing = (field: string, override: string | false) => `${field} has no value, or the record doesn't have it (Azure DevOps leaves empty fields out)${override ? `; fields ${override} names it` : ''}`;

function estimate(item: WorkItem, f: Record<string, unknown>, state: MapState): void {
  const override = state.fields.estimate;
  if (override !== undefined) {
    const value = num(f[override]);
    if (value !== null) item.estimate = { value, unit: state.fields.estimateUnit ? overrideUnit(state) : override === ADO_HOURS_FIELD ? 'hours' : 'points', field: override };
    else unmapped(item, 'estimate', f[override] === undefined ? missing(override, 'estimate') : `${override} holds ${JSON.stringify(f[override])}, not a number`);
    return;
  }
  for (const field of ADO_POINTS_FIELDS) {
    const value = num(f[field]);
    if (value !== null) return void (item.estimate = { value, unit: 'points', field });
  }
  const hours = num(f[ADO_HOURS_FIELD]);
  if (hours !== null) return void (item.estimate = { value: hours, unit: 'hours', field: ADO_HOURS_FIELD });
  unmapped(item, 'estimate', `none of StoryPoints, Effort, Size or OriginalEstimate has a value; Azure DevOps leaves empty fields out, so an unestimated item and one estimated in a field of the team's own look alike: point fields estimate at that field`);
}

/** The revisions `work-item history` returns, oldest first, as transitions and iteration moves, keyed by the work item's id. */
export function adoHistory(doc: OwiDocument, state: MapState): Map<string, History> | undefined {
  if (!Array.isArray(doc.data)) return undefined;
  const iterationField = state.fields.iteration ?? 'System.IterationPath';
  const byItem = new Map<string, { history: History; state: string | null; path: string | null }>();
  const revisions = doc.data.filter((r): r is Item & { rev?: unknown } => isRecord(r) && typeof r.id === 'number' && isRecord(r.fields));
  revisions.sort((a, b) => (num(a.rev) ?? 0) - (num(b.rev) ?? 0));
  for (const revision of revisions) {
    const key = String(revision.id);
    const f = revision.fields!;
    const at = instant(f['System.ChangedDate']);
    if (!at) continue;
    let entry = byItem.get(key);
    if (!entry) byItem.set(key, (entry = { history: { transitions: [], iterations: [] }, state: null, path: null }));
    const by = adoPerson(f['System.ChangedBy']);
    const to = str(f['System.State']);
    if (to !== null && to !== entry.state) {
      entry.history.transitions.push({ from: entry.state, to, fromCategory: entry.state === null ? null : (ADO_STATES[entry.state] ?? 'UNKNOWN'), toCategory: ADO_STATES[to] ?? 'UNKNOWN', at, by });
      entry.state = to;
    }
    const path = str(f[iterationField]);
    if (path !== null && path !== entry.path) {
      entry.history.iterations.push({ from: entry.path === null ? [] : [entry.path], to: [path], at, by });
      entry.path = path;
    }
  }
  return new Map([...byItem].map(([key, { history }]) => [key, history]));
}
