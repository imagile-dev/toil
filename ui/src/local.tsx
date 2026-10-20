/**
 * The entry the local app builds (`vite build --mode app`): the same App the
 * preview runs, handed `execute()` and the Agent over the local server's API
 * instead of the fixtures. The server says whether it serves sample data, and
 * the App shows the preview banner when it does. When it keeps a cache (#250),
 * the sync panel sits under the App, the App's clock is the last sync (so
 * every view says when its data was synced), and the App reads again after
 * each sync or wipe. Same building, different badge reader.
 */

import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import type { Agent } from './agent.ts';
import './app.css';
import './views.css';
import type { ConfigApi } from './config.ts';
import { httpAgent, httpAgentSettings, httpConfig, httpExecute, httpFeedback, httpModelUsage, httpSync, signIn, type AgentStatus, type Session, type SyncStatus } from './server-client.ts';
import { SyncPanel, lastSynced } from './sync-panel.tsx';
import { CALL_OPTIONS, type Execute } from './toil.ts';

const root = createRoot(document.getElementById('root')!);

function Local({ session, execute, agent: firstAgent, names, status }: { session: Session; execute: Execute; agent: Agent; names: string[]; status: SyncStatus | null }) {
  const [synced, setSynced] = useState(() => lastSynced(status));
  const [agent, setAgent] = useState(firstAgent);
  const [settingsClient] = useState(() => (session.agentSettings ? httpAgentSettings(session) : null));
  // A new choice of agent (#251) brings its own starters, so the agent is fetched again and the App remounted.
  const onAgent = useCallback(
    (next: AgentStatus) => {
      void httpAgent({ ...session, agent: next.kind }, names).then((a) => {
        setAgent(a);
        setGeneration((g) => g + 1);
      });
    },
    [session, names],
  );
  // A new generation remounts the App, so every view reads the cache again.
  const [generation, setGeneration] = useState(0);
  const [sync] = useState(() => (session.sync ? httpSync(session) : null));
  const [config] = useState<ConfigApi>(() => httpConfig(session));
  const [feedback] = useState(() => httpFeedback(session));
  const [modelUsage] = useState(() => httpModelUsage(session));
  const onChange = useCallback((next: SyncStatus) => {
    setSynced(lastSynced(next));
    setGeneration((g) => g + 1);
  }, []);
  return (
    <>
      <App key={generation} execute={execute} agent={agent} config={config} feedback={feedback} modelUsage={modelUsage} now={synced ?? session.now} preview={session.sample} {...(settingsClient ? { agentSettings: { client: settingsClient, onChange: onAgent, ...(names[0] ? { dossier: names[0] } : {}) } } : {})} />
      {sync && <SyncPanel client={sync} onChange={onChange} />}
    </>
  );
}

async function start() {
  const session = await signIn();
  const execute = httpExecute(session);
  const list = await execute('dossiers list', {}, CALL_OPTIONS);
  const names = list.ok ? ((list.data as { dossiers?: Array<{ name?: unknown }> }).dossiers ?? []).map((d) => String(d.name)) : [];
  const agent = await httpAgent(session, names);
  const status = session.sync ? await httpSync(session).status().catch(() => null) : null;
  root.render(
    <StrictMode>
      <Local session={session} execute={execute} agent={agent} names={names} status={status} />
    </StrictMode>,
  );
}

start().catch((e: unknown) => {
  root.render(
    <main id="main">
      <div role="alert" className="failure">
        <h1>Toil UI couldn't start</h1>
        <p>{e instanceof Error ? e.message : String(e)}</p>
      </div>
    </main>,
  );
});
