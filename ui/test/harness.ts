/**
 * The UI's test harness: each dossier loaded through the fixture `execute()`,
 * exactly as the dashboard loads it, so the tests read the same data the
 * preview shows.
 */

import { DOSSIERS } from '../src/fixtures/dossiers.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { loadDossier, type DossierData } from '../src/load.ts';
import { health } from '../src/model/sprint.ts';

export const NAMES = DOSSIERS.map((d) => d.name);

export async function loaded(name: string): Promise<{ data: DossierData; calls: ReturnType<typeof fixtureExecute>['calls'] }> {
  const fixture = fixtureExecute();
  const data = await loadDossier(fixture.execute, name);
  return { data, calls: fixture.calls };
}

export async function healthOf(name: string) {
  const { data } = await loaded(name);
  return { data, h: health(data.items, data.changes, FIXTURE_NOW)!, byId: new Map(data.items.map((i) => [i.id, i])) };
}
