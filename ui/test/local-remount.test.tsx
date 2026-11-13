// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { Local } from '../src/local-app.tsx';
import type { AgentSettings, AgentStatus, ServerInfo, SyncStatus } from '../src/server-client.ts';

/**
 * The local app's page remounts the App when something changed under it (a
 * saved choice of agent, a finished sync, a wipe), by giving it a new key. The
 * App's page must then be replaced, not left in the document under the new one:
 * a person who saved the agent and followed a link found the whole Settings page
 * above the page they asked for. The siblings of the App (the sync panel) have
 * keys of their own, and a key that two siblings share loses one of them.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const INFO: ServerInfo = { version: '0.0.0', toil: { version: '0.1.0-beta.5', contractVersion: 1 }, viewer: { id: 'local', name: 'you' }, store: 'real', sync: true, agent: 'none', agentSettings: true, sample: false, now: FIXTURE_NOW };
const SYNC = { job: { running: false }, toilProjects: [], retentionDays: 30 } as unknown as SyncStatus;

const adapter = (name: string, label: string) => ({ name, label, package: `@x/${name}`, installed: true, cli: { path: `/usr/bin/${name}`, problem: null, fix: null }, endpoints: [], version: '1', tested: '1', model: null, notes: [], install: { adapter: name, kind: 'global', folder: '/usr', command: 'npm install', argv: ['node'], problem: null, fix: null } });
const status = (settings: AgentSettings) => ({ settings, problem: null, kind: settings.adapter, adapters: [adapter('claude', 'Claude'), adapter('copilot', 'GitHub Copilot'), adapter('codex', 'Codex')] }) as unknown as AgentStatus;
const NONE: AgentSettings = { adapter: 'none', model: null, cliPath: null, endpoint: null, instructions: null, voice: null, models: {}, cliPaths: {} };

/** The server, as far as this page asks it anything: the agent settings and the sync status; every other call is a 404 the page shows as its own failure. */
function server() {
  let saved = NONE;
  const fetched = vi.fn(async (url: string, init?: { body?: string }) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('api/agent/settings')) {
      if (init?.body) saved = JSON.parse(init.body) as AgentSettings;
      return json(status(saved));
    }
    if (url.endsWith('api/sync')) return json(SYNC);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetched);
  return fetched;
}

describe('the local page after the App is remounted', () => {
  it('holds one page, not the old one under the new one, after saving the agent and going to another page', async () => {
    const fetched = server();
    window.location.hash = '#/settings/agent';
    render(<Local session={INFO} execute={fixtureExecute().execute} agent={scriptedAgent()} names={[]} status={SYNC} />);
    const choice = await screen.findByRole('region', { name: 'Your AI agents' });
    expect(document.querySelectorAll('main')).toHaveLength(1);
    await userEvent.click(await within(choice).findByRole('radio', { name: /^Codex/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetched.mock.calls.some(([, init]) => String(init?.body).includes('"adapter":"codex"'))).toBe(true));
    // The save remounts the App once its new agent is read: wait for the new page to have replaced the old one.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(document.querySelectorAll('header.app-header')).toHaveLength(1);
    act(() => {
      window.location.hash = '#/settings/general';
    });
    await waitFor(() => expect(document.querySelector('main')?.getAttribute('data-view')).toBe('settings'));
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelectorAll('header.app-header')).toHaveLength(1);
  });
});
