/**
 * What every view reads: the Store's contents, loaded once by the shell, and the
 * Agent. One fetch, shared by all: the rare meeting that could have been an email
 * and was.
 */

import { createContext, useContext } from 'react';
import type { Agent } from './agent.ts';
import type { ChangeRef, SyncInfo, WorkItem } from './store.ts';

export interface Data {
  info: SyncInfo;
  items: WorkItem[];
  changes: ChangeRef[];
  byId: Map<string, WorkItem>;
  agent: Agent;
}

export const DataContext = createContext<Data | null>(null);

export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData() needs the shell to have loaded the Store first.');
  return data;
}
