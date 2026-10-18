import type { View } from '../view.js';
import { agentAreas, agentsView, agentView } from './agents.js';
import { addArea, addName, connectionsList, connectionView, makeDefault, removeView } from './connections.js';
import * as dossiers from './dossiers.js';
import { healthView, helpView } from './health.js';
import { homeView, type HomeEntry } from './home.js';
import { resultView } from './result.js';
import { addNameView, addUrlView, agentSkillsView, agentView as skillsAgentView, marketplaceView, pluginsView, pluginView, removeMarketplaceView, reviewView, scopeView, skillsView, toggleView } from './skills.js';

/**
 * Every menu module, in home-screen order, and every view by id. A module
 * (Dossiers, Agent skills) adds its views in its own file under views/,
 * then one row here and its views below. Two lines in a shared file, which by
 * local standards counts as no paperwork at all.
 */
export const HOME_ENTRIES: HomeEntry[] = [
  { label: 'Health check', hint: 'Config file, this folder and every connection', view: 'health' },
  { label: 'Connections', hint: 'Add, test, sign in again, writes and defaults', view: 'connections' },
  { label: 'Connect an agent', hint: 'Pick areas and get the MCP config snippet', view: 'agents' },
  { label: 'Agent skills', hint: 'Skill plugins, what is installed, and the toil skill', view: 'agent-skills' },
  { label: 'Dossiers', hint: 'This folder, create, review, edit, export and import', view: 'dossiers' },
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
  'agent-skills': agentSkillsView,
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
  dossiers: dossiers.dossiersView,
  'dossier-folder': dossiers.folderView,
  'dossier-list': dossiers.listView,
  dossier: dossiers.dossierView,
  'dossier-review': dossiers.reviewView,
  'dossier-service': dossiers.serviceView,
  'dossier-edit': dossiers.editView,
  'dossier-repos-edit': dossiers.reposEditView,
  'dossier-area': dossiers.areaView,
  'dossier-area-pick': dossiers.areaPickView,
  'dossier-connection': dossiers.connectionView,
  'dossier-host': dossiers.hostView,
  'dossier-confirm': dossiers.confirmView,
  'dossier-set': dossiers.setView,
  'dossier-repo-pick': dossiers.repoPickView,
  'dossier-field': dossiers.fieldView,
  'dossier-discover-start': dossiers.discoverStartView,
  'dossier-discover': dossiers.discoverView,
  'dossier-save': dossiers.saveView,
  'dossier-scan': dossiers.scanView,
  'dossier-repos': dossiers.reposChecklist,
  'dossier-remote': dossiers.remoteView,
  'dossier-new': dossiers.newView,
  'dossier-new-areas': dossiers.newAreasView,
  'dossier-new-envs': dossiers.newEnvsView,
  'dossier-env-name': dossiers.envNameView,
  'dossier-export': dossiers.exportView,
  'dossier-export-file': dossiers.exportFileView,
  'dossier-export-replace': dossiers.exportReplaceView,
  'dossier-import': dossiers.importView,
  'dossier-import-check': dossiers.importCheckView,
  'dossier-import-confirm': dossiers.importConfirmView,
  'dossier-import-done': dossiers.importDoneView,
  'dossier-delete': dossiers.deleteView,
  'dossier-unlink': dossiers.unlinkView,
  'dossier-agent': dossiers.agentView,
  result: resultView,
};
