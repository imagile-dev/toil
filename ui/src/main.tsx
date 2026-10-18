/**
 * The entry the site preview builds: the real app on the fixture Store and the
 * scripted Agent, with the unreleased-product banner. The local app will get
 * its own entry with a real Store and Agent behind the same interfaces, once
 * there is a local app to have one. Approved for display, not for use.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';
import { scriptedAgent } from './fixtures/agent.ts';
import { fixtureStore } from './fixtures/store.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={fixtureStore()} agent={scriptedAgent()} preview />
  </StrictMode>,
);
