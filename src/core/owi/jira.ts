import { blank, current, idFor, instant, isRecord, num, overrideUnit, person, setDay, setInstant, str, text, typeOf, unknownState, unmapped, type MapState, type OwiDocument } from './common.js';
import type { History, Iteration, Link, Person, StatusCategory, WorkItem } from './types.js';

/**
 * Jira Data Center (`jira`) and Jira Cloud (`jira-cloud`) to OWI: the issues
 * `issue search` and `issue get` return, one key or several, and the history
 * `issue history` returns. Both variants send the same issue shape; Cloud
 * identifies people by accountId and writes the description as ADF.
 *
 * Custom fields reach the output under the name the connection registers
 * them by (customFields), or as their id when it doesn't, so the default
 * estimate and sprint fields are found by those names, by an expanded
 * `names` map, or by an override in `fields`. A field id that differs on
 * every site is the closest thing Jira has to a tradition.
 *
 * Docs, checked 2026-10-18: the issue and changelog shapes at
 * https://developer.atlassian.com/server/jira/platform/rest/v10002/api-group-issue/
 * and https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/;
 * status categories (new, indeterminate, done) at
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/.
 */

/** The fields that hold story points by default: company-managed and Data Center, then team-managed Cloud. */
export const JIRA_POINTS_FIELDS = ['Story Points', 'Story point estimate'];
/** Jira's original estimate, which it stores in seconds. */
export const JIRA_HOURS_FIELD = 'timeoriginalestimate';
/** The sprint field, by the name Jira Software gives it. */
export const JIRA_SPRINT_FIELD = 'Sprint';
/** Data Center's epic link, a parent before Jira had `parent` for every level. */
const EPIC_LINK = 'Epic Link';

const CATEGORY: Record<string, StatusCategory> = { new: 'TODO', indeterminate: 'IN_PROGRESS', done: 'DONE' };

type Issue = { key?: unknown; id?: unknown; self?: unknown; fields?: Record<string, unknown>; names?: Record<string, unknown> };

/** The issues a document holds: `issue search` and bulk `issue get` ({ issues }), or one `issue get`. */
export function issuesOf(data: unknown): Issue[] | undefined {
  if (isRecord(data) && Array.isArray(data.issues)) return data.issues.filter(isRecord) as Issue[];
  if (isRecord(data) && typeof data.key === 'string' && isRecord(data.fields)) return [data as Issue];
  return undefined;
}

/** The key of a field in an issue: the name as given, else a custom field id whose expanded name it is. */
function fieldKey(issue: Issue, name: string): string | undefined {
  const fields = issue.fields ?? {};
  if (name in fields) return name;
  if (isRecord(issue.names)) for (const [id, label] of Object.entries(issue.names)) if (label === name && id in fields) return id;
  return undefined;
}

const jiraPerson = (value: unknown): Person | null => (isRecord(value) ? person(value.accountId ?? value.name ?? value.key, value.displayName, value.emailAddress) : null);

/** A sprint, from Cloud's object or Data Center's `com.atlassian.greenhopper.service.sprint.Sprint@…[id=1,state=ACTIVE,name=…]` string. */
export function sprintOf(value: unknown): Iteration | undefined {
  let fields: Record<string, unknown> | undefined;
  if (isRecord(value)) fields = value;
  else if (typeof value === 'string') {
    const inner = /\[(.*)\]\s*$/s.exec(value)?.[1];
    if (inner === undefined) return undefined;
    fields = {};
    for (const part of inner.split(/,(?=[A-Za-z]+=)/)) {
      const at = part.indexOf('=');
      if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1) === '<null>' ? null : part.slice(at + 1);
    }
  }
  const name = str(fields?.name);
  if (!fields || name === null) return undefined;
  const state = String(fields.state ?? '').toLowerCase();
  return {
    id: fields.id === undefined || fields.id === null ? null : String(fields.id),
    name,
    path: null,
    start: instant(fields.startDate) ?? null,
    end: instant(fields.endDate) ?? null,
    state: state === 'active' ? 'current' : state === 'closed' ? 'past' : state === 'future' ? 'future' : null,
  };
}

const LINKS: Record<string, Link['type']> = { blocks: 'blocks', duplicate: 'duplicates', relates: 'relates' };

