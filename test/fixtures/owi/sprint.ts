/**
 * One sprint of placeholder work across Jira Data Center, Azure DevOps Server
 * and GitHub Enterprise, as the toil commands that read it print it: the
 * input `toil util owi map` turns into test/fixtures/owi/sprint-42.owi.json,
 * which the Toil UI preview reads as its fixture Store.
 *
 * Sprint 42 runs 2026-10-05 to 2026-10-16. Twenty items: eight Jira issues
 * (PAY), seven Azure DevOps work items (Payments) and five GitHub issues
 * (imagile/payments-web) on project 7. What a sprint report should find in it:
 *
 * - a blocked chain in each tracker: PAY-101 blocks PAY-102 blocks PAY-103,
 *   and 2302 is the predecessor of 2303;
 * - scope added mid-sprint: PAY-107 (moved into the sprint on 10-08), 2306
 *   (10-09) and payments-web#43 (added to the board on 10-07);
 * - carried over from Sprint 41: PAY-104 and 2304;
 * - unestimated or orphaned: PAY-107, payments-web#45;
 * - finished: PAY-105, PAY-106, 2305, payments-web#44, and 2307 removed.
 *
 * Provenance: written by hand to the shapes the jira, ado and github commands
 * return (their fixtures and the vendors' REST references), invented from the
 * docs rather than captured. Every host is a placeholder, every name made up.
 */

const VERSION = '0.1.0-alpha.1';
const JIRA = 'https://jira.imagile.dev';
const ADO = 'https://ado.imagile.dev/DefaultCollection';
const GHE = 'https://ghe.imagile.dev';
const GHE_API = `${GHE}/api/v3`;

const envelope = (command: string, data: unknown, connection: string, inputs: Record<string, string> = {}) => ({
  ok: true,
  data,
  error: null,
  meta: {
    command,
    durationMs: 412,
    version: VERSION,
    context: {
      connection: { value: connection, source: 'default', default: 'named' },
      ...(Object.keys(inputs).length ? { inputs: Object.fromEntries(Object.entries(inputs).map(([k, value]) => [k, { value, source: 'dossier' }])) } : {}),
    },
  },
});

// Jira Data Center ---------------------------------------------------------

const jiraUser = (name: string, displayName: string) => ({ self: `${JIRA}/rest/api/2/user?username=${name}`, name, key: name, displayName, active: true });
const SMITH = jiraUser('jsmith', 'J. Smith');
const CHEN = jiraUser('achen', 'A. Chen');
const PATEL = jiraUser('rpatel', 'R. Patel');

