/**
 * Pull requests, builds and deployments, as the toil commands that read them
 * print them: each source's own REST shape, trimmed to the fields the
 * dashboard reads plus enough around them to look like the real thing. Shapes
 * follow the vendors' REST references and toil's own command code:
 *
 * - Bitbucket Data Center pull requests (`bitbucket list-prs`):
 *   https://developer.atlassian.com/server/bitbucket/rest/ (Pull Requests).
 * - Jenkins builds of a multibranch job (`jenkins pipeline list-runs`), with
 *   the `tree` fields src/areas/jenkins/client.ts asks for.
 * - Azure DevOps Server pull requests and builds (`ado repo list-prs`,
 *   `ado pipeline list-runs`): https://learn.microsoft.com/rest/api/azure/devops/
 *   (Git Pull Requests, Build Builds).
 * - GitHub pull requests and check runs (`github list-prs`,
 *   `github list-checks`): https://docs.github.com/rest (Pulls, Check Runs).
 * - OpenShift Deployments (`openshift deployments`), as the command summarises
 *   them (src/areas/openshift/workloads.ts).
 *
 * What the dashboards should show: PAY-105 and PAY-106 merged and running in
 * dev but not prod, PAY-101's build failing; settlement's export job deployed
 * to test while prod runs last week's; checkout's currency fix in staging, and
 * a failing Safari check on payments-web#43's draft. Invented, not captured;
 * every host is a placeholder and every commit made up. Every build here goes
 * green or red on cue, which no real pipeline has ever agreed to.
 */

const ms = (iso: string) => Date.parse(iso);
const sha = (short: string) => short.padEnd(40, '0');

// card-payments: Bitbucket Data Center, Jenkins, OpenShift -------------------------

const BB = 'https://bitbucket.imagile.dev';
const JENKINS = 'https://jenkins.imagile.dev';
const bbUser = (name: string, displayName: string) => ({ name, id: name.length * 101, displayName, active: true, slug: name, type: 'NORMAL' });
const bbRepo = { slug: 'payments-core', name: 'payments-core', project: { key: 'PAY', name: 'Payments' } };

interface BbSpec {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED';
  author: ReturnType<typeof bbUser>;
  branch: string;
  head: string;
  created: string;
  closed?: string;
  merge?: string;
}

const bbPr = (s: BbSpec) => ({
  id: s.id,
  version: 2,
  title: s.title,
  ...(s.description ? { description: s.description } : {}),
  state: s.state,
  open: s.state === 'OPEN',
  closed: s.state !== 'OPEN',
  createdDate: ms(s.created),
  updatedDate: ms(s.closed ?? s.created),
  ...(s.closed ? { closedDate: ms(s.closed) } : {}),
  fromRef: { id: `refs/heads/${s.branch}`, displayId: s.branch, latestCommit: sha(s.head), repository: bbRepo },
  toRef: { id: 'refs/heads/master', displayId: 'master', latestCommit: sha('f00d000'), repository: bbRepo },
  locked: false,
  author: { user: s.author, role: 'AUTHOR', approved: false, status: 'UNAPPROVED' },
  reviewers: [],
  participants: [],
  ...(s.merge ? { properties: { mergeCommit: { displayId: s.merge, id: sha(s.merge) } } } : {}),
  links: { self: [{ href: `${BB}/projects/PAY/repos/payments-core/pull-requests/${s.id}` }] },
});

const SMITH = bbUser('jsmith', 'J. Smith');
const CHEN = bbUser('achen', 'A. Chen');

export const BITBUCKET_PRS = [
  bbPr({ id: 311, title: 'PAY-101 Tokenise PANs in the edge proxy', description: 'First slice of Card payments v2 (PAY-100).', state: 'OPEN', author: SMITH, branch: 'feature/PAY-101-tokenise', head: 'e91a4c2', created: '2026-10-12T15:30:00.000Z' }),
  bbPr({ id: 305, title: 'PAY-104 Round refund totals half-up', state: 'OPEN', author: CHEN, branch: 'bugfix/PAY-104-rounding', head: '3c5d7e1', created: '2026-10-07T10:15:00.000Z' }),
  bbPr({ id: 298, title: 'PAY-105 Show the last four digits on receipts', state: 'MERGED', author: SMITH, branch: 'feature/PAY-105-last-four', head: '8a6b2f0', created: '2026-10-08T09:00:00.000Z', closed: '2026-10-09T14:50:00.000Z', merge: '4e1d2a9' }),
  bbPr({ id: 296, title: 'PAY-106 Register the tokeniser with the gateway', state: 'MERGED', author: SMITH, branch: 'feature/PAY-106-gateway', head: '2d9e8b4', created: '2026-10-06T13:00:00.000Z', closed: '2026-10-07T11:40:00.000Z', merge: '7b3c9d2' }),
  bbPr({ id: 290, title: 'Bump the HTTP client to 5.3', state: 'MERGED', author: CHEN, branch: 'chore/http-client', head: '0f4e6a3', created: '2026-09-29T09:00:00.000Z', closed: '2026-09-30T10:00:00.000Z', merge: '1a2b3c4' }),
];

