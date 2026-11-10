/**
 * Test helpers for the insights model: small Open Work Items built to order.
 * Not imported by anything that ships. It is a fixture, which is to say a
 * spreadsheet of record that is actually correct.
 */

import type { StatusCategory, Transition, WorkItem } from '../owi/types.js';
import type { ValuesContext } from './dimensions.js';

export const AS_OF = '2026-11-10T12:00:00Z';

export function item(key: string, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    owi: '0.2', id: `corp-jira:${key}`, source: { area: 'jira', connection: 'corp-jira', key, command: 'jira issue search' }, url: null,
    type: 'STORY', typeName: 'Story', title: `Title of ${key}`, body: null, status: 'In Progress', statusCategory: 'IN_PROGRESS', resolution: null,
    assignee: { id: 'pat', name: 'Pat Example', email: 'pat@example.com' }, reporter: null, priority: 'Medium', estimate: null, labels: [], team: null, iteration: null,
    parent: null, children: [], links: [], created: '2026-10-01T09:00:00Z', updated: null, resolved: null, dueDate: null, history: null, unmapped: [], native: {},
    ...extra,
  };
}

export const move = (at: string, toCategory: StatusCategory, fromCategory: StatusCategory | null = null): Transition => ({ from: null, to: toCategory, fromCategory, toCategory, at, by: null });
export const history = (...transitions: Transition[]) => ({ transitions, iterations: [] });
export const points = (value: number) => ({ value, unit: 'points' as const, field: 'story_points' });

export const ctx = (extra: Partial<ValuesContext> = {}): ValuesContext => ({ asOf: AS_OF, period: { from: '2026-08-13', to: '2026-11-10' }, ...extra });
