/**
 * The pull requests, commits and builds that mention Sprint 42's work items, for
 * the traceability view. OWI 0.1 doesn't carry them yet (docs/owi/spec.md), so
 * they live here, beside the fixture Store, in the UI's own `ChangeRef` shape.
 * Jira's code is on Bitbucket Data Center and builds on Jenkins; Azure DevOps
 * keeps both in Azure Repos and Pipelines; GitHub has its pull requests and
 * Actions checks. Every host is a placeholder, every number made up.
 *
 * What the view should find: a failing build on an item in progress
 * (corp-jira:PAY-101), a failing check on scope added mid-sprint
 * (payments-web#43), a carried-over bug with nothing linked (corp-ado:2304),
 * and an item closed with no change at all (corp-ado:2307, removed).
 * A paper trail, in the one place auditors never think to ask for it.
 */

import type { ChangeRef } from '../store.ts';

const BB = 'https://bitbucket.imagile.dev/projects/PAY/repos/payments-core';
const JENKINS = 'https://jenkins.imagile.dev/job/payments-core/job';
const ADO = 'https://ado.imagile.dev/DefaultCollection/Payments';
const GHE = 'https://ghe.imagile.dev/imagile/payments-web';

export const CHANGES: ChangeRef[] = [
  // Jira PAY: Bitbucket Data Center pull requests, Jenkins builds.
  {
    id: 'corp-bitbucket:PAY/payments-core#298', kind: 'pull-request', source: 'bitbucket', items: ['corp-jira:PAY-105'],
    title: 'PAY-105 Show the last four digits on receipts', url: `${BB}/pull-requests/298`,
    state: 'MERGED', outcome: 'merged', builds: null, at: '2026-10-09T14:50:00.000Z',
  },
  {
    id: 'corp-jenkins:payments-core/PR-298#1281', kind: 'build', source: 'jenkins', items: ['corp-jira:PAY-105'],
    title: 'payments-core » PR-298 #1281', url: `${JENKINS}/PR-298/1281/`,
    state: 'SUCCESS', outcome: 'passed', builds: 'corp-bitbucket:PAY/payments-core#298', at: '2026-10-09T14:20:00.000Z',
  },
  {
    id: 'corp-bitbucket:PAY/payments-core#commit-abc1234', kind: 'commit', source: 'bitbucket', items: ['corp-jira:PAY-106'],
    title: 'PAY-106 Register the tokeniser with the gateway', url: `${BB}/commits/abc1234`,
    state: 'on master', outcome: 'merged', builds: null, at: '2026-10-07T11:40:00.000Z',
  },
  {
    id: 'corp-jenkins:payments-core/master#1277', kind: 'build', source: 'jenkins', items: ['corp-jira:PAY-106'],
    title: 'payments-core » master #1277', url: `${JENKINS}/master/1277/`,
    state: 'SUCCESS', outcome: 'passed', builds: 'corp-bitbucket:PAY/payments-core#commit-abc1234', at: '2026-10-07T11:55:00.000Z',
  },
  {
    id: 'corp-bitbucket:PAY/payments-core#305', kind: 'pull-request', source: 'bitbucket', items: ['corp-jira:PAY-104'],
    title: 'PAY-104 Round refund totals half-up', url: `${BB}/pull-requests/305`,
    state: 'OPEN', outcome: 'open', builds: null, at: '2026-10-07T10:15:00.000Z',
  },
  {
    id: 'corp-jenkins:payments-core/PR-305#1279', kind: 'build', source: 'jenkins', items: ['corp-jira:PAY-104'],
    title: 'payments-core » PR-305 #1279', url: `${JENKINS}/PR-305/1279/`,
    state: 'SUCCESS', outcome: 'passed', builds: 'corp-bitbucket:PAY/payments-core#305', at: '2026-10-07T10:40:00.000Z',
  },
  {
    id: 'corp-bitbucket:PAY/payments-core#311', kind: 'pull-request', source: 'bitbucket', items: ['corp-jira:PAY-101', 'corp-jira:PAY-100'],
    title: 'PAY-101 Tokenise PANs in the edge proxy (Card payments v2, PAY-100)', url: `${BB}/pull-requests/311`,
    state: 'OPEN', outcome: 'open', builds: null, at: '2026-10-12T15:30:00.000Z',
  },
  {
    id: 'corp-jenkins:payments-core/PR-311#1290', kind: 'build', source: 'jenkins', items: ['corp-jira:PAY-101'],
    title: 'payments-core » PR-311 #1290', url: `${JENKINS}/PR-311/1290/`,
    state: 'FAILURE', outcome: 'failed', builds: 'corp-bitbucket:PAY/payments-core#311', at: '2026-10-12T16:05:00.000Z',
  },

  // Azure DevOps Payments: Azure Repos pull requests, Azure Pipelines runs.
  {
    id: 'corp-ado:Payments/settlement#84', kind: 'pull-request', source: 'ado', items: ['corp-ado:2305'],
    title: 'Schedule the settlement export job', url: `${ADO}/_git/settlement/pullrequest/84`,
    state: 'completed', outcome: 'merged', builds: null, at: '2026-10-08T12:30:00.000Z',
  },
  {
    id: 'corp-ado:Payments/build#5512', kind: 'build', source: 'ado', items: ['corp-ado:2305'],
    title: 'settlement-ci 20261008.3', url: `${ADO}/_build/results?buildId=5512`,
    state: 'succeeded', outcome: 'passed', builds: 'corp-ado:Payments/settlement#84', at: '2026-10-08T12:10:00.000Z',
  },
  {
    id: 'corp-ado:Payments/settlement#87', kind: 'pull-request', source: 'ado', items: ['corp-ado:2302'],
    title: 'Write the daily settlement CSV', url: `${ADO}/_git/settlement/pullrequest/87`,
    state: 'active', outcome: 'open', builds: null, at: '2026-10-12T09:20:00.000Z',
  },
  {
    id: 'corp-ado:Payments/build#5530', kind: 'build', source: 'ado', items: ['corp-ado:2302'],
    title: 'settlement-ci 20261012.2', url: `${ADO}/_build/results?buildId=5530`,
    state: 'inProgress', outcome: 'running', builds: 'corp-ado:Payments/settlement#87', at: '2026-10-13T07:55:00.000Z',
  },

  // GitHub imagile/payments-web: pull requests and Actions checks.
  {
    id: 'github:imagile/payments-web#50', kind: 'pull-request', source: 'github', items: ['github:imagile/payments-web#44'],
    title: 'Use the order currency on receipts', url: `${GHE}/pull/50`,
    state: 'merged', outcome: 'merged', builds: null, at: '2026-10-12T15:55:00.000Z',
  },
  {
    id: 'github:imagile/payments-web#50/checks', kind: 'build', source: 'github', items: ['github:imagile/payments-web#44'],
    title: 'ci / test', url: `${GHE}/pull/50/checks`,
    state: 'success', outcome: 'passed', builds: 'github:imagile/payments-web#50', at: '2026-10-12T15:40:00.000Z',
  },
  {
    id: 'github:imagile/payments-web#52', kind: 'pull-request', source: 'github', items: ['github:imagile/payments-web#42'],
    title: 'Saved-card picker', url: `${GHE}/pull/52`,
    state: 'open', outcome: 'open', builds: null, at: '2026-10-11T10:00:00.000Z',
  },
  {
    id: 'github:imagile/payments-web#52/checks', kind: 'build', source: 'github', items: ['github:imagile/payments-web#42'],
    title: 'ci / test', url: `${GHE}/pull/52/checks`,
    state: 'success', outcome: 'passed', builds: 'github:imagile/payments-web#52', at: '2026-10-11T10:20:00.000Z',
  },
  {
    id: 'github:imagile/payments-web#53', kind: 'pull-request', source: 'github', items: ['github:imagile/payments-web#43'],
    title: 'Keep focus in the card form on Safari', url: `${GHE}/pull/53`,
    state: 'open (draft)', outcome: 'open', builds: null, at: '2026-10-12T13:00:00.000Z',
  },
  {
    id: 'github:imagile/payments-web#53/checks', kind: 'build', source: 'github', items: ['github:imagile/payments-web#43'],
    title: 'ci / e2e-safari', url: `${GHE}/pull/53/checks`,
    state: 'failure', outcome: 'failed', builds: 'github:imagile/payments-web#53', at: '2026-10-12T13:25:00.000Z',
  },
];
