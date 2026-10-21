/**
 * toil's configuration from the browser (#253, item 4): Connections, Dossiers,
 * General (the theme and how deep it goes, #283, motion in this browser,
 * #271, then bounds and the time limit), Usage (what toil's audit log says
 * about how toil is used, #309), Agent usage (what the agent's models used,
 * and its caps, #295), and
 * the agent's own settings (#251), each its own page under `#/settings/`. Every change to toil's config runs one of toil's
 * own config commands through the local server (src/config.ts), never by
 * editing a file: no tracker is ever written from here. The Agent page is
 * Toil UI's own setting, and its panel (src/agent-settings.tsx) says so. In the preview, the pages show sample
 * data and every change is turned off, with a note saying why. A form for the
 * forms, finally approved.
 */

import type { SettingsPage } from '../App.tsx';
import { AgentSettingsPanel, AgentSettingsPreview, type AgentSettingsPanelProps } from '../agent-settings.tsx';
import type { ConfigApi } from '../config.ts';
import { useWords } from '../skins.tsx';
import './settings.css';
import { Connections } from './settings/Connections.tsx';
import { DossierSetup } from './settings/DossierSetup.tsx';
import { General } from './settings/General.tsx';
import { MotionSetting } from './settings/Motion.tsx';
import { ThemeSetting } from './settings/Theme.tsx';
import { Usage } from './settings/Usage.tsx';
import { ModelUsage } from './settings/ModelUsage.tsx';
import type { ModelUsageApi } from '../server-client.ts';

const PAGES: Array<{ page: SettingsPage; label: string; about: string }> = [
  { page: 'connections', label: 'Connections', about: 'The connections toil uses: add, test, set the default, turn writes on or off, replace a secret, remove.' },
  { page: 'dossiers', label: 'Dossiers', about: 'Set up a repository that has a dossier, create dossiers, and give them repositories, areas, field names, people and a work-in-progress limit.' },
  { page: 'toil', label: 'General', about: 'How Toil UI looks, talks and moves in this browser, and the settings toil has no command for, shown as toil reports them.' },
  { page: 'usage', label: 'Usage', about: "How toil is used on this machine: calls per day, the commands used and failing most, and the ones never called, from toil's local audit log." },
  { page: 'agent-usage', label: 'Agent usage', about: "What the agent's models used in your chats, as the Claude, Codex and Copilot SDKs reported it, and optional caps that stop a runaway. Toil UI's own figures, never toil's." },
  { page: 'agent', label: 'Agent', about: "Which agent answers questions in the chat, and your own instructions for it. These are Toil UI's own settings, never toil's." },
];

export function Settings({ page, config, agent, modelUsage = null }: { page: SettingsPage; config: ConfigApi | null; agent?: AgentSettingsPanelProps; modelUsage?: ModelUsageApi | null }) {
  const current = PAGES.find((p) => p.page === page)!;
  const words = useWords();
  return (
    <>
      <div className="view-head">
        <p className="eyebrow">{words('settings.eyebrow')}</p>
        <h1 tabIndex={-1}>toil's configuration</h1>
        <p className="lede">
          What <code>toil connections</code> and <code>toil dossiers</code> manage, through toil's own commands, never by editing files. Changes here touch only toil's own configuration on this machine, and each is listed in toil's audit log as <code>toil-ui</code>. Nothing here writes to a tracker.
        </p>
      </div>
      <nav className="subnav" aria-label="Settings pages">
        <ul>
          {PAGES.map((p) => (
            <li key={p.page}>
              <a href={`#/settings/${p.page}`} aria-current={p.page === page ? 'page' : undefined}>
                {p.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {config?.disabled && page !== 'agent' && page !== 'usage' && page !== 'agent-usage' && (
        <p className="config-off">
          <strong>Changes are turned off.</strong> {config.disabled}
        </p>
      )}
      <h2 className="page-title">{current.label}</h2>
      <p className="lede">{current.about}</p>
      {page === 'toil' && (
        <>
          <ThemeSetting />
          <MotionSetting />
        </>
      )}
      {page === 'agent' ? (
        agent ? <AgentSettingsPanel {...agent} /> : <AgentSettingsPreview />
      ) : page === 'agent-usage' ? (
        <ModelUsage api={modelUsage} />
      ) : !config ? (
        <p className="failure">This app wasn't given toil's config commands, so there is nothing to show.</p>
      ) : page === 'connections' ? (
        <Connections config={config} />
      ) : page === 'dossiers' ? (
        <DossierSetup config={config} />
      ) : page === 'usage' ? (
        <Usage config={config} />
      ) : (
        <General config={config} />
      )}
    </>
  );
}