const jenkinsRun = (pr: number, n: number, result: 'SUCCESS' | 'FAILURE' | null, at: string, durationMs: number) => ({
  number: n,
  url: `${JENKINS}/job/payments-core/job/PR-${pr}/${n}/`,
  result,
  duration: result === null ? 0 : durationMs,
  timestamp: ms(at),
  building: result === null,
  displayName: `#${n}`,
  fullDisplayName: `payments-core » PR-${pr} #${n}`,
  description: null,
  id: String(n),
  queueId: 9000 + pr * 10 + n,
});

/** `jenkins pipeline list-runs --name payments-core/PR-<id>`, newest first, per pull request. */
export const JENKINS_RUNS: Record<number, unknown[]> = {
  311: [jenkinsRun(311, 2, 'FAILURE', '2026-10-12T16:05:00.000Z', 412_000), jenkinsRun(311, 1, 'FAILURE', '2026-10-12T15:35:00.000Z', 398_000)],
  305: [jenkinsRun(305, 1, 'SUCCESS', '2026-10-07T10:40:00.000Z', 455_000)],
  298: [jenkinsRun(298, 3, 'SUCCESS', '2026-10-09T14:20:00.000Z', 441_000)],
  296: [jenkinsRun(296, 1, 'SUCCESS', '2026-10-07T11:10:00.000Z', 430_000)],
  290: [jenkinsRun(290, 1, 'SUCCESS', '2026-09-30T09:30:00.000Z', 420_000)],
};

const deployment = (name: string, image: string, version: string, ready: number, desired: number, age: string) => ({
  name,
  ready: `${ready}/${desired}`,
  desiredReplicas: desired,
  readyReplicas: ready,
  updatedReplicas: ready,
  availableReplicas: ready,
  unavailableReplicas: desired - ready,
  age,
  images: [{ name, image }],
  strategy: 'RollingUpdate',
  labels: { 'app.kubernetes.io/name': name, 'app.kubernetes.io/version': version },
});
const ns = (namespace: string, deployments: unknown[]) => ({ namespace, kind: 'Deployment', count: deployments.length, deployments });

/** `openshift deployments --env <env> --namespace <ns>`, per environment. */
export const OPENSHIFT: Record<string, unknown> = {
  'payments-dev': ns('payments-dev', [deployment('payments-core', 'artifactory.imagile.dev/payments/payments-core:1.14.0-4e1d2a9', '1.14.0', 2, 2, '3d')]),
  'payments-prod': ns('payments-prod', [deployment('payments-core', 'artifactory.imagile.dev/payments/payments-core:1.13.2-1a2b3c4', '1.13.2', 3, 3, '13d')]),
  'checkout-staging': ns('checkout-staging', [deployment('payments-web', 'artifactory.imagile.dev/checkout/payments-web:2026.10.12-5a7e3f1', '2026.10.12', 2, 2, '18h')]),
  'checkout-prod': ns('checkout-prod', [deployment('payments-web', 'artifactory.imagile.dev/checkout/payments-web:2026.10.02-1c9b8e4', '2026.10.02', 4, 4, '11d')]),
};

// settlement: Azure Repos, Azure Pipelines ----------------------------------------

const ADO = 'https://ado.imagile.dev/DefaultCollection';
const adoIdentity = (user: string, displayName: string) => ({ displayName, uniqueName: `IMAGILE\\${user}`, id: `abc12345-0000-0000-0000-0000000000${user.length}0` });
const OKAFOR = adoIdentity('dokafor', 'D. Okafor');
const adoRepo = { id: 'abc12345-0000-0000-0000-000000000500', name: 'settlement', url: `${ADO}/Payments/_apis/git/repositories/settlement`, webUrl: `${ADO}/Payments/_git/settlement`, project: { name: 'Payments' } };

