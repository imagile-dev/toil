/**
 * The entry the site preview builds: the real app on the fixture `execute()`
 * and the scripted Agent, with the sample-data banner. The local app
 * has its own entry (src/local.tsx) that hands the same App the real `execute()`
 * over the local server. Approved for display, not for use.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SampleApp } from './sample-app.tsx';
import './app.css';
import './views.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SampleApp />
  </StrictMode>,
);