const STATUS = {
  todo: { name: 'To Do', id: '10000', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
  progress: { name: 'In Progress', id: '3', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  review: { name: 'In Review', id: '10100', statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  done: { name: 'Done', id: '10001', statusCategory: { id: 3, key: 'done', name: 'Done' } },
};
const TYPE = {
  epic: { name: 'Epic', id: '10000', subtask: false },
  story: { name: 'Story', id: '10001', subtask: false },
  bug: { name: 'Bug', id: '1', subtask: false },
  subtask: { name: 'Sub-task', id: '10003', subtask: true },
};

/** Data Center's sprint field, as /rest/api/2 writes it: one string per sprint. */
const sprint = (n: number, state: 'CLOSED' | 'ACTIVE' | 'FUTURE', start: string, end: string) =>
  `com.atlassian.greenhopper.service.sprint.Sprint@6f3a${n}[id=${n},rapidViewId=7,state=${state},name=Sprint ${n},startDate=${start},endDate=${end},completeDate=${state === 'CLOSED' ? end : '<null>'},sequence=${n},goal=]`;
const S41 = sprint(41, 'CLOSED', '2026-09-21T09:00:00.000Z', '2026-10-02T17:00:00.000Z');
const S42 = sprint(42, 'ACTIVE', '2026-10-05T09:00:00.000Z', '2026-10-16T17:00:00.000Z');

const link = (kind: 'Blocks' | 'Relates', way: 'outward' | 'inward', key: string, id: number) => ({
  id: String(id),
  type: kind === 'Blocks' ? { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' } : { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  [way === 'outward' ? 'outwardIssue' : 'inwardIssue']: { key, fields: {} },
});

interface JiraSpec {
  key: string;
  type: keyof typeof TYPE;
  summary: string;
  status: keyof typeof STATUS;
  assignee?: typeof SMITH;
  points?: number | null;
  sprints?: string[];
  epic?: string;
  parent?: string;
  subtasks?: string[];
  links?: ReturnType<typeof link>[];
  created: string;
  updated: string;
  resolved?: string;
  description?: string;
  priority?: string;
  labels?: string[];
}

const jiraIssue = (s: JiraSpec, n: number) => ({
  expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
  id: String(20100 + n),
  self: `${JIRA}/rest/api/2/issue/${20100 + n}`,
  key: s.key,
  fields: {
    summary: s.summary,
    description: s.description ?? null,
    issuetype: { self: `${JIRA}/rest/api/2/issuetype/${TYPE[s.type].id}`, ...TYPE[s.type] },
    status: { self: `${JIRA}/rest/api/2/status/${STATUS[s.status].id}`, ...STATUS[s.status] },
    resolution: s.resolved ? { self: `${JIRA}/rest/api/2/resolution/10000`, id: '10000', name: 'Done' } : null,
    resolutiondate: s.resolved ?? null,
    priority: { self: `${JIRA}/rest/api/2/priority/3`, name: s.priority ?? 'Medium', id: '3' },
    assignee: s.assignee ?? null,
    reporter: PATEL,
    labels: s.labels ?? ['payments'],
    project: { self: `${JIRA}/rest/api/2/project/10200`, id: '10200', key: 'PAY', name: 'Payments' },
    created: s.created,
    updated: s.updated,
    duedate: null,
    timeoriginalestimate: null,
    issuelinks: s.links ?? [],
    subtasks: (s.subtasks ?? []).map((key) => ({ key, fields: {} })),
    ...(s.parent ? { parent: { key: s.parent, fields: {} } } : {}),
    // Custom fields the connection registers by name (customFields), as get-issue prints them.
    'Story Points': s.points ?? null,
    Sprint: s.sprints ?? null,
    'Epic Link': s.epic ?? null,
  },
});

const jiraSpecs: JiraSpec[] = [
  { key: 'PAY-100', type: 'epic', summary: 'Card payments v2', status: 'progress', assignee: PATEL, created: '2026-08-31T10:00:00.000+0000', updated: '2026-10-09T11:00:00.000+0000', description: 'h2. Goal\nStore cards as tokens and charge them without the PAN leaving the edge.' },
  {
    key: 'PAY-101', type: 'story', summary: 'Tokenise card numbers at the edge', status: 'progress', assignee: SMITH, points: 5, sprints: [S42], epic: 'PAY-100', subtasks: ['PAY-106'],
    links: [link('Blocks', 'outward', 'PAY-102', 30001)], created: '2026-09-14T09:30:00.000+0000', updated: '2026-10-08T16:10:00.000+0000', priority: 'High',
    description: 'The gateway swaps the PAN for a token before anything is logged.\n\n* PAN never reaches the app tier\n* Token format agreed with the vault team',
  },
  { key: 'PAY-102', type: 'story', summary: 'Store tokens in the vault', status: 'todo', assignee: CHEN, points: 3, sprints: [S42], epic: 'PAY-100', links: [link('Blocks', 'inward', 'PAY-101', 30001), link('Blocks', 'outward', 'PAY-103', 30002)], created: '2026-09-14T09:35:00.000+0000', updated: '2026-10-05T09:10:00.000+0000' },
  { key: 'PAY-103', type: 'story', summary: 'Charge a stored token', status: 'todo', points: 8, sprints: [S42], epic: 'PAY-100', links: [link('Blocks', 'inward', 'PAY-102', 30002)], created: '2026-09-14T09:40:00.000+0000', updated: '2026-10-05T09:10:00.000+0000' },
  { key: 'PAY-104', type: 'bug', summary: 'Refund total rounds half-cents down', status: 'progress', assignee: CHEN, points: 2, sprints: [S41, S42], created: '2026-09-22T13:00:00.000+0000', updated: '2026-10-07T10:20:00.000+0000', priority: 'High', labels: ['payments', 'refunds'] },
  { key: 'PAY-105', type: 'story', summary: 'Show the last four digits on receipts', status: 'done', assignee: SMITH, points: 3, sprints: [S42], epic: 'PAY-100', created: '2026-09-15T08:00:00.000+0000', updated: '2026-10-09T15:30:00.000+0000', resolved: '2026-10-09T15:30:00.000+0000' },
  { key: 'PAY-106', type: 'subtask', summary: 'Add the tokeniser to the gateway config', status: 'done', assignee: SMITH, parent: 'PAY-101', sprints: [S42], created: '2026-10-05T10:00:00.000+0000', updated: '2026-10-07T12:00:00.000+0000', resolved: '2026-10-07T12:00:00.000+0000' },
  { key: 'PAY-107', type: 'story', summary: 'Retry declined charges once', status: 'todo', sprints: [S42], links: [link('Relates', 'outward', 'PAY-103', 30003)], created: '2026-10-08T13:45:00.000+0000', updated: '2026-10-08T14:00:00.000+0000' },
];

const history = (id: number, author: typeof SMITH, created: string, items: Array<Record<string, unknown>>) => ({ id: String(id), author, created, items });
const status = (from: keyof typeof STATUS, to: keyof typeof STATUS) => ({ field: 'status', fieldtype: 'jira', from: STATUS[from].id, fromString: STATUS[from].name, to: STATUS[to].id, toString: STATUS[to].name });
const sprintChange = (from: string, to: string) => ({ field: 'Sprint', fieldtype: 'custom', from: null, fromString: from, to: null, toString: to });

const changelogs: Record<string, unknown[]> = {
  'PAY-101': [history(40101, SMITH, '2026-10-06T09:15:00.000+0000', [status('todo', 'progress')])],
  'PAY-104': [
    history(40201, CHEN, '2026-09-29T10:00:00.000+0000', [status('todo', 'progress')]),
    history(40202, PATEL, '2026-10-05T09:05:00.000+0000', [sprintChange('Sprint 41', 'Sprint 41, Sprint 42')]),
  ],
  'PAY-105': [
    history(40301, SMITH, '2026-10-06T11:00:00.000+0000', [status('todo', 'progress')]),
    history(40302, SMITH, '2026-10-08T17:00:00.000+0000', [status('progress', 'review')]),
    history(40303, CHEN, '2026-10-09T15:30:00.000+0000', [status('review', 'done')]),
  ],
  'PAY-107': [history(40401, PATEL, '2026-10-08T14:00:00.000+0000', [sprintChange('', 'Sprint 42')])],
};

// Azure DevOps Server --------------------------------------------------------

const identity = (user: string, displayName: string) => ({ displayName, url: `https://ado.imagile.dev/_apis/Identities/abc12345-0000-0000-0000-0000000000${user.length}0`, id: `abc12345-0000-0000-0000-0000000000${user.length}0`, uniqueName: `IMAGILE\\${user}`, descriptor: `win.abc12345${user}` });
const OKAFOR = identity('dokafor', 'D. Okafor');
const LIND = identity('mlind', 'M. Lind');
const NAKAMURA = identity('knakamura', 'K. Nakamura');

const relation = (rel: string, id: number) => ({ rel, url: `${ADO}/_apis/wit/workItems/${id}`, attributes: { isLocked: false, name: rel.split('.').pop() } });

interface AdoSpec {
  id: number;
  type: string;
  title: string;
  state: string;
  reason: string;
  assignee?: typeof OKAFOR;
  iteration: string;
  points?: number;
  hours?: number;
  teamPoints?: number;
  relations?: ReturnType<typeof relation>[];
  created: string;
  changed: string;
  closed?: string;
  tags?: string;
  description?: string;
}

const adoItem = (s: AdoSpec) => ({
  id: s.id,
  rev: 6,
  fields: {
    'System.AreaPath': 'Payments\\Settlement',
    'System.TeamProject': 'Payments',
    'System.IterationPath': s.iteration,
    'System.WorkItemType': s.type,
    'System.State': s.state,
    'System.Reason': s.reason,
    ...(s.assignee ? { 'System.AssignedTo': s.assignee } : {}),
    'System.CreatedDate': s.created,
    'System.CreatedBy': NAKAMURA,
    'System.ChangedDate': s.changed,
    'System.ChangedBy': s.assignee ?? NAKAMURA,
    'System.Title': s.title,
    ...(s.description ? { 'System.Description': s.description } : {}),
    'Microsoft.VSTS.Common.Priority': 2,
    ...(s.points !== undefined ? { 'Microsoft.VSTS.Scheduling.StoryPoints': s.points } : {}),
    ...(s.hours !== undefined ? { 'Microsoft.VSTS.Scheduling.OriginalEstimate': s.hours } : {}),
    ...(s.teamPoints !== undefined ? { 'Custom.TeamPoints': s.teamPoints } : {}),
    ...(s.closed ? { 'Microsoft.VSTS.Common.ClosedDate': s.closed } : {}),
    'System.Tags': s.tags ?? 'settlement',
  },
  relations: s.relations ?? [],
  _links: { self: { href: `${ADO}/_apis/wit/workItems/${s.id}` }, html: { href: `${ADO}/Payments/_workitems/edit/${s.id}` } },
  url: `${ADO}/_apis/wit/workItems/${s.id}`,
});

const S = 'Payments\\Sprint 42';
const adoSpecs: AdoSpec[] = [
  { id: 2301, type: 'Feature', title: 'Settlement reports', state: 'Active', reason: 'Implementation started', assignee: NAKAMURA, iteration: 'Payments', relations: [relation('System.LinkTypes.Hierarchy-Forward', 2302), relation('System.LinkTypes.Hierarchy-Forward', 2303)], created: '2026-08-24T14:00:00Z', changed: '2026-10-05T09:30:00Z' },
  { id: 2302, type: 'User Story', title: 'Export the daily settlement CSV', state: 'Active', reason: 'Implementation started', assignee: OKAFOR, iteration: S, points: 5, teamPoints: 5, relations: [relation('System.LinkTypes.Hierarchy-Reverse', 2301), relation('System.LinkTypes.Dependency-Forward', 2303), relation('System.LinkTypes.Hierarchy-Forward', 2305)], created: '2026-09-10T10:00:00Z', changed: '2026-10-06T08:45:00Z', description: '<div>One CSV per merchant, written at 02:00 UTC.</div>' },
  { id: 2303, type: 'User Story', title: 'Email the settlement report to finance', state: 'New', reason: 'New', iteration: S, points: 3, teamPoints: 3, relations: [relation('System.LinkTypes.Hierarchy-Reverse', 2301), relation('System.LinkTypes.Dependency-Reverse', 2302)], created: '2026-09-10T10:05:00Z', changed: '2026-10-05T09:30:00Z' },
  { id: 2304, type: 'Bug', title: 'Settlement totals are a day early in UTC-5', state: 'Active', reason: 'Approved', assignee: LIND, iteration: S, points: 2, teamPoints: 2, created: '2026-09-24T16:20:00Z', changed: '2026-10-07T11:00:00Z', tags: 'settlement; timezones' },
  { id: 2305, type: 'Task', title: 'Schedule the export job', state: 'Closed', reason: 'Completed', assignee: OKAFOR, iteration: S, hours: 4, relations: [relation('System.LinkTypes.Hierarchy-Reverse', 2302)], created: '2026-10-05T10:00:00Z', changed: '2026-10-08T13:00:00Z', closed: '2026-10-08T13:00:00Z' },
  { id: 2306, type: 'User Story', title: 'Reconcile chargebacks against settlements', state: 'New', reason: 'New', iteration: S, points: 5, created: '2026-10-02T09:00:00Z', changed: '2026-10-09T10:15:00Z' },
  { id: 2307, type: 'Bug', title: 'Retire the legacy settlement endpoint', state: 'Removed', reason: 'Removed from the backlog', iteration: S, points: 1, created: '2026-09-01T09:00:00Z', changed: '2026-10-07T09:00:00Z', closed: '2026-10-07T09:00:00Z' },
];

const revision = (id: number, rev: number, at: string, by: typeof OKAFOR, state: string, iteration: string) => ({
  id,
  rev,
  fields: { 'System.WorkItemType': id === 2304 ? 'Bug' : 'User Story', 'System.State': state, 'System.IterationPath': iteration, 'System.ChangedDate': at, 'System.ChangedBy': by },
  url: `${ADO}/_apis/wit/workItems/${id}/revisions/${rev}`,
});

const revisions: Record<number, unknown[]> = {
  2302: [revision(2302, 1, '2026-09-10T10:00:00Z', NAKAMURA, 'New', 'Payments'), revision(2302, 2, '2026-09-30T15:00:00Z', NAKAMURA, 'New', S), revision(2302, 3, '2026-10-06T08:45:00Z', OKAFOR, 'Active', S)],
  2304: [revision(2304, 1, '2026-09-24T16:20:00Z', NAKAMURA, 'New', 'Payments\\Sprint 41'), revision(2304, 2, '2026-09-28T09:00:00Z', LIND, 'Active', 'Payments\\Sprint 41'), revision(2304, 3, '2026-10-05T08:30:00Z', NAKAMURA, 'Active', S)],
  2306: [revision(2306, 1, '2026-10-02T09:00:00Z', NAKAMURA, 'New', 'Payments'), revision(2306, 2, '2026-10-09T10:15:00Z', NAKAMURA, 'New', S)],
};

const node = (name: string, start: string, finish: string, n: number) => ({
  id: n,
  identifier: `abc12345-0000-0000-0000-0000000004${n}`,
  name,
  structureType: 'iteration',
  hasChildren: false,
  path: `\\Payments\\Iteration\\${name}`,
  attributes: { startDate: start, finishDate: finish },
  url: `${ADO}/Payments/_apis/wit/classificationNodes/Iterations/${encodeURIComponent(name)}`,
});
const iterations = {
  id: 40,
  identifier: 'abc12345-0000-0000-0000-000000000400',
  name: 'Payments',
  structureType: 'iteration',
  hasChildren: true,
  path: '\\Payments\\Iteration',
  children: [node('Sprint 41', '2026-09-21T00:00:00Z', '2026-10-02T00:00:00Z', 41), node('Sprint 42', '2026-10-05T00:00:00Z', '2026-10-16T00:00:00Z', 42), node('Sprint 43', '2026-10-19T00:00:00Z', '2026-10-30T00:00:00Z', 43)],
  url: `${ADO}/Payments/_apis/wit/classificationNodes/Iterations`,
};

// GitHub Enterprise ----------------------------------------------------------

const ghUser = (login: string, id: number) => ({ login, id, avatar_url: `${GHE}/avatars/u/${id}`, type: 'User' });
const ADA = ghUser('ada-dev', 11);
const BO = ghUser('bo-web', 12);
const ISSUE_TYPE = { Feature: { id: 3, name: 'Feature' }, Task: { id: 1, name: 'Task' }, Bug: { id: 2, name: 'Bug' } };

interface GhSpec {
  number: number;
  title: string;
  type: keyof typeof ISSUE_TYPE;
  state: 'open' | 'closed';
  assignee?: typeof ADA;
  labels: string[];
  parent?: number;
  subs?: number[];
  created: string;
  updated: string;
  closed?: string;
  body: string;
}

const REPO = 'imagile/payments-web';
const ghIssue = (s: GhSpec): Record<string, unknown> => ({
  id: 9000 + s.number,
  number: s.number,
  title: s.title,
  state: s.state,
  state_reason: s.state === 'closed' ? 'completed' : null,
  locked: false,
  body: s.body,
  html_url: `${GHE}/${REPO}/issues/${s.number}`,
  repository_url: `${GHE_API}/repos/${REPO}`,
  user: ADA,
  labels: s.labels.map((name, i) => ({ id: 500 + i, name, color: 'd73a4a', description: null })),
  assignees: s.assignee ? [s.assignee] : [],
  type: { ...ISSUE_TYPE[s.type], node_id: `IT_kwDOabc12345${s.type}`, description: null, color: 'gray' },
  sub_issues_summary: { total: s.subs?.length ?? 0, completed: 0, percent_completed: 0 },
  parent_issue_url: s.parent ? `${GHE_API}/repos/${REPO}/issues/${s.parent}` : null,
  created_at: s.created,
  updated_at: s.updated,
  closed_at: s.closed ?? null,
});

const ghSpecs: GhSpec[] = [
  { number: 41, title: 'Checkout accepts saved cards', type: 'Feature', state: 'open', assignee: ADA, labels: ['checkout'], subs: [42], created: '2026-09-28T12:00:00Z', updated: '2026-10-08T09:00:00Z', body: 'Customers pick a saved card at checkout instead of typing it again.\n\n- [ ] Card picker\n- [ ] 3-D Secure on saved cards' },
  { number: 42, title: 'Saved-card picker component', type: 'Task', state: 'open', assignee: BO, labels: ['checkout', 'ui'], parent: 41, created: '2026-09-28T12:10:00Z', updated: '2026-10-09T14:00:00Z', body: 'A list of saved cards with the last four digits and expiry.' },
  { number: 43, title: 'Card form loses focus on Safari', type: 'Bug', state: 'open', assignee: BO, labels: ['bug', 'safari'], created: '2026-10-07T08:30:00Z', updated: '2026-10-07T08:45:00Z', body: 'Typing the expiry moves focus back to the card number field on Safari 18.' },
  { number: 44, title: 'Receipt page shows the wrong currency symbol', type: 'Bug', state: 'closed', assignee: ADA, labels: ['bug'], created: '2026-10-01T10:00:00Z', updated: '2026-10-12T16:00:00Z', closed: '2026-10-12T16:00:00Z', body: 'EUR receipts show $.' },
  { number: 45, title: 'End-to-end test for 3-D Secure', type: 'Task', state: 'open', labels: ['testing'], created: '2026-10-05T11:00:00Z', updated: '2026-10-05T11:00:00Z', body: 'Cover the challenge flow with the issuer simulator.' },
];

const board: Record<number, { status: string; estimate?: number; added: string }> = {
  41: { status: 'In Progress', estimate: 5, added: '2026-09-28T12:05:00Z' },
  42: { status: 'In Review', estimate: 3, added: '2026-09-28T12:15:00Z' },
  43: { status: 'Todo', estimate: 2, added: '2026-10-07T09:00:00Z' },
  44: { status: 'Done', estimate: 1, added: '2026-10-01T10:05:00Z' },
  45: { status: 'Todo', added: '2026-10-05T11:05:00Z' },
};
const OPTIONS: Record<string, string> = { Todo: 'f75ad846', 'In Progress': '47fc9ee4', 'In Review': 'a1b2c3d4', Done: '98236657' };

const projectItem = (s: GhSpec) => {
  const b = board[s.number]!;
  return {
    id: `PVTI_abc12345${s.number}`,
    type: 'ISSUE',
    isArchived: false,
    createdAt: b.added,
    updatedAt: s.updated,
    content: { __typename: 'Issue', number: s.number, title: s.title, state: s.state.toUpperCase(), url: `${GHE}/${REPO}/issues/${s.number}`, updatedAt: s.updated, repository: { nameWithOwner: REPO } },
    fieldValues: [
      { __typename: 'ProjectV2ItemFieldTextValue', text: s.title, field: { id: 'PVTF_abc12345title', name: 'Title' } },
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: b.status, optionId: OPTIONS[b.status], field: { id: 'PVTSSF_abc12345', name: 'Status' } },
      ...(b.estimate === undefined ? [] : [{ __typename: 'ProjectV2ItemFieldNumberValue', number: b.estimate, field: { id: 'PVTF_abc12345', name: 'Estimate' } }]),
      { __typename: 'ProjectV2ItemFieldIterationValue', title: 'Sprint 42', iterationId: 'cfc16e4d', startDate: '2026-10-05', duration: 12, field: { id: 'PVTIF_abc12345', name: 'Sprint' } },
    ],
  };
};

const timeline44 = [
  { id: 7001, node_id: 'LE_kwDOabc123457001', event: 'labeled', actor: ADA, created_at: '2026-10-01T10:01:00Z', label: { name: 'bug', color: 'd73a4a' } },
  { id: 7002, node_id: 'CE_kwDOabc123457002', event: 'closed', actor: ADA, created_at: '2026-10-12T16:00:00Z', state_reason: 'completed', commit_id: null },
];

// The input, in the order a sync would fetch it --------------------------------

const GH = { owner: 'imagile', repo: 'payments-web' };

/** The sprint's input to `util owi map`: one envelope per line, as appending each command's output to one file makes it. */
export const sprintEnvelopes: unknown[] = [
  envelope('jira get-issue', { issues: jiraSpecs.map(jiraIssue), errors: [] }, 'corp-jira'),
  ...Object.entries(changelogs).map(([key, entries]) => ({ key, history: envelope('jira get-changelog', entries, 'corp-jira') })),
  envelope('ado work list-iterations', iterations, 'corp-ado', { collection: 'DefaultCollection', project: 'Payments' }),
  envelope('ado work get-batch', { count: adoSpecs.length, value: adoSpecs.map(adoItem), missing: [] }, 'corp-ado', { collection: 'DefaultCollection', project: 'Payments' }),
  ...Object.values(revisions).map((value) => envelope('ado work revisions', value, 'corp-ado', { collection: 'DefaultCollection', project: 'Payments' })),
  envelope('github get-issue', { issues: ghSpecs.map((s) => (s.subs ? { ...ghIssue(s), sub_issues: s.subs.map((n) => ghIssue(ghSpecs.find((g) => g.number === n)!)) } : ghIssue(s))), errors: [] }, 'github', GH),
  { key: '44', history: envelope('github issue-events', timeline44, 'github', GH) },
  envelope('github projects list-items', ghSpecs.map(projectItem), 'github', { owner: 'imagile' }),
];

/** The same input as JSON Lines. */
export const sprintJsonl = `${sprintEnvelopes.map((e) => JSON.stringify(e)).join('\n')}\n`;

/** PAY-104's changelog alone, the envelope `jira get-changelog --key PAY-104` prints, for the --key example. */
export const pay104Changelog = `${JSON.stringify(envelope('jira get-changelog', changelogs['PAY-104'], 'corp-jira'), null, 2)}\n`;

/** The Azure DevOps batch alone, for the example that points estimate at a field of the team's own. */
export const adoBatch = `${JSON.stringify(sprintEnvelopes.find((e) => (e as { meta?: { command?: string } }).meta?.command === 'ado work get-batch'), null, 2)}\n`;