interface AdoPrSpec {
  id: number;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  branch: string;
  created: string;
  closed?: string;
  merge?: string;
  head: string;
}

const adoPr = (s: AdoPrSpec) => ({
  repository: adoRepo,
  pullRequestId: s.id,
  codeReviewId: s.id,
  status: s.status,
  createdBy: OKAFOR,
  creationDate: s.created,
  ...(s.closed ? { closedDate: s.closed } : {}),
  title: s.title,
  description: s.description,
  sourceRefName: `refs/heads/${s.branch}`,
  targetRefName: 'refs/heads/main',
  mergeStatus: 'succeeded',
  isDraft: false,
  lastMergeSourceCommit: { commitId: sha(s.head) },
  ...(s.merge ? { lastMergeCommit: { commitId: sha(s.merge) } } : {}),
  url: `${adoRepo.url}/pullRequests/${s.id}`,
});

export const ADO_PRS = [
  adoPr({ id: 87, title: 'Write the daily settlement CSV', description: 'For #2302. One file per merchant, written at 02:00 UTC.', status: 'active', branch: 'feature/2302-settlement-csv', head: '87ab3e2', created: '2026-10-12T09:20:00Z' }),
  adoPr({ id: 84, title: 'Schedule the settlement export job', description: 'Task #2305.', status: 'completed', branch: 'feature/2305-schedule', head: '84cd1f9', created: '2026-10-07T16:00:00Z', closed: '2026-10-08T12:30:00Z', merge: 'c84e5f0' }),
  adoPr({ id: 80, title: 'Settlement job skeleton', description: 'The empty job and its pipeline.', status: 'completed', branch: 'feature/skeleton', head: '80ef2a1', created: '2026-09-29T10:00:00Z', closed: '2026-10-01T11:00:00Z', merge: 'b80a1d2' }),
];

interface BuildSpec {
  id: number;
  definition: { id: number; name: string };
  number: string;
  status: 'completed' | 'inProgress';
  result?: 'succeeded' | 'failed';
  branch: string;
  commit: string;
  at: string;
  pr?: number;
  environment?: string;
}

const adoBuild = (s: BuildSpec) => ({
  id: s.id,
  buildNumber: s.number,
  status: s.status,
  ...(s.result ? { result: s.result } : {}),
  queueTime: s.at,
  startTime: s.at,
  ...(s.status === 'completed' ? { finishTime: s.at } : {}),
  sourceBranch: s.branch,
  sourceVersion: sha(s.commit),
  definition: { ...s.definition, path: '\\' },
  project: { name: 'Payments' },
  reason: s.pr ? 'pullRequest' : 'individualCI',
  ...(s.pr ? { triggerInfo: { 'pr.number': String(s.pr), 'pr.sourceBranch': `refs/heads/feature/${s.pr}` } } : {}),
  ...(s.environment ? { templateParameters: { environment: s.environment } } : {}),
  requestedFor: OKAFOR,
  _links: { web: { href: `${ADO}/Payments/_build/results?buildId=${s.id}` } },
  url: `${ADO}/Payments/_apis/build/Builds/${s.id}`,
});

const CI = { id: 12, name: 'settlement-ci' };
const DEPLOY = { id: 13, name: 'settlement-deploy' };

/** `ado pipeline list-runs --name settlement-ci`, newest first. */
export const ADO_CI_RUNS = [
  adoBuild({ id: 5530, definition: CI, number: '20261013.1', status: 'inProgress', branch: 'refs/pull/87/merge', commit: '87ab3e2', at: '2026-10-13T07:55:00Z', pr: 87 }),
  adoBuild({ id: 5512, definition: CI, number: '20261008.3', status: 'completed', result: 'succeeded', branch: 'refs/pull/84/merge', commit: '84cd1f9', at: '2026-10-08T12:10:00Z', pr: 84 }),
  adoBuild({ id: 5461, definition: CI, number: '20261001.2', status: 'completed', result: 'succeeded', branch: 'refs/pull/80/merge', commit: '80ef2a1', at: '2026-10-01T10:30:00Z', pr: 80 }),
];

