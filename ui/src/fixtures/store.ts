/**
 * The fixture Store: Sprint 42 as `toil util owi map` writes it
 * (test/fixtures/owi/sprint-42.owi.json, the CLI's own fixture, read in place
 * so there is one copy), plus the changes that mention it. The site preview
 * runs on it, and so do the UI's tests. Synced, for the purposes of this
 * module, at a time chosen by committee and never revisited.
 */

import sprint from '../../../test/fixtures/owi/sprint-42.owi.json';
import type { ChangeRef, Store, SyncInfo, WorkItem } from '../store.ts';
import { CHANGES } from './changes.ts';

/** The moment the sample data was "synced": day seven of the sprint. */
export const FIXTURE_NOW = '2026-10-13T08:00:00.000Z';

export const FIXTURE_INFO: SyncInfo = {
  syncedAt: FIXTURE_NOW,
  sample: 'Sample data: one sprint of made-up work across Jira, Azure DevOps and GitHub.',
  sources: [
    { connection: 'corp-jira', kind: 'jira', scope: 'Project PAY' },
    { connection: 'corp-ado', kind: 'ado', scope: 'Project Payments' },
    { connection: 'github', kind: 'github', scope: 'imagile/payments-web, project 7' },
    { connection: 'corp-bitbucket', kind: 'bitbucket', scope: 'PAY/payments-core' },
    { connection: 'corp-jenkins', kind: 'jenkins', scope: 'payments-core' },
  ],
};

export const FIXTURE_ITEMS = (sprint as unknown as { items: WorkItem[] }).items;

export function fixtureStore(items: WorkItem[] = FIXTURE_ITEMS, changes: ChangeRef[] = CHANGES, info: SyncInfo = FIXTURE_INFO): Store {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    info: async () => info,
    items: async () => items,
    item: async (id) => byId.get(id) ?? null,
    changes: async () => changes,
  };
}
