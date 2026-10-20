/**
 * The work items each dossier's tracker returns, as toil's commands print
 * them. They are the OWI sprint fixture's own input
 * (test/fixtures/owi/sprint.ts, read in place, so there is one copy): the
 * Jira issues, Azure DevOps work items and GitHub issues `toil util owi map`
 * turns into test/fixtures/owi/sprint-42.owi.json, split by the dossier that
 * holds them. The dashboard asks for each item's history as well, so the items
 * that fixture has none for get a history here that agrees with their fields:
 * an empty Jira changelog or GitHub timeline, and Azure DevOps revisions from
 * creation on. One sprint, filed under three dossiers, and still no extra meetings.
 */

import { sprintEnvelopes } from '../../../test/fixtures/owi/sprint.ts';

type Env = { data?: unknown; meta?: { command?: string } };
type Wrapped = { key: string; history: Env };

const envs = sprintEnvelopes as Array<Env | Wrapped>;
const isWrapped = (e: Env | Wrapped): e is Wrapped => 'history' in e;
const dataOf = (command: string): unknown => (envs.find((e) => !isWrapped(e) && e.meta?.command === command) as Env).data;
const historyOf = (command: string) => envs.filter(isWrapped).filter((e) => e.history.meta?.command === command);

// Jira Data Center: card-payments --------------------------------------------

const jiraIssues = (dataOf('jira issue get') as { issues: Array<{ key: string }> }).issues;

/**
 * The acceptance criteria card-payments keeps in a custom field (its dossier
 * names `customfield_10500`), for the readiness gate (#307): PAY-101 and
 * PAY-102 have them, the rest don't. Added here rather than in the OWI
 * fixture, which core's own tests pin.
 */
export const JIRA_ACCEPTANCE: Record<string, string> = {
  'PAY-101': ['* The PAN is swapped for a token before the first log line', '* A replayed token is refused'].join('\n'),
  'PAY-102': ['* A stored token charges once', '* A second charge with the same idempotency key is refused'].join('\n'),
};

/** `jira issue search`'s data: Jira's own search answer. */
export const JIRA_SEARCH = {
  startAt: 0,
  maxResults: 50,
  total: jiraIssues.length,
  issues: jiraIssues.map((i) => (JIRA_ACCEPTANCE[i.key] ? { ...i, fields: { ...(i as { fields?: Record<string, unknown> }).fields, customfield_10500: JIRA_ACCEPTANCE[i.key] } } : i)),
};
export const JIRA_KEYS = jiraIssues.map((i) => i.key);

/**
 * The custom fields card-payments' Jira connection registers, as `jira issue
 * fields` lists them: the sample's issues carry them under these names, the
 * way `issue search` translates a registered field's id in its output.
 */
export const JIRA_REGISTERED = [
  { id: 'customfield_10002', name: 'Story Points', type: 'number' },
  { id: 'customfield_10004', name: 'Sprint' },
  { id: 'customfield_10008', name: 'Epic Link' },
];

const SMITH = { self: 'https://jira.imagile.dev/rest/api/2/user?username=jsmith', name: 'jsmith', key: 'jsmith', displayName: 'J. Smith', active: true };
const jiraStatus = (id: number, at: string, from: [string, string], to: [string, string]) => ({
  id: String(id),
  author: SMITH,
  created: at,
  items: [{ field: 'status', fieldtype: 'jira', from: from[0], fromString: from[1], to: to[0], toString: to[1] }],
});

/**
 * Changelogs for the issues the OWI fixture keeps none for, matching their
 * fields: PAY-106, a sub-task created on day one and resolved on 10-07, was
 * started the day after it was created.
 */
const moreChangelogs: Record<string, unknown[]> = {
  'PAY-106': [
    jiraStatus(40501, '2026-10-06T09:30:00.000+0000', ['10000', 'To Do'], ['3', 'In Progress']),
    jiraStatus(40502, '2026-10-07T12:00:00.000+0000', ['3', 'In Progress'], ['10001', 'Done']),
  ],
};

/** Each issue's `jira issue history` data; an issue nothing changed on since it was created has an empty one. */
export const JIRA_CHANGELOGS: Record<string, unknown> = Object.fromEntries(
  JIRA_KEYS.map((key) => [key, historyOf('jira issue history').find((h) => h.key === key)?.history.data ?? moreChangelogs[key] ?? []]),
);

// Azure DevOps Server: settlement -------------------------------------------

export const ADO_ITERATIONS = dataOf('ado work-item iterations');
export const ADO_BATCH = dataOf('ado work-item get-many') as { count: number; value: Array<{ id: number; fields: Record<string, unknown> }>; missing: unknown[] };
export const ADO_IDS = ADO_BATCH.value.map((w) => w.id);

const ADO = 'https://ado.imagile.dev/DefaultCollection';

/** `ado work-item search`'s data: the WIQL answer, ids and urls only. */
export const ADO_WIQL = {
  queryType: 'flat',
  queryResultType: 'workItem',
  asOf: '2026-10-13T08:00:00.000Z',
  columns: [{ referenceName: 'System.Id', name: 'ID', url: `${ADO}/_apis/wit/fields/System.Id` }],
  workItems: ADO_IDS.map((id) => ({ id, url: `${ADO}/_apis/wit/workItems/${id}` })),
};

const fixtureRevisions = new Map(
  envs
    .filter((e): e is Env => !isWrapped(e) && e.meta?.command === 'ado work-item history')
    .map((e) => [(e.data as Array<{ id: number }>)[0]!.id, e.data]),
);