/** One Jira issue as OWI. `categories` learns each status name's category for the history. */
export function jiraItem(doc: OwiDocument, issue: Issue, state: MapState, categories: Map<string, StatusCategory>): WorkItem | undefined {
  const key = str(issue.key);
  if (key === null) return undefined;
  const f = issue.fields ?? {};
  const item = blank(doc, key, str(f.summary) ?? '', { [doc.command]: issue });
  if (str(f.summary) === null) unmapped(item, 'title', 'the record has no summary');
  const self = str(issue.self);
  if (self?.includes('/rest/')) item.url = `${self.slice(0, self.indexOf('/rest/'))}/browse/${encodeURIComponent(key)}`;
  else unmapped(item, 'url', 'the record has no self link to take the site from');

  // Type: the issue type, or an override field that holds a type name.
  const typeField = state.fields.type;
  const typeName = typeField === undefined ? (isRecord(f.issuetype) ? str(f.issuetype.name) : null) : text(f[typeField]);
  if (typeField !== undefined && !(typeField in f)) unmapped(item, 'type', `the record has no field "${typeField}" (fields type)`);
  item.typeName = typeName;
  item.type = typeField === undefined && isRecord(f.issuetype) && f.issuetype.subtask === true ? 'TASK' : typeOf(typeName);

  if (typeof f.description === 'string') item.body = { format: 'wiki', content: f.description };
  else if (isRecord(f.description)) item.body = { format: 'adf', content: f.description };

  // Status and its category, which Jira sends with every status.
  if (isRecord(f.status)) {
    item.status = str(f.status.name);
    const categoryKey = isRecord(f.status.statusCategory) ? str(f.status.statusCategory.key) : null;
    const category = categoryKey === null ? undefined : CATEGORY[categoryKey];
    if (category && item.status) categories.set(item.status, category);
    item.statusCategory = category ?? unknownState(item, state, item.status ?? '(none)', categoryKey === null ? 'the status came without its statusCategory' : `its statusCategory is "${categoryKey}"`);
  } else unmapped(item, 'status', 'the record has no status field');
  item.resolution = isRecord(f.resolution) ? str(f.resolution.name) : null;

  item.assignee = jiraPerson(f.assignee);
  item.reporter = jiraPerson(f.reporter);
  const priorityField = state.fields.priority ?? 'priority';
  item.priority = text(f[priorityField]);
  if (state.fields.priority !== undefined && !(priorityField in f)) unmapped(item, 'priority', `the record has no field "${priorityField}" (fields priority)`);
  item.labels = Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === 'string') : [];
  if (state.fields.team !== undefined) {
    if (state.fields.team in f) item.team = text(f[state.fields.team]);
    else unmapped(item, 'team', `the record has no field "${state.fields.team}" (fields team)`);
  }

  estimate(item, issue, state);
  iteration(item, issue, state);

  // Parent: Jira's parent, else Data Center's epic link; children: the sub-tasks.
  const parent = isRecord(f.parent) ? str(f.parent.key) : (str(f[fieldKey(issue, EPIC_LINK) ?? EPIC_LINK]) ?? null);
  item.parent = parent === null ? null : idFor(doc.connection, parent);
  item.children = (Array.isArray(f.subtasks) ? f.subtasks : []).flatMap((s) => (isRecord(s) && typeof s.key === 'string' ? [idFor(doc.connection, s.key)] : []));
  for (const link of Array.isArray(f.issuelinks) ? f.issuelinks : []) {
    if (!isRecord(link) || !isRecord(link.type)) continue;
    const outward = isRecord(link.outwardIssue) ? str(link.outwardIssue.key) : null;
    const inward = isRecord(link.inwardIssue) ? str(link.inwardIssue.key) : null;
    const target = outward ?? inward;
    if (target === null) continue;
    item.links.push({
      type: LINKS[String(link.type.name ?? '').toLowerCase()] ?? 'other',
      direction: outward !== null ? 'outward' : 'inward',
      target: idFor(doc.connection, target),
      name: str(outward !== null ? link.type.outward : link.type.inward) ?? str(link.type.name) ?? '',
    });
  }

  setInstant(item, 'created', f.created, 'created');
  setInstant(item, 'updated', f.updated, 'updated');
  setInstant(item, 'resolved', f.resolutiondate, 'resolutiondate');
  const due = state.fields.dueDate ?? 'duedate';
  if (state.fields.dueDate !== undefined && !(due in f)) unmapped(item, 'dueDate', `the record has no field "${due}" (fields dueDate)`);
  else setDay(item, f[due], due);
  if (!('created' in f)) unmapped(item, 'created', 'the record has no created field');
  return item;
}

