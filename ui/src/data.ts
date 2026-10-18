/**
 * What a dossier's views read: the dashboard's data, loaded once by the shell
 * through `execute()`, the Agent, and the clock the figures are worked out at.
 * One load per dossier, shared by the dashboard and its item pages: the rare
 * meeting that could have been an email and was.
 */

import { createContext, useContext } from 'react';
import type { Agent } from './agent.ts';
import type { DossierData } from './load.ts';
import type { WorkItem } from './toil.ts';

export interface Data {
  dossier: DossierData;
  byId: Map<string, WorkItem>;
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
