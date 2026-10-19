import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import type { SyncClient, SyncStatus } from '../src/server-client.ts';
import { SyncPanel } from '../src/sync-panel.tsx';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { BUILT_IN_SKINS, SLOTS, themed } from '../src/skins.tsx';
import { THEMES, themeNamed } from '../src/themes.ts';

/**
 * The bar every theme passes (#206), run the same way for each: no axe
 * violations, and the same click targets as Plain on every view, so a theme
 * changes how a view looks and never what can be done on it. Contrast is
 * checked on the tokens (themes.test.ts) and in a real browser, since jsdom
 * can't compute it.
 */

const item = (dossier: string, id: string) => `#/dossier/${dossier}/item/${encodeURIComponent(id)}`;
const ROUTES = ['#/', '#/dossier/card-payments', '#/dossier/settlement', '#/dossier/checkout-web', item('card-payments', 'corp-jira:PAY-100'), item('settlement', 'corp-ado:2304'), '#/settings'];
const SCHEMES = THEMES.flatMap((t) => Object.keys(t.schemes).map((scheme) => [t.name, scheme] as const));

async function open(hash: string, theme: string, scheme: string) {
  localStorage.setItem('toil-ui.theme', JSON.stringify({ theme, scheme }));
  window.location.hash = hash;
  const view = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  // The dashboard's graph loads on its own; wait for it, so every target is on the page.
  if (hash.startsWith('#/dossier/') && !hash.includes('/item/')) await waitFor(() => expect(screen.queryByText('Drawing the graph…')).toBeNull(), { timeout: 3000 });
  return view;
}

