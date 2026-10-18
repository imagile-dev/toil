/**
 * The work items each dossier's tracker returns, as toil's commands print
 * them. They are the OWI sprint fixture's own input
 * (test/fixtures/owi/sprint.ts, read in place, so there is one copy): the
 * Jira issues, Azure DevOps work items and GitHub issues `toil util owi map`
 * turns into test/fixtures/owi/sprint-42.owi.json, split by the dossier that
 * holds them. The dashboard asks for each item's history as well, so the items
 * that fixture has none for get a history here that agrees with their fields:
 * an empty Jira changelog or GitHub timeline, and Azure DevOps revisions from
 * creation on.
 */

import { sprintEnvelopes } from '../../../test/fixtures/owi/sprint.ts';

type Env = { data?: unknown; meta?: { command?: string } };
type Wrapped = { key: string; history: Env };

const envs = sprintEnvelopes as Array<Env | Wrapped>;
const isWrapped = (e: Env | Wrapped): e is Wrapped => 'history' in e;
const dataOf = (command: string): unknown => (envs.find((e) => !isWrapped(e) && e.meta?.command === command) as Env).data;
const historyOf = (command: string) => envs.filter(isWrapped).filter((e) => e.history.meta?.command === command);

// Jira Data Center: card-payments --------------------------------------------

const jiraIssues = (dataOf('jira get-issue') as { issues: Array<{ key: string }> }).issues;

/** `jira search`'s data: Jira's own search answer. */
export const JIRA_SEARCH = { startAt: 0, maxResults: 50, total: jiraIssues.length, issues: jiraIssues };
export const JIRA_KEYS = jiraIssues.map((i) => i.key);

/** Each issue's `jira get-changelog` data; an issue nothing changed on since it was created has an empty one. */
export const JIRA_CHANGELOGS: Record<string, unknown> = Object.fromEntries(
  JIRA_KEYS.map((key) => [key, historyOf('jira get-changelog').find((h) => h.key === key)?.history.data ?? []]),
);

// Azure DevOps Server: settlement -------------------------------------------

export const ADO_ITERATIONS = dataOf('ado work list-iterations');
export const ADO_BATCH = dataOf('ado work get-batch') as { count: number; value: Array<{ id: number; fields: Record<string, unknown> }>; missing: unknown[] };
export const ADO_IDS = ADO_BATCH.value.map((w) => w.id);

const ADO = 'https://ado.imagile.dev/DefaultCollection';

/** `ado work search`'s data: the WIQL answer, ids and urls only. */
export const ADO_WIQL = {
  queryType: 'flat',
  queryResultType: 'workItem',
  asOf: '2026-10-13T08:00:00.000Z',
  columns: [{ referenceName: 'System.Id', name: 'ID', url: `${ADO}/_apis/wit/fields/System.Id` }],
  workItems: ADO_IDS.map((id) => ({ id, url: `${ADO}/_apis/wit/workItems/${id}` })),
};

const fixtureRevisions = new Map(
  envs
    .filter((e): e is Env => !isWrapped(e) && e.meta?.command === 'ado work revisions')
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

/** Each work item's `ado work revisions` data, oldest first. */
export const ADO_REVISIONS: Record<number, unknown> = Object.fromEntries(ADO_IDS.map((id) => [id, fixtureRevisions.get(id) ?? moreRevisions[id]]));

// GitHub Enterprise: checkout-web --------------------------------------------

export const GITHUB_PROJECT_ITEMS = dataOf('github projects list-items') as Array<{ content: { number: number; repository: { nameWithOwner: string } } }>;
export const GITHUB_NUMBERS = GITHUB_PROJECT_ITEMS.map((i) => i.content.number);
export const GITHUB_ISSUES = dataOf('github get-issue');

/** Each issue's `github issue-events` timeline; an issue with no events has an empty one. */
export const GITHUB_EVENTS: Record<number, unknown> = Object.fromEntries(
  GITHUB_NUMBERS.map((n) => [n, historyOf('github issue-events').find((h) => h.key === String(n))?.history.data ?? []]),
);
