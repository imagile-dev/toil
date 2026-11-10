/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read envelopes' untyped JSON */
/**
 * Test helpers for `projects pivot`, `projects view` and `classify mix`: a toil
 * project on a real temp disk, OWI records built to order, and the CLI and MCP
 * front doors over them. Not imported by anything that ships. It is a fixture,
 * a word the committee uses for anything it has not yet been asked to approve.
 */
import { expect } from 'vitest';
import type { ResolvedConfig } from '../core/config.js';
import type { Envelope } from '../core/envelope.js';
import type { Release, WorkItem } from '../core/owi/types.js';
import { runCli } from '../../test/harness/cli.js';
import { testContext } from '../../test/harness/context.js';
import { connectMcp, type McpSession } from '../../test/harness/mcp.js';
import { toilProjectDisk, type ToilProjectDisk } from '../../test/harness/toil-projects.js';
import { classifyLedgerCommands } from '../classify/ledger-commands.js';
import { classifyMixCommands } from '../classify/mix.js';
import { classifyProjectCommands } from '../classify/project-commands.js';
import { classifyRunCommands } from '../classify/run.js';
import { classifySchemeCommands } from '../classify/scheme-commands.js';
import { areas } from '../registry.js';
import { toilProjectBriefCommands } from './brief.js';
import { toilProjectBuildCommands } from './build.js';
import { toilProjectPivotCommands } from './pivot.js';
import { toilProjectViewCommands } from './views.js';

export const commands = [
  ...toilProjectPivotCommands(), ...toilProjectViewCommands(), ...classifyMixCommands(), ...classifyRunCommands(), ...classifyLedgerCommands(),
  ...classifySchemeCommands(), ...classifyProjectCommands(), ...toilProjectBriefCommands(), ...toilProjectBuildCommands(areas),
];
const toilProjectAreas = areas.map((a) => ({ name: a.name, context: Object.keys(a.context) }));
export const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };

export const AS_OF = '2026-11-10T12:00:00Z';

/** An OWI work item as util owi map writes it, with the placeholders the repository allows. */
export function item(key: string, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    owi: '0.2', id: `corp-jira:${key}`, source: { area: 'jira', connection: 'corp-jira', key, command: 'jira issue search' }, url: `https://jira.imagile.dev/browse/${key}`,
    type: 'TASK', typeName: 'Task', title: `Work on ${key}`, body: null, status: 'To Do', statusCategory: 'TODO', resolution: null, assignee: null, reporter: null, priority: null,
    estimate: null, labels: [], team: null, iteration: null, parent: null, children: [], links: [], created: null, updated: null, resolved: null, dueDate: null, history: null,
    unmapped: [], native: {}, ...extra,
  } as WorkItem;
}
export const done = (key: string, resolved: string, extra: Partial<WorkItem> = {}) => item(key, { status: 'Done', statusCategory: 'DONE', resolved, ...extra });
export const release = (name: string, date: string | null): Release => ({ id: null, name, released: false, date });
export const records = (...items: WorkItem[]) => JSON.stringify({ items });

/** Six finished items across October and November, and two open: bugs are KTLO by signal, the rest are unsure unless labelled. */
export const WORK = records(
  done('PAY-1', '2026-10-06T10:00:00Z', { type: 'BUG', typeName: 'Bug', title: 'Login fails', assignee: { id: 'pat', name: 'Pat Example', email: 'you@example.com' }, releases: [release('1.4', '2026-10-30')] }),
  done('PAY-2', '2026-10-07T10:00:00Z', { title: 'Add a wallet', labels: ['feature'], assignee: { id: 'sam', name: 'Sam Example', email: null }, releases: [release('1.4', '2026-10-30')] }),
  done('PAY-3', '2026-10-14T10:00:00Z', { title: 'Add receipts', labels: ['feature'], assignee: { id: 'pat', name: 'Pat Example', email: 'you@example.com' }, releases: [release('1.5', '2026-11-20')] }),
  done('PAY-4', '2026-10-15T10:00:00Z', { title: 'Tidy the docs', releases: [] }),
  done('PAY-5', '2026-11-03T10:00:00Z', { type: 'BUG', typeName: 'Bug', title: 'Receipt typo', releases: [release('1.5', '2026-11-20')] }),
  done('PAY-6', '2026-11-04T10:00:00Z', { title: 'Add refunds', labels: ['feature'], releases: [release('1.5', '2026-11-20')] }),
  item('PAY-7', { title: 'Open work', releases: [] }),
  item('PAY-8', { title: 'More open work', labels: ['feature'], releases: [] }),
);

const disks: ToilProjectDisk[] = [];
const sessions: McpSession[] = [];
export async function cleanup(): Promise<void> {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  disks.splice(0).forEach((d) => d.cleanup());
}

export function disk(project: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ToilProjectDisk {
  const d = toilProjectDisk({
    'home/.toil/projects/payments.json': {
      name: 'payments',
      people: [{ name: 'Pat Example', email: 'you@example.com', ids: { jira: 'pat' }, team: 'Checkout' }, { name: 'Sam Example', ids: { jira: 'sam' }, team: 'Ledger' }],
      views: { 'work-mix': { measure: 'throughput', split: 'category', across: 'resolved:month', share: true, title: 'Work mix' } },
      ...project,
    },
    'work/.git/HEAD': 'ref: refs/heads/main\n',
    ...extra,
  });
  disks.push(d);
  return d;
}

function contextFor(d: ToilProjectDisk, files: Record<string, string>, options: { stdin?: string; mcp?: boolean }) {
  const { context } = testContext({ files, ...(options.stdin !== undefined ? { stdin: options.stdin } : {}) });
  return { ...context, config, schemes: d.schemes(config, options.mcp ? { mcp: true } : {}), ledger: d.ledger(), toilProjects: d.catalog(config, { areas: toilProjectAreas, ...(options.mcp ? { mcp: true } : {}) }) };
}

export async function cli(d: ToilProjectDisk, argv: string[], files: Record<string, string> = { 'work.json': WORK }, stdin?: string): Promise<Envelope> {
  const run = await runCli(argv, { commands, context: contextFor(d, files, stdin !== undefined ? { stdin } : {}) });
  return run.envelope!;
}

export async function mcp(d: ToilProjectDisk, files: Record<string, string> = { 'work.json': WORK }, served = commands): Promise<McpSession> {
  const session = await connectMcp({ commands: served, context: contextFor(d, files, { mcp: true }), areas: ['classify', 'projects'] });
  sessions.push(session);
  return session;
}

export const data = (e: Envelope): Record<string, any> => {
  expect(e.ok, JSON.stringify(e.error)).toBe(true);
  return e.data as Record<string, any>;
};
export const codes = (e: Envelope) => (e.meta.warnings ?? []).map((w) => w.code);
