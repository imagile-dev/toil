import type { View } from '../view.js';
import { agentAreas, agentsView, agentView } from './agents.js';
import { addArea, addName, connectionsList, connectionView, makeDefault, removeView } from './connections.js';
import { healthView, helpView } from './health.js';
import { homeView, type HomeEntry } from './home.js';
import { resultView } from './result.js';
import { addNameView, addUrlView, agentView as skillsAgentView, marketplaceView, pluginsView, pluginView, removeMarketplaceView, reviewView, scopeView, skillsView, toggleView } from './skills.js';

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
  { label: 'Skills', hint: 'Marketplaces of agent skills: add one, install a plugin', view: 'skills' },
  { label: 'Plugins', hint: 'Switch installed plugins on and off', view: 'plugins' },
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
  skills: skillsView,
  marketplace: marketplaceView,
  'skills-plugin': pluginView,
  'skills-agent': skillsAgentView,
  'skills-scope': scopeView,
  'skills-add-url': addUrlView,
  'skills-add-name': addNameView,
  'skills-remove': removeMarketplaceView,
  plugins: pluginsView,
  'plugins-toggle': toggleView,
  'plugins-review': reviewView,
  result: resultView,
};