/** `ado pipeline list-runs --name settlement-deploy`, newest first: one run per environment it deployed to. */
export const ADO_DEPLOY_RUNS = [
  adoBuild({ id: 5521, definition: DEPLOY, number: '20261008.1', status: 'completed', result: 'succeeded', branch: 'refs/heads/main', commit: 'c84e5f0', at: '2026-10-08T14:00:00Z', environment: 'test' }),
  adoBuild({ id: 5470, definition: DEPLOY, number: '20261002.1', status: 'completed', result: 'succeeded', branch: 'refs/heads/main', commit: 'b80a1d2', at: '2026-10-02T16:00:00Z', environment: 'prod' }),
  adoBuild({ id: 5466, definition: DEPLOY, number: '20261001.1', status: 'completed', result: 'succeeded', branch: 'refs/heads/main', commit: 'b80a1d2', at: '2026-10-01T13:00:00Z', environment: 'test' }),
];

// checkout-web: GitHub pull requests and Actions checks ------------------------------

const GHE = 'https://ghe.imagile.dev';
const ghUser = (login: string, id: number) => ({ login, id, avatar_url: `${GHE}/avatars/u/${id}`, type: 'User' });
const ADA = ghUser('ada-dev', 11);
const BO = ghUser('bo-web', 12);

interface GhPrSpec {
  number: number;
  title: string;
  body: string;
  user: typeof ADA;
  draft?: boolean;
  head: string;
  created: string;
  merged?: string;
  merge: string;
}

const ghPr = (s: GhPrSpec) => ({
  id: 7000 + s.number,
  number: s.number,
  state: s.merged ? 'closed' : 'open',
  locked: false,
  title: s.title,
  user: s.user,
  body: s.body,
  draft: s.draft ?? false,
  html_url: `${GHE}/imagile/payments-web/pull/${s.number}`,
  created_at: s.created,
  updated_at: s.merged ?? s.created,
  closed_at: s.merged ?? null,
  merged_at: s.merged ?? null,
  // GitHub sets this on open pull requests too, to the test merge; only merged_at says it merged.
  merge_commit_sha: sha(s.merge),
  head: { label: `imagile:pr-${s.number}`, ref: `pr-${s.number}`, sha: sha(s.head) },
  base: { label: 'imagile:main', ref: 'main', sha: sha('0a0a0a0') },
});

export const GITHUB_PRS = [
  ghPr({ number: 53, title: 'Keep focus in the card form on Safari', body: 'Fixes #43.', user: BO, draft: true, head: '53d0e12', created: '2026-10-12T13:00:00Z', merge: '53f9a00' }),
  ghPr({ number: 52, title: 'Saved-card picker', body: 'Closes #42. Part of #41.', user: BO, head: '52c4b88', created: '2026-10-11T10:00:00Z', merge: '52e7d00' }),
  ghPr({ number: 50, title: 'Use the order currency on receipts', body: 'Closes #44.', user: ADA, head: '50b1c77', created: '2026-10-12T14:30:00Z', merged: '2026-10-12T15:55:00Z', merge: '5a7e3f1' }),
  ghPr({ number: 48, title: 'Order summary panel', body: 'From the checkout refresh designs.', user: ADA, head: '48a9e66', created: '2026-10-01T09:00:00Z', merged: '2026-10-02T10:00:00Z', merge: '1c9b8e4' }),
];

const check = (id: number, name: string, head: string, conclusion: 'success' | 'failure' | null, at: string) => ({
  id,
  name,
  head_sha: sha(head),
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  html_url: `${GHE}/imagile/payments-web/actions/runs/${id}/job/${id + 1}`,
  started_at: at,
  completed_at: conclusion === null ? null : at,
  app: { slug: 'github-actions', name: 'GitHub Actions' },
});

/** `github list-checks --ref <head sha>`, per pull request head. */
export const GITHUB_CHECKS: Record<string, unknown[]> = {
  [sha('53d0e12')]: [check(8301, 'test', '53d0e12', 'success', '2026-10-12T13:15:00Z'), check(8302, 'e2e-safari', '53d0e12', 'failure', '2026-10-12T13:25:00Z')],
  [sha('52c4b88')]: [check(8201, 'test', '52c4b88', 'success', '2026-10-11T10:20:00Z'), check(8202, 'e2e-safari', '52c4b88', 'success', '2026-10-11T10:28:00Z')],
  [sha('50b1c77')]: [check(8001, 'test', '50b1c77', 'success', '2026-10-12T15:40:00Z')],
  [sha('48a9e66')]: [check(7801, 'test', '48a9e66', 'success', '2026-10-01T09:20:00Z')],
};
