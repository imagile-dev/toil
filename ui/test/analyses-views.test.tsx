import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import type { AnalysesApi } from '../src/analyses.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureAnalyses } from '../src/fixtures/analyses.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { askBar } from './chat.ts';

/**
 * The history of analyses in the views (#395), on the sample's: the Analyses
 * tab and what changed, one analysis opened again, the Overview's
 * recommendation from the latest one, the sidebar's Recent analyses, an
 * Analyze in the chat laid out top-down and joining the history, and the
 * citation chips with their detail.
 */

async function open(hash: string, analyses: AnalysesApi | undefined = fixtureAnalyses()) {
  window.location.hash = hash;
  const view = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview {...(analyses ? { analyses } : {})} />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const list = () => screen.findByRole('list', { name: 'Analyses, newest first' });

describe('the Analyses tab', () => {
  it('lists every analysis newest first, with its time, who wrote it, its recommendation, and what changed since the one before', async () => {
    await open('#/dossier/card-payments/analyses');
    const entries = within(await list()).getAllByRole('listitem').filter((li) => li.classList.contains('analysis'));
    expect(entries).toHaveLength(2);
    const [latest, first] = entries as [HTMLElement, HTMLElement];
    expect(latest.textContent).toContain('12 Oct 2026, 16:30 UTC, by the scripted preview, not a model.');
    expect(latest.querySelector('.analysis__rec')!.textContent).toContain("Fix");
    // The recommendation's citations are chips: key, title and status.
    const chip = within(latest.querySelector('.analysis__rec') as HTMLElement).getAllByRole('link')[0]!;
    expect(chip.getAttribute('aria-label')).toMatch(/^Jira PAY-101 .+, In Progress$/);
    expect(latest.textContent).toContain('Since the one before: 1 newly blocked, 1 cleared, points moved on 1 item, sprint points moved');
    expect(first.textContent).toContain('The first analysis kept, so there is nothing to compare it with.');

    // What changed, opened: the newly blocked item with what blocks it, the cleared one, the points and the sprint.
    await userEvent.click(within(latest).getByText(/^Since the one before/));
    const changes = latest.querySelector('.analysis-changes') as HTMLElement;
    expect(within(changes).getByText('Newly blocked')).toBeTruthy();
    expect(changes.textContent).toMatch(/PAY-103.*by.*PAY-102/s);
    expect(within(changes).getByText('Cleared').nextElementSibling!.textContent).toContain('PAY-104');
    expect(within(changes).getByText('Points moved').nextElementSibling!.textContent).toMatch(/PAY-102.*\d+ points? to \d+ points?/s);
    expect(within(changes).getByText('The sprint').nextElementSibling!.textContent).toBe('Sprint 42: 0 done, 21 left, then Sprint 42: 3 done, 18 left.');
    expect(latest.querySelector('.analysis__open a')!.textContent).toBe('Open the analysis of 12 Oct 2026, 16:30 UTC');
    expect(latest.querySelector('.analysis__open a')!.getAttribute('href')).toBe('#/dossier/card-payments/analyses/sample-analysis-2');
  });

  it('says so when a dossier has none yet', async () => {
    await open('#/dossier/settlement/analyses');
    expect(await screen.findByText(/No analysis kept for this dossier yet/)).toBeTruthy();
  });

  it('opens one again, top-down, with its evidence folded and what changed', async () => {
    await open('#/dossier/card-payments/analyses/sample-analysis-2');
    const panel = await screen.findByRole('region', { name: /^Analysis of 12 Oct 2026/ });
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Recommendation', 'Issues', 'What changed since the one before']);
    const issues = within(within(panel).getByRole('region', { name: 'Issues' })).getAllByRole('listitem');
    expect(issues.map((li) => li.querySelector('strong')?.textContent)).toEqual(['Build failing: ', 'Blocked chain: ', 'Aging carry-over: ']);
    const evidence = panel.querySelector('details.analysis-evidence') as HTMLDetailsElement;
    expect(evidence.open).toBe(false);
    expect(evidence.querySelector('summary')!.textContent).toMatch(/^Evidence \(\d+ paragraphs\)$/);
    expect(within(panel).getByRole('link', { name: 'All analyses' }).getAttribute('href')).toBe('#/dossier/card-payments/analyses');
    expect(panel.textContent).toContain('Newly blocked');
  });

  it('says plainly when the history no longer has one', async () => {
    await open('#/dossier/card-payments/analyses/gone');
    expect(await screen.findByRole('heading', { level: 2, name: 'Analysis not found' })).toBeTruthy();
    expect(document.body.textContent).toContain('card-payments has no analysis by that id');
  });
});

describe("the Overview's recommendation", () => {
  it("is the latest analysis's, with its time and a link, and says so", async () => {
    await open('#/dossier/card-payments');
    const card = await screen.findByRole('region', { name: /^Recommendation/ });
    await waitFor(() => expect(card.dataset.recSource).toBe('analysis'));
    expect(card.textContent).toContain('From the latest Analyze, 12 Oct 2026, 16:30 UTC, by the scripted preview, not a model.');
    expect(within(card).getByRole('link', { name: 'Open the analysis' }).getAttribute('href')).toBe('#/dossier/card-payments/analyses/sample-analysis-2');
    expect(card.querySelector('.overview-rec__headline')!.textContent).toContain('Fix');
  });

  it('falls back to the code\'s, and says so, where there is no analysis', async () => {
    await open('#/dossier/settlement');
    const card = await screen.findByRole('region', { name: /^Recommendation/ });
    expect(card.dataset.recSource).toBe('code');
    expect(card.textContent).toContain('Worked out by code, with no agent call');
    expect(card.textContent).toContain('No Analyze kept for this dossier yet.');
  });
});

describe('Analyze in the chat', () => {
  it('lays the answer out top-down with its evidence folded, keeps it, and the tab, sidebar and Overview follow', async () => {
    // No history given: the App keeps this page's own, which starts empty.
    await open('#/dossier/checkout-web', undefined);
    const card = await screen.findByRole('region', { name: /^Recommendation/ });
    expect(card.dataset.recSource).toBe('code');
    await userEvent.click(within(askBar('checkout-web')).getByRole('button', { name: 'Analyze' }));
    const chat = await screen.findByRole('dialog', { name: 'Ask about checkout-web' });
    const kept = await within(chat).findByRole('link', { name: 'Kept in Analyses' }, { timeout: 5000 });
    expect(within(chat).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Recommendation', 'Issues']);
    expect((chat.querySelector('details.analysis-evidence') as HTMLDetailsElement).open).toBe(false);
    // Every citation in the answer is a chip naming its key, title and status.
    const chips = chat.querySelectorAll('.ticket-chip--cite');
    expect(chips.length).toBeGreaterThan(5);
    expect([...chips].every((c) => c.querySelector('.ticket-chip__key') && c.querySelector('.ticket-chip__title') && c.querySelector('.ticket-chip__status'))).toBe(true);

    await userEvent.click(kept);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask about checkout-web' })).toBeNull());
    expect(await screen.findByRole('region', { name: /^Analysis of / })).toBeTruthy();
    window.location.hash = '#/dossier/checkout-web';
    await waitFor(() => expect(screen.getByRole('region', { name: /^Recommendation/ }).dataset.recSource).toBe('analysis'));
  });
});

describe('a citation chip', () => {
  it('shows its detail on focus: type and status, assignee, estimate, sprint', async () => {
    await open('#/dossier/card-payments/analyses');
    const chip = within((await list()).querySelector('.analysis__rec') as HTMLElement).getAllByRole('link')[0]!;
    await userEvent.tab();
    chip.focus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await userEvent.tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('PAY-101');
    expect(tip.textContent).toMatch(/Assignee: /);
    expect(tip.textContent).toMatch(/Estimate: /);
    expect(tip.textContent).toContain('Sprint: Sprint 42');
  });
});

describe('the sidebar', () => {
  it("lists the dossier's three newest analyses, each linking to it", async () => {
    await open('#/dossier/card-payments');
    await userEvent.click(screen.getByRole('button', { name: /^Agents/ }));
    const side = await screen.findByRole('region', { name: 'Agents' });
    const recent = within(side).getByRole('region', { name: 'Recent analyses' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(2));
    const links = within(recent).getAllByRole('link');
    expect(links[0]!.getAttribute('href')).toBe('#/dossier/card-payments/analyses/sample-analysis-2');
    expect(links[0]!.textContent).toContain('Fix PAY-101');
    expect(links.at(-1)!.textContent).toBe('All analyses');
  });
});
