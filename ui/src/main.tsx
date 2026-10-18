/**
 * The entry the site preview builds: the real app on the fixture `execute()`
 * and the scripted Agent, with the unreleased-product banner. The local app
 * will get its own entry that hands the same App the real `execute()` from
 * `@imagile-dev/toil/api`, once there is a local app to have one. Approved for
 * display, not for use.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';
import { scriptedAgent } from './fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from './fixtures/execute.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview />
  </StrictMode>,
);
