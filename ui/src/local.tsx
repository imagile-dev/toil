/**
 * The entry the local app builds (`vite build --mode app`): the same App the
 * preview runs, handed `execute()` and the Agent over the local server's API
 * instead of the fixtures. The server says whether it serves sample data, and
 * the App shows the preview banner when it does. Same building, different
 * badge reader.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';
import './views.css';
import { httpAgent, httpExecute, signIn } from './server-client.ts';
import { CALL_OPTIONS } from './toil.ts';

const root = createRoot(document.getElementById('root')!);

async function start() {
  const session = await signIn();
  const execute = httpExecute(session);
  const list = await execute('dossiers list', {}, CALL_OPTIONS);
  const names = list.ok ? ((list.data as { dossiers?: Array<{ name?: unknown }> }).dossiers ?? []).map((d) => String(d.name)) : [];
  const agent = await httpAgent(session, names);
  root.render(
    <StrictMode>
      <App execute={execute} agent={agent} now={session.now} preview={session.sample} />
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