const person = (user: string, displayName: string) => ({ displayName, id: `abc12345-0000-0000-0000-0000000000${user.length}0`, uniqueName: `IMAGILE\\${user}` });
const NAKAMURA = person('knakamura', 'K. Nakamura');
const OKAFOR = person('dokafor', 'D. Okafor');

const revision = (id: number, rev: number, at: string, by: typeof OKAFOR, type: string, state: string, iteration: string) => ({
  id,
  rev,
  fields: { 'System.WorkItemType': type, 'System.State': state, 'System.IterationPath': iteration, 'System.ChangedDate': at, 'System.ChangedBy': by },
  url: `${ADO}/_apis/wit/workItems/${id}/revisions/${rev}`,
});
const ROOT = 'Payments';
const S42 = 'Payments\\Sprint 42';

/** Revisions for the items the OWI fixture keeps none for, matching their fields. */
const moreRevisions: Record<number, unknown[]> = {
  2301: [revision(2301, 1, '2026-08-24T14:00:00Z', NAKAMURA, 'Feature', 'New', ROOT), revision(2301, 2, '2026-10-05T09:30:00Z', NAKAMURA, 'Feature', 'Active', ROOT)],
  2303: [revision(2303, 1, '2026-09-10T10:05:00Z', NAKAMURA, 'User Story', 'New', ROOT), revision(2303, 2, '2026-09-30T15:00:00Z', NAKAMURA, 'User Story', 'New', S42)],
  2305: [
    revision(2305, 1, '2026-10-05T10:00:00Z', OKAFOR, 'Task', 'New', S42),
    revision(2305, 2, '2026-10-06T09:00:00Z', OKAFOR, 'Task', 'Active', S42),
    revision(2305, 3, '2026-10-08T13:00:00Z', OKAFOR, 'Task', 'Closed', S42),
  ],
  2307: [revision(2307, 1, '2026-09-01T09:00:00Z', NAKAMURA, 'Bug', 'New', ROOT), revision(2307, 2, '2026-09-30T15:00:00Z', NAKAMURA, 'Bug', 'New', S42), revision(2307, 3, '2026-10-07T09:00:00Z', NAKAMURA, 'Bug', 'Removed', S42)],
};

/** Each work item's `ado work-item history` data, oldest first. */
export const ADO_REVISIONS: Record<number, unknown> = Object.fromEntries(ADO_IDS.map((id) => [id, fixtureRevisions.get(id) ?? moreRevisions[id]]));

// GitHub Enterprise: checkout-web --------------------------------------------

export const GITHUB_PROJECT_ITEMS = dataOf('github project items') as Array<{ content: { number: number; repository: { nameWithOwner: string } } }>;
export const GITHUB_NUMBERS = GITHUB_PROJECT_ITEMS.map((i) => i.content.number);
export const GITHUB_ISSUES = dataOf('github issue get');

/** Each issue's `github issue history` timeline; an issue with no events has an empty one. */
export const GITHUB_EVENTS: Record<number, unknown> = Object.fromEntries(
  GITHUB_NUMBERS.map((n) => [n, historyOf('github issue history').find((h) => h.key === String(n))?.history.data ?? []]),
);

// The readiness gate's one live read (#307) ------------------------------------

const jiraStatus2 = (name: string, id: string, key: 'new' | 'indeterminate' | 'done', category: string) => ({ self: `https://jira.imagile.dev/rest/api/2/status/${id}`, name, id, statusCategory: { id: key === 'new' ? 2 : key === 'done' ? 3 : 4, key, name: category } });
const TO = {
  progress: jiraStatus2('In Progress', '3', 'indeterminate', 'In Progress'),
  review: jiraStatus2('In Review', '10100', 'indeterminate', 'In Progress'),
  done: jiraStatus2('Done', '10001', 'done', 'Done'),
  todo: jiraStatus2('To Do', '10000', 'new', 'To Do'),
};
/** The moves Jira offers from each status in the sample workflow: To Do only starts, so it can't go straight to Done. */
const MOVES: Record<string, Array<{ id: string; name: string; to: unknown }>> = {
  'To Do': [{ id: '11', name: 'Start Progress', to: TO.progress }],
  'In Progress': [
    { id: '21', name: 'Submit for Review', to: TO.review },
    { id: '31', name: 'Done', to: TO.done },
    { id: '41', name: 'Stop Progress', to: TO.todo },
  ],
  'In Review': [
    { id: '31', name: 'Done', to: TO.done },
    { id: '51', name: 'Back to In Progress', to: TO.progress },
  ],
};
const statusName = (i: unknown) => String(((i as { fields?: { status?: { name?: string } } }).fields?.status?.name) ?? '');

/** `jira issue transitions <key>`'s data for each issue that isn't done: Jira's own transitions list. */
export const JIRA_TRANSITIONS: Record<string, unknown> = Object.fromEntries(jiraIssues.filter((i) => statusName(i) !== 'Done').map((i) => [i.key, MOVES[statusName(i)] ?? []]));

/** `ado work-item states --type <type>`'s data for each type with an open item on the settlement board: the Agile process's states. */
const AGILE = [
  { name: 'New', color: 'b2b2b2', category: 'Proposed' },
  { name: 'Active', color: '007acc', category: 'InProgress' },
  { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
  { name: 'Closed', color: '339933', category: 'Completed' },
  { name: 'Removed', color: 'ffffff', category: 'Removed' },
];
export const ADO_STATES: Record<string, unknown> = {
  'User Story': AGILE,
  Bug: AGILE,
  Feature: AGILE,
};
