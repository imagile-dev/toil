import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';

/**
 * The Charts tab, the Work mix and Releases dashboards, the drill drawer, the
 * filter bar in the address and the Summary's Work mix tile (#567), on the
 * sample team, whose figures docs/sample-team.md and toil's own sample facts hold.
 */

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

async function open(hash: string) {
  window.location.hash = hash;
  const view = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview />);
  return view;
}
const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};
/** Waits for an element to exist: a bare querySelector in waitFor returns null without failing, so this throws until it is there. */
const until = <T extends Element>(selector: string) =>
  waitFor(() => {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`no ${selector} yet`);
    return el;
  });
const TEAM = '#/project/sample-team';

describe('the Charts list', () => {
  it('shows both headlines for the sample team, from the data', async () => {
    await open(`${TEAM}/charts`);
    const mix = await until<HTMLElement>('[data-chart-card="mix"]');
    expect(mix.textContent).toMatch(/Feature \d+% · Keep the lights on \d+% · Unsure \d+%/);
    const f = SAMPLE_TEAM.facts.releases.find((r) => r.name === '2.4')!;
    const card = document.querySelector('[data-chart-card="releases"]') as HTMLElement;
    expect(card.textContent).toContain(`2.4 due`);
    expect(card.textContent).toContain(`${Math.round((f.done / f.items) * 100)}% done, ${f.scopeAdded} added since it started`);
    expect(screen.getByRole('link', { name: 'Charts' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows a dash with its reason, not 0, where fix versions were never read', async () => {
    await open('#/project/card-payments/charts');
    const card = await until<HTMLElement>('[data-chart-card="releases"]');
    expect(card.textContent).toContain("fix versions weren't read");
    expect(card.querySelector('[aria-label="not read yet"]')).toBeTruthy();
    expect(card.textContent).not.toMatch(/\b0\b/);
  });
});

describe('Work mix', () => {
  it('draws the trend, says how it was decided beside it, and splits by any dimension', async () => {
    await open(`${TEAM}/charts/mix`);
    const decided = await until<HTMLElement>('[data-decided]');
    expect(decided.textContent).toMatch(/Rules \d+%Labels on the items \d+%Your AI agent 0%People 0%Unsure \d+%/);
    expect(decided.querySelector('a[data-unsure-link]')!.getAttribute('href')).toBe('#/project/sample-team/board?category=none');
    expect(screen.getAllByText(/Work mix by month/).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-mix-lead]')!.textContent).toMatch(/Feature \d+% · Keep the lights on \d+% · Unsure \d+%, last 90 days/);
    await go(`${TEAM}/charts/mix?split=team`);
    await waitFor(() => expect(screen.getAllByText(/Work mix by team/).length).toBeGreaterThan(0));
  });

  it('keeps the filters when an item opens, and lists the right count from a notable change', async () => {
    await open(`${TEAM}/charts/mix`);
    const door = await until<HTMLAnchorElement>('[data-door]');
    await go(door.getAttribute('href')!);
    const drawer = await until<HTMLElement>('[data-drill]');
    const n = Number(drawer.getAttribute('data-drill'));
    expect(n).toBeGreaterThan(0);
    expect(drawer.querySelectorAll('tbody tr')).toHaveLength(n);
    expect(drawer.querySelector('[data-drill-count]')!.textContent).toMatch(new RegExp(`^${n} items?`));
    const first = within(drawer).getAllByRole('link', { name: /Jira SHOP/ })[0] as HTMLAnchorElement;
    expect(first.getAttribute('href')).toContain('items=');
    await go(first.getAttribute('href')!);
    const one = await until<HTMLElement>('[data-drawer]');
    const back = within(one).getByRole('link', { name: 'Close the drawer' }).getAttribute('href')!;
    expect(back).toContain('items=');
    expect(back).not.toContain('item=sample');
  });

  it('shows a filter chip from the address and removes it', async () => {
    await open(`${TEAM}/charts/mix?release=2.4`);
    const chip = await until<HTMLElement>('[data-filter-chip="release=2.4"]');
    expect(chip.textContent).toContain('Fix version: 2.4');
    await act(async () => within(chip).getByRole('button', { name: 'Remove Fix version: 2.4' }).click());
    expect(window.location.hash).toBe(`${TEAM}/charts/mix`);
  });
});

describe('Releases', () => {
  it('shows 2.4 with the sample facts, and a dash where a release has no start date', async () => {
    await open(`${TEAM}/charts/releases`);
    const section = await until<HTMLElement>('[data-release="2.4"]');
    const f = SAMPLE_TEAM.facts.releases.find((r) => r.name === '2.4')!;
    const text = section.querySelector('.release__figures')!.textContent!;
    expect(text).toContain(`${f.items} in it`);
    expect(text).toContain(`${f.done} done`);
    expect(text).toContain(`${f.open} left`);
    expect(text).toContain(`${f.scopeAdded} added since it started`);
    expect((section as HTMLDetailsElement).open).toBe(true);
    expect(document.querySelector('[data-release="2.5"]')).toBeTruthy();
    expect(within(section).getAllByText(/Burn-up: 2.4/).length).toBeGreaterThan(0);
  });

  it('says fix versions were not read, with the sentence, where they were not', async () => {
    await open('#/project/card-payments/charts/releases');
    await waitFor(() => expect(screen.getByText(/Fix versions weren't read/)).toBeTruthy());
  });
});

describe('the Summary', () => {
  it('has a Work mix tile that opens the dashboard, and a link in Go to', async () => {
    await open(TEAM);
    const tile = await until<HTMLElement>('[data-metric="mix"]');
    expect(tile.textContent).toMatch(/Work mix.*Feature \d+%.*Keep the lights on \d+%.*Unsure \d+%.*last 90 days/);
    expect(tile.querySelector('a')!.getAttribute('href')).toBe('#/project/sample-team/charts/mix');
    expect(tile.querySelector('.metric__cat')!.getAttribute('title')).toMatch(/^(Feature|KTLO): /);
    expect(document.querySelector('.briefing__links a[href="#/project/sample-team/charts"]')).toBeTruthy();
    expect(document.querySelector('[data-work-lines]')!.textContent).toContain('2.4 due');
  });

  it('shows a dash, not 0%, when nothing could be counted', async () => {
    await open('#/project/checkout-web');
    const tile = await until<HTMLElement>('[data-metric="mix"]');
    expect(tile.textContent).not.toContain('0%');
  });
});