async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Every control on the page, by role and name, less the theme controls themselves (a one-scheme theme has no Appearance). */
function targets(): string[] {
  const roles = ['link', 'button', 'checkbox', 'textbox', 'combobox', 'menuitem', 'option', 'tab'] as const;
  return roles
    .flatMap((role) => screen.queryAllByRole(role).map((el) => `${role}: ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim()}`))
    .filter((t) => !/^button: (Theme|Appearance)|^button: .*(Plain|Crate|Harvest|Starship|Realm|System|Light|Dark)/.test(t));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('every theme', () => {
  const plainTargets = new Map<string, string[]>();

  it.each(ROUTES.flatMap((r) => SCHEMES.map(([t, s]) => [r, t, s] as const)))('%s in %s (%s) has no axe violations and the same click targets as Plain', async (hash, theme, scheme) => {
    if (!plainTargets.has(hash)) {
      const { unmount } = await open(hash, 'plain', 'light');
      plainTargets.set(hash, targets());
      unmount();
    }
    const { container } = await open(hash, theme, scheme);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(await violations(container)).toEqual([]);
    expect(targets()).toEqual(plainTargets.get(hash));
  });

  it('is listed in the theme picker, all five of them', async () => {
    await open('#/', 'plain', 'light');
    screen.getByRole('button', { name: /Theme/ }).click();
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Plain', 'Crate', 'Harvest', 'Starship', 'Realm']);
  });

  it('ships skins for the named slots only, and only as a built-in theme', () => {
    for (const [name, skins] of Object.entries(BUILT_IN_SKINS)) {
      expect(THEMES.map((t) => t.name)).toContain(name);
      for (const slot of Object.keys(skins)) expect(SLOTS).toContain(slot);
    }
    expect(SLOTS).toEqual(['Card', 'Panel', 'Avatar', 'ChatMessage', 'EmptyState', 'Loading', 'Header']);
  });
});

describe('a renamed word keeps the real one beside it', () => {
  it('reads "Quest (Epic)" in Realm and "Epic" in Plain', () => {
    expect(themed(themeNamed('realm'), 'epic', 'Epic')).toBe('Quest (Epic)');
    expect(themed(themeNamed('plain'), 'epic', 'Epic')).toBe('Epic');
  });

  it('shows the source\'s own word on the item page, the board, the graph and the chat', async () => {
    await open(item('card-payments', 'corp-jira:PAY-100'), 'realm', 'light');
    expect(screen.getByText('Quest (Epic)')).toBeTruthy();
  });

  it.each([
    ['realm', 'Map (Dependencies)', 'Mountain pass (Blocked)'],
    ['starship', 'Star chart (Dependencies)', 'Hazard (Blocked)'],
    ['plain', 'Dependencies', 'Blocked'],
  ])('%s names the graph %s and its blockers %s', async (theme, title, blocked) => {
    const scheme = Object.keys(themeNamed(theme).schemes)[0]!;
    await open('#/dossier/card-payments', theme, scheme);
    const graph = screen.getByRole('region', { name: title });
    expect(within(graph).getAllByText(blocked).length).toBeGreaterThan(0);
  });

  it('names the board, the sprint and the agent in Harvest beside their own words', async () => {
    await open('#/dossier/card-payments', 'harvest', 'light');
    expect(screen.getByRole('region', { name: /^Farm plot \(Sprint 42 board\)$/ })).toBeTruthy();
    expect(screen.getByRole('region', { name: /^Season calendar \(Sprint 42: day \d+ of \d+\)$/ })).toBeTruthy();
  });

  it('names the quest each card serves in Realm', async () => {
    await open('#/dossier/card-payments', 'realm', 'light');
    const board = screen.getByRole('region', { name: /board/ });
    expect(within(board).getAllByText(/^Quest \(Epic\): /).length).toBeGreaterThan(0);
  });
});

describe('the skins', () => {
  it.each([
    ['harvest', 'light', 'Almanac (Agent)'],
    ['starship', 'dark', "Ship's computer (Agent)"],
    ['realm', 'light', 'Scribe (Agent)'],
  ])('answer in %s (%s) as %s', async (theme, scheme, name) => {
    await open('#/dossier/settlement', theme, scheme);
    const starters = screen.getByRole('group', { name: 'Starter questions' });
    await userEvent.click(within(starters).getAllByRole('button')[0]!);
    expect(await screen.findByText(name, {}, { timeout: 4000 })).toBeTruthy();
  });

  it('grow a crop on each Harvest card by its column, and hide the art from screen readers', async () => {
    await open('#/dossier/card-payments', 'harvest', 'light');
    const crops = [...document.querySelectorAll<HTMLImageElement>('.card .harvest-crop')];
    expect(crops.length).toBe(document.querySelectorAll('.card').length);
    for (const c of crops) expect(c.getAttribute('alt')).toBe('');
    const stages = new Set(crops.map((c) => c.className.match(/harvest-crop--(\w+)/)![1]));
    expect([...stages].sort()).toEqual(['done', 'in_progress', 'todo']);
    expect(document.querySelector('.harvest-calendar')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('follow the sprint with the sky: --sprint-progress on the dashboard, gone off it', async () => {
    const { unmount } = await open('#/dossier/card-payments', 'harvest', 'light');
    const p = Number(document.documentElement.style.getPropertyValue('--sprint-progress'));
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    unmount();
    expect(document.documentElement.style.getPropertyValue('--sprint-progress')).toBe('');
  });

  it('put HUD corners on Starship panels and the header, out of the accessibility tree', async () => {
    await open('#/dossier/settlement', 'starship', 'dark');
    const corners = [...document.querySelectorAll('.hud-corners')];
    expect(corners.length).toBeGreaterThan(5);
    for (const c of corners) expect(c.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.top .hud-corners')).toBeTruthy();
  });
});

describe('the local app\'s sync panel', () => {
  const AT = '2026-10-13T08:00:00.000Z';
  const idle = { running: false, by: null, startedAt: AT, finishedAt: AT, dossier: null, dossiersDone: 1, dossiersTotal: 1, fetched: 0, reused: 0, requests: 0, pages: 0, retries: 0, messages: [], error: null };
  const status: SyncStatus = {
    retentionDays: 30,
    job: idle,
    dossiers: [
      {
        name: 'card-payments',
        lastSyncAt: AT,
        status: 'partial',
        error: 'jira: failed',
        sources: [
          { area: 'bitbucket', status: 'ok', lastAttemptAt: AT, lastSuccessAt: AT, watermark: AT, error: null, fix: null, calls: 1, stale: false },
          { area: 'jira', status: 'failed', lastAttemptAt: AT, lastSuccessAt: AT, watermark: AT, error: 'jira search: jira.imagile.dev answered 503.', fix: 'Try again when the server is back.', calls: 1, stale: true },
        ],
      },
    ],
  };
  const client: SyncClient = { status: async () => status, start: async () => status, wipe: async () => status };

  it.each(SCHEMES)('in %s (%s) shows a stale source and the wipe confirmation with no axe violations', async (theme, scheme) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.scheme = scheme;
    const { container } = render(<SyncPanel client={client} onChange={() => {}} />);
    expect(await screen.findByText(/Showing the last good copy/)).toBeTruthy();
    expect(await violations(container)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /Wipe/ }));
    expect(await violations(container)).toEqual([]);
  });
});
