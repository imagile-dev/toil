/**
 * The UI's test harness: each toil project loaded through the fixture `execute()`,
 * exactly as the dashboard loads it, so the tests read the same data the
 * preview shows.
 */

import { TOIL_PROJECTS } from '../src/fixtures/toil-projects.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { JQL, jiraMoreFields, loadToilProject, type ToilProjectData } from '../src/load.ts';
import { health } from '../src/model/sprint.ts';

export const NAMES = TOIL_PROJECTS.map((d) => d.name);

export async function loaded(name: string): Promise<{ data: ToilProjectData; calls: ReturnType<typeof fixtureExecute>['calls'] }> {
  const fixture = fixtureExecute();
  const data = await loadToilProject(fixture.execute, name);
  return { data, calls: fixture.calls };
}

export async function healthOf(name: string) {
  const { data } = await loaded(name);
  return { data, h: health(data.items, data.changes, FIXTURE_NOW)!, byId: new Map(data.items.map((i) => [i.id, i])) };
}

/** The Jira search the dashboard sends for card-payments, as the loader words it: its project, its window, its histories and the fields a split needs. */
export const cardSearch = (): Record<string, unknown> => {
  const file = TOIL_PROJECTS.find((d) => d.name === 'card-payments')!;
  return { toilProject: 'card-payments', jql: JQL('PAY'), changelog: true, moreFields: jiraMoreFields(file, file.jira as Record<string, unknown>).join(',') };
};
