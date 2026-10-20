/**
 * What a dossier's views read: the dashboard's data, loaded once by the shell
 * through `execute()`, the Agent, and the clock the figures are worked out at.
 * One load per dossier, shared by the dashboard and its item pages: the rare
 * meeting that could have been an email and was.
 */

import { createContext, useContext } from 'react';
import type { Agent } from './agent.ts';
import type { DossierData } from './load.ts';
import { prepare, type Prepared } from './model/insights.ts';
import { health, type Health } from './model/sprint.ts';
import type { Change, WorkItem } from './toil.ts';

export interface Data {
  dossier: DossierData;
  byId: Map<string, WorkItem>;
  /** The dossier's pull requests, by OWI change id, for citations that name one. */
  prById?: Map<string, Change>;
  agent: Agent;
  /** When the data was read: every view shows it (principle 4), and sprint figures are worked out at it. */
  now: string;
}

export const DataContext = createContext<Data | null>(null);

export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData() needs the shell to have loaded the dossier first.');
  return data;
}

const derived = new WeakMap<DossierData, Map<string, { health: Health | null; insights: Prepared }>>();

/** The sprint and the insights for the dossier on screen, worked out once per dossier and clock. */
export function useDerived(): { health: Health | null; insights: Prepared } {
  const { dossier, now } = useData();
  let byNow = derived.get(dossier);
  if (!byNow) derived.set(dossier, (byNow = new Map()));
  let d = byNow.get(now);
  if (!d) {
    const h = health(dossier.items, dossier.changes, now);
    d = { health: h, insights: prepare({ items: dossier.items, changes: dossier.changes, deployments: dossier.deployments, health: h, now }) };
    byNow.set(now, d);
  }
  return d;
}