function estimate(item: WorkItem, issue: Issue, state: MapState): void {
  const f = issue.fields ?? {};
  const override = state.fields.estimate;
  if (override !== undefined) {
    const key = fieldKey(issue, override);
    if (key === undefined) return unmapped(item, 'estimate', `the record has no field "${override}" (fields estimate)`);
    const value = num(f[key]);
    if (value === null) {
      if (f[key] !== null && f[key] !== undefined) unmapped(item, 'estimate', `"${override}" holds ${JSON.stringify(f[key])}, not a number`);
      return;
    }
    // Jira keeps the original estimate in seconds, so it can only be hours here.
    if (key === JIRA_HOURS_FIELD) {
      if (state.fields.estimateUnit !== undefined && state.fields.estimateUnit !== 'hours') return unmapped(item, 'estimate', `${JIRA_HOURS_FIELD} is in seconds, which OWI reads as hours, not ${state.fields.estimateUnit}`);
      item.estimate = { value: value / 3600, unit: 'hours', field: key };
    } else item.estimate = { value, unit: overrideUnit(state), field: key };
    return;
  }
  let present = false;
  for (const name of JIRA_POINTS_FIELDS) {
    const key = fieldKey(issue, name);
    if (key === undefined) continue;
    present = true;
    const value = num(f[key]);
    if (value !== null) return void (item.estimate = { value, unit: 'points', field: key });
  }
  if (JIRA_HOURS_FIELD in f) {
    present = true;
    const seconds = num(f[JIRA_HOURS_FIELD]);
    if (seconds !== null) return void (item.estimate = { value: seconds / 3600, unit: 'hours', field: JIRA_HOURS_FIELD });
  }
  if (!present) {
    unmapped(item, 'estimate', `the record has none of ${[...JIRA_POINTS_FIELDS, JIRA_HOURS_FIELD].map((n) => `"${n}"`).join(', ')}: register the estimate field in the connection's customFields, ask for it with --fields, or point fields estimate at it`);
  }
}

function iteration(item: WorkItem, issue: Issue, state: MapState): void {
  const name = state.fields.iteration ?? JIRA_SPRINT_FIELD;
  const key = fieldKey(issue, name);
  if (key === undefined) {
    unmapped(item, 'iteration', `the record has no "${name}" field: register the sprint field in the connection's customFields, or point fields iteration at it`);
    return;
  }
  const raw = issue.fields?.[key];
  const values = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const sprints = values.map(sprintOf);
  if (sprints.some((s) => s === undefined)) unmapped(item, 'iteration', `"${key}" holds a value that isn't a sprint`);
  item.iteration = current(sprints.filter((s): s is Iteration => s !== undefined));
}

/** The change history `issue history` returns, as transitions and sprint moves. */
export function jiraHistory(doc: OwiDocument, state: MapState, categoryOf: (status: string) => StatusCategory | undefined): History | undefined {
  if (!Array.isArray(doc.data)) return undefined;
  const sprintField = state.fields.iteration ?? JIRA_SPRINT_FIELD;
  const history: History = { transitions: [], iterations: [] };
  for (const entry of doc.data) {
    if (!isRecord(entry) || !Array.isArray(entry.items)) continue;
    const at = instant(entry.created);
    if (!at) continue;
    const by = jiraPerson(entry.author);
    for (const change of entry.items) {
      if (!isRecord(change)) continue;
      const field = String(change.field ?? '');
      // `toString` is a key of every object, so it's read as the record's own property only.
      const toText = Object.hasOwn(change, 'toString') ? str(change.toString) : null;
      if (field.toLowerCase() === 'status' && toText !== null) {
        const from = str(change.fromString);
        const to = toText;
        history.transitions.push({ from, to, fromCategory: from === null ? null : (categoryOf(from) ?? 'UNKNOWN'), toCategory: categoryOf(to) ?? 'UNKNOWN', at, by });
      } else if (field === sprintField || change.fieldId === sprintField) {
        const names = (value: unknown) => (str(value) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        history.iterations.push({ from: names(change.fromString), to: names(toText), at, by });
      }
    }
  }
  return history;
}
