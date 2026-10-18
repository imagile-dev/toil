import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureStore } from '../src/fixtures/store.ts';

/**
 * The views, rendered against the fixture Store and the scripted Agent: the
 * same pair the site preview runs on, used here as the test harness (#206).
 */

const ROUTES = ['#/board', '#/health', '#/trace', `#/item/${encodeURIComponent('corp-jira:PAY-101')}`];

async function open(hash: string, preview = true) {
  window.location.hash = hash;
  const view = render(<App store={fixtureStore()} agent={scriptedAgent()} preview={preview} />);
  await screen.findByRole('heading', { level: 1 });
  return view;
}

/** axe's rules, less colour contrast, which jsdom can't compute (themes.test.ts checks the tokens). */
async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('every view', () => {
  it.each(ROUTES)('%s carries the preview banner, the views and the sync time', async (hash) => {
    await open(hash);
    expect(screen.getByRole('note')?.textContent).toContain('Preview of an unreleased product.');
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Board', 'Sprint health', 'Traceability']);
    expect(screen.getByText(/Sample data synced 13 Oct 2026, 08:00 UTC/)).toBeTruthy();
  });

  it.each(ROUTES.flatMap((r) => [[r, 'plain'], [r, 'crate']]))('%s in %s has no axe violations', async (hash, theme) => {
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme }));
    const { container } = await open(hash);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(await violations(container)).toEqual([]);
  });

  it('has no banner outside the preview', async () => {
    await open('#/board', false);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('marks the current view in the navigation', async () => {
    await open('#/trace');
    expect(screen.getByRole('link', { name: 'Traceability' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Board' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('the board', () => {
  it("shows the sprint's eighteen items in three columns", async () => {
    await open('#/board');
    const count = (name: RegExp) => within(screen.getByRole('region', { name })).queryAllByRole('article').length;
    expect([count(/^To do/), count(/^In progress/), count(/^Done/)]).toEqual([7, 6, 5]);
  });

  it("shows each source's own words beside OWI's", async () => {
    await open('#/board');
    const card = screen.getByRole('article', { name: /PAY-104/ });
    expect(card?.textContent).toContain('In Review'); // Jira's status, in the In progress column.
    expect(card?.textContent).toContain('2 points (Story Points)');
    expect(card?.textContent).toContain('Carried over');
    expect(screen.getByRole('article', { name: /payments-web#41/ })?.textContent).toContain('Feature (Other)');
    expect(screen.getByRole('article', { name: /payments-web#42/ })?.textContent).toContain('bo-web');
  });

  it('filters by source', async () => {
    await open('#/board');
    await userEvent.click(screen.getByRole('checkbox', { name: 'GitHub' }));
    expect(screen.getAllByRole('article')).toHaveLength(13);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Jira' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Azure DevOps' }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getAllByText('Nothing here with these filters.')).toHaveLength(3);
  });
});

describe('sprint health', () => {
  it('shows the figures and the reasons behind each risk', async () => {
    await open('#/health');
    expect(screen.getByRole('list', { name: 'Sprint figures' })?.textContent).toContain('Done5 of 48points, 5 items');
    const risks = screen.getByRole('region', { name: 'At risk' });
    expect(within(risks).getAllByRole('link', { name: /PAY-103/ })[0]!.closest('li')?.textContent).toContain('Blocked by Jira PAY-102');
    expect(screen.getByRole('region', { name: 'Added after the sprint started' })?.textContent).toContain('github projects list-items: createdAt');
  });

  it('answers a starter question with links to every item it cites', async () => {
    await open('#/health');
    await userEvent.click(screen.getByRole('button', { name: 'Why is this sprint at risk?' }));
    const answer = await screen.findByRole('heading', { level: 3, name: 'Why is this sprint at risk?' });
    const pane = answer.parentElement!;
    const hrefs = within(pane).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`#/item/${encodeURIComponent('corp-ado:2303')}`);
    expect(pane?.textContent).toContain('Answered by: a scripted preview, not a model.');
    expect(screen.getByRole('button', { name: 'Why is this sprint at risk?' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a failing Store or Agent', () => {
  it('says the agent failed, in the answer pane, when ask() rejects', async () => {
    const agent = { ...scriptedAgent(), ask: () => Promise.reject(new Error('model endpoint unreachable')) };
    window.location.hash = '#/health';
    render(<App store={fixtureStore()} agent={agent} preview />);
    await userEvent.click(await screen.findByRole('button', { name: 'Why is this sprint at risk?' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("The agent couldn't answer: model endpoint unreachable");
    expect(screen.getByRole('button', { name: 'Why is this sprint at risk?' }).hasAttribute('disabled')).toBe(false);
  });

  it('says the data did not load when the Store rejects', async () => {
    const store = { ...fixtureStore(), items: () => Promise.reject(new Error('cache unreadable')) };
    window.location.hash = '#/board';
    render(<App store={store} agent={scriptedAgent()} preview />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("The data didn't load");
    expect(alert.textContent).toContain('cache unreadable');
  });
});

describe('traceability', () => {
  it('flags the gaps between tickets, changes and builds', async () => {
    await open('#/trace');
    const row = (name: RegExp) => screen.getByRole('rowheader', { name }).closest('tr')!;
    expect(row(/PAY-101/)?.textContent).toContain('Latest build failed');
    expect(row(/PAY-101/)?.textContent).toContain('FAILURE');
    expect(row(/2307/)?.textContent).toContain('Done with no linked change');
    expect(row(/PAY-105/)?.textContent).toContain('No gaps');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Only items with something to check' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
  });
});

describe('an item', () => {
  it('shows each mapped field with the field it came from', async () => {
    await open(`#/item/${encodeURIComponent('corp-ado:2306')}`);
    expect(screen.getByRole('heading', { level: 1 })?.textContent).toContain('Reconcile chargebacks against settlements');
    expect(screen.getByText('Microsoft.VSTS.Scheduling.StoryPoints')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Azure DevOps' }).getAttribute('href')).toBe(
      'https://ado.imagile.dev/DefaultCollection/Payments/_workitems/edit/2306',
    );
    expect(screen.getByText(/added mid-sprint/)).toBeTruthy();
  });

  it('says so when the item is not in the Store', async () => {
    await open('#/item/corp-jira%3ANOPE-1');
    expect(screen.getByRole('heading', { level: 1 })?.textContent).toContain('No such item');
  });
});

describe('keyboard and focus', () => {
  it('starts with a skip link, and a new view moves focus to its heading', async () => {
    await open('#/board');
    (document.activeElement as HTMLElement | null)?.blur(); // Start from the top of the page.
    await userEvent.tab();
    expect(document.activeElement?.textContent).toContain('Skip to content');
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Board' }));
    await act(async () => {
      window.location.hash = '#/trace';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Traceability' })));
  });
});

describe('themes', () => {
  it('switches between Plain and Crate without changing the layout, and remembers the choice', async () => {
    await open('#/health');
    const before = screen.getAllByRole('button').map((b) => b.textContent);
    expect(document.documentElement.dataset.theme).toBe('plain');
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toBeTruthy();
    expect(document.querySelector('.ask img')).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'crate');
    expect(document.documentElement.dataset.theme).toBe('crate');
    // Crate is dark only, so there's no appearance to choose; its crate stars in the empty state.
    expect(screen.queryByRole('combobox', { name: 'Appearance' })).toBeNull();
    expect(document.querySelector('.ask img')?.getAttribute('alt')).toBe('');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(before);
    expect(JSON.parse(localStorage.getItem('toil-ui.theme')!)).toEqual({ theme: 'crate', scheme: 'system' });
  });

  it('takes the theme and scheme from the address first', async () => {
    window.history.replaceState(null, '', '/?theme=plain&scheme=dark');
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'crate' }));
    await open('#/board');
    expect(document.documentElement.dataset.theme).toBe('plain');
    expect(document.documentElement.dataset.scheme).toBe('dark');
    window.history.replaceState(null, '', '/');
  });
});
