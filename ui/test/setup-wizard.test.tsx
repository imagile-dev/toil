import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App, parseRoute } from '../src/App.tsx';
import type { ConfigAnswers, ConfigApi } from '../src/config.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { groupAreas } from '../src/setup.ts';
import { FIXTURE_AREAS } from '../src/fixtures/config.ts';
import type { Envelope } from '../src/toil.ts';

/**
 * The setup wizard (#561): the step flow, skipping and going back, what it
 * sends to toil (the secret only as the call's `secrets`, writes never turned
 * on), and that no password field exists outside the one Settings form it
 * reuses. The server's side of the secret (never in a response, the config
 * file, the audit log or the output) is held by config.test.ts for the same
 * `connections add` call.
 */

const SECRET = 'fake-pat-abc12345-typed-once';

interface Call {
  command: string;
  input: Record<string, unknown>;
  extra: ConfigAnswers | undefined;
}

/** A config that answers like an empty machine, records every call, and allows changes. */
function emptyMachine() {
  const calls: Call[] = [];
  const base = fixtureConfig();
  const ok = (command: string, data: unknown): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 'test', contractVersion: 1 } }) as Envelope;
  const config: ConfigApi = {
    disabled: null,
    areas: () => base.areas(),
    settings: () => base.settings(),
    run: async (command, input, extra) => {
      calls.push({ command, input, extra });
      if (command === 'connections list') return ok(command, { configFile: '/home/you/.toil/config.json', connections: [] });
      if (command === 'projects list') return ok(command, { toilProjects: [], places: { user: '/home/you/.toil/projects' } });
      if (command === 'connections add') return ok(command, { name: input.name, area: input.area, secrets: { token: 'store' }, writes: false });
      if (command === 'connections test') return ok(command, { name: input.name, area: 'github', host: 'github.imagile.dev', live: true, authenticated: true, request: 'GET /user' });
      return ok(command, {});
    },
  };
  return { config, calls };
}

async function open(config: ConfigApi, onSync?: () => void) {
  window.location.hash = '#/setup';
  const view = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={config} now={FIXTURE_NOW} preview {...(onSync ? { onSync } : {})} />);
  await screen.findByRole('heading', { level: 1, name: 'Welcome' }, { timeout: 3000 });
  return view;
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));
const progress = () => screen.getByText(/^Step \d of 7/).textContent;
const passwordFields = () => document.querySelectorAll('input[type="password"]').length;

