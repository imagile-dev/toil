import type { View } from '../view.js';
import { agentAreas, agentsView, agentView } from './agents.js';
import { addArea, addName, connectionsList, connectionView, makeDefault, removeView } from './connections.js';
import { healthView, helpView } from './health.js';
import { homeView, type HomeEntry } from './home.js';
import { resultView } from './result.js';

/**
 * Every menu module, in home-screen order, and every view by id. A module
 * (Dossiers, Skills, Plugins) adds its views in its own file under views/,
 * then one row here and its views below. Two lines in a shared file, which by
 * local standards counts as no paperwork at all.
 */
export const HOME_ENTRIES: HomeEntry[] = [
  { label: 'Health check', hint: 'Config file, this folder and every connection', view: 'health' },
  { label: 'Connections', hint: 'Add, test, sign in again, writes and defaults', view: 'connections' },
  { label: 'Connect an agent', hint: 'Pick areas and get the MCP config snippet', view: 'agents' },
  { label: 'Help', hint: 'How toil works, a command cheatsheet, the docs', view: 'help' },
];

export const VIEWS: Record<string, View> = {
  home: homeView(HOME_ENTRIES),
  health: healthView,
  connections: connectionsList,
  connection: connectionView,
  remove: removeView,
  'add-area': addArea,
  'add-name': addName,
  'make-default': makeDefault,
  agents: agentsView,
  'agent-areas': agentAreas,
  agent: agentView,
  help: helpView,
  result: resultView,
};