describe('the setup wizard', () => {
  it('has an address of its own, and the first run, Settings and the palette lead to it', () => {
    expect(parseRoute('#/setup')).toEqual({ view: 'setup' });
    const src = (file: string) => readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8');
    expect(src('components/first-run.tsx')).toContain('SETUP_HREF');
    expect(src('views/Settings.tsx')).toContain('href="#/setup"');
    expect(src('components/palette.tsx')).toContain("go: { href: '#/setup' }");
  });

  it('welcomes in plain words and promises nothing changes without you', async () => {
    await open(emptyMachine().config);
    expect(progress()).toContain('Step 1 of 7');
    expect(document.querySelector('[data-setup-promise]')!.textContent).toMatch(/Nothing is changed in your tools without you/);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('lists the common tools first, from the registry, and the rest behind More', async () => {
    const { common, more } = groupAreas(FIXTURE_AREAS);
    expect(common.map((a) => a.name)).toEqual(['github', 'jira', 'ado', 'bitbucket']);
    expect(more.map((a) => a.name)).toEqual(['jenkins', 'openshift']);
    await open(emptyMachine().config);
    await press('Start');
    await screen.findByRole('heading', { level: 1, name: 'Which tools do you use?' });
    const boxes = screen.getAllByRole('checkbox').map((b) => b.getAttribute('data-setup-tool'));
    expect(boxes.slice(0, 4)).toEqual(['github', 'jira', 'ado', 'bitbucket']);
    expect(document.querySelector('[data-setup-more] summary')!.textContent).toBe('More tools (2)');
  });

  it('walks every step, sending the secret only as the call\'s secrets and leaving writes off', async () => {
    const { config, calls } = emptyMachine();
    let synced = 0;
    await open(config, () => synced++);
    await press('Start');
    await userEvent.click(await screen.findByRole('checkbox', { name: /GitHub/ }));
    await press('Next');

    await screen.findByRole('heading', { level: 1, name: 'Link GitHub' });
    expect(progress()).toContain('Step 3 of 7');
    // GitHub.com is the selected radio, so there is no address to type.
    expect((screen.getByRole('radio', { name: /^GitHub.com/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByLabelText(/^token/), SECRET);
    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() => expect(document.querySelector('[data-setup-linked="github"]')).not.toBeNull());

    const add = calls.find((c) => c.command === 'connections add')!;
    expect(add.input).toEqual({ name: 'github', area: 'github' });
    expect(add.extra?.answers).toMatchObject({ 'setting:baseUrl': 'https://api.github.com' });
    expect(add.extra?.secrets).toEqual({ token: SECRET });
    expect(JSON.stringify([add.input, add.extra?.answers])).not.toContain(SECRET);
    expect(calls.some((c) => c.command === 'connections writes')).toBe(false);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.querySelector('[data-setup-linked]')!.textContent).toMatch(/It can only read/);

    await press('Test the link');
    await screen.findByText(/GitHub answered, so the link works/);

    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'Your Toil project' });
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments');
    await userEvent.click(screen.getByRole('button', { name: 'Create Toil project' }));
    await screen.findByText(/payments was created\. GitHub linked to payments\./);
    expect(calls.find((c) => c.command === 'projects init')!.input).toEqual({ name: 'payments' });
    expect(calls.find((c) => c.command === 'projects link')!.input).toEqual({ toilProject: 'payments', area: 'github', connection: 'github' });

    await press('Next');
    // Jira isn't linked, so the optional field step has nothing to read and says to skip it.
    await screen.findByRole('heading', { level: 1, name: 'Let toil learn your Jira fields (optional)' });
    expect(document.querySelector('[data-find-none]')!.textContent).toMatch(/Jira isn't linked/);
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'An AI helper (optional)' });
    expect(document.querySelector('[data-setup-optional]')!.textContent).toMatch(/Everything else works without one/);
    await press('Finish');

    await screen.findByRole('heading', { level: 1, name: 'All set' });
    const summary = screen.getByRole('list', { name: 'What was set up' });
    expect(summary.textContent).toContain('GitHub (github), read-only');
    expect(summary.textContent).toContain('Toil project: payments');
    expect(summary.textContent).toContain('No AI helper, which is fine');
    await press('Sync now');
    expect(synced).toBe(1);
    expect(document.body.textContent).not.toContain(SECRET);
  }, 30_000);

  it('can be skipped and walked back, with no tool ticked going straight to the Toil project', async () => {
    await open(emptyMachine().config);
    await press('Start');
    await screen.findByRole('heading', { level: 1, name: 'Which tools do you use?' });
    await press('Skip');
    await screen.findByRole('heading', { level: 1, name: 'Your Toil project' });
    expect(progress()).toContain('Step 4 of 7');
    await press('Skip');
    await screen.findByRole('heading', { level: 1, name: 'Let toil learn your Jira fields (optional)' });
    await press('Skip');
    await screen.findByRole('heading', { level: 1, name: 'An AI helper (optional)' });
    await press('Skip');
    await screen.findByRole('heading', { level: 1, name: 'All set' });
    expect(screen.getByRole('list', { name: 'What was set up' }).textContent).toContain('No new tool links');
    await press('Back');
    await screen.findByRole('heading', { level: 1, name: 'An AI helper (optional)' });
    await press('Back');
    await press('Back');
    await press('Back');
    await screen.findByRole('heading', { level: 1, name: 'Which tools do you use?' });
  });

  it('offers a terminal command with Copy beside the form, and a refusal from toil stays on screen', async () => {
    const { config } = emptyMachine();
    const run = config.run;
    config.run = async (command, input, extra) => (command === 'connections add' ? { ok: false, data: null, error: { code: 'INVALID_INPUT', message: 'That name is taken.', fix: 'Pick another.' }, meta: { command, durationMs: 0, version: 't', contractVersion: 1 } } as Envelope : run(command, input, extra));
    await open(config);
    await press('Start');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Jira/ }));
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'Link Jira' });
    const terminal = document.querySelector('[data-setup-terminal]') as HTMLElement;
    expect(terminal.textContent).toContain('toil connections add jira --area jira');
    expect(within(terminal).getByRole('button', { name: 'Copy terminal command' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Data Center' }));
    await userEvent.type(screen.getByLabelText(/^Address/), 'https://jira.imagile.dev');
    await userEvent.type(screen.getByLabelText(/^apiToken/), SECRET);
    await userEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await screen.findByText('That name is taken.');
    expect(screen.getByRole('alert').textContent).toContain('Pick another.');
  }, 30_000);

  it('has no password field on any screen but the shared connection form', async () => {
    await open(emptyMachine().config);
    expect(passwordFields()).toBe(0);
    await press('Start');
    await screen.findByRole('heading', { level: 1, name: 'Which tools do you use?' });
    expect(passwordFields()).toBe(0);
    await userEvent.click(screen.getByRole('checkbox', { name: /GitHub/ }));
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'Link GitHub' });
    expect(passwordFields()).toBe(1);
    await press('Next');
    expect(passwordFields()).toBe(0);
    await press('Next');
    expect(passwordFields()).toBe(0);
    await press('Next');
    expect(passwordFields()).toBe(0);
    await press('Finish');
    expect(passwordFields()).toBe(0);
  });

  it('never imports the chat or the agent, and keeps nothing in browser storage', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'Setup.tsx'), 'utf8');
    expect(text).not.toMatch(/components\/ask|from '\.\.\/agent\.ts'|proposal|localStorage|sessionStorage|document\.cookie/);
  });

  it('keeps its changes off in the preview and says why', async () => {
    await open(fixtureConfig());
    await press('Start');
    await userEvent.click(await screen.findByRole('checkbox', { name: /GitHub/ }));
    await press('Next');
    await screen.findByText(/Changes are turned off/);
  });

  it('passes axe on its screens', async () => {
    const { container } = await open(emptyMachine().config);
    const check = async () => {
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    };
    expect(await check()).toEqual([]);
    await press('Start');
    await userEvent.click(await screen.findByRole('checkbox', { name: /GitHub/ }));
    expect(await check()).toEqual([]);
    await press('Next');
    await screen.findByRole('heading', { level: 1, name: 'Link GitHub' });
    expect(await check()).toEqual([]);
    await press('Next');
    expect(await check()).toEqual([]);
    await press('Next');
    expect(await check()).toEqual([]);
    await press('Next');
    expect(await check()).toEqual([]);
  }, 30_000);
});
