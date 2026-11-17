// @vitest-environment jsdom
// A ticket rule is a checklist item written down once and read aloud by code, which is the only kind nobody asks to re-attest.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AssignmentsApi } from '../src/assign/model.ts';
import { fixtureAssignments } from '../src/fixtures/assignments.ts';
import { fixtureStandards } from '../src/fixtures/standards.ts';
import { item, open, panel, resetBrowserState } from './views-kit.tsx';

/**
 * Ticket rules on screen (#657): the rule rows on an item's page and Fix with
 * AI agent on a row that misses, the dialog with and without an AI agent, the
 * Command Center's Ticket rules card and the list it drills to, and the Work
 * mix's Sort by, which views another built-in scheme without saving anything.
 */

beforeEach(resetBrowserState);

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};
const ruleRows = () => within(document.querySelector<HTMLElement>('[data-rule-rows]')!).getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('the rule rows on an item (#657)', () => {
  it('lists each rule that applies under its own heading, and offers Fix with AI agent only where the item misses one', async () => {
    await open(item('card-payments', 'corp-jira:PAY-103'), { rules: fixtureStandards(), assignments: fixtureAssignments({ delay: 0 }) });
    await waitFor(() => expect(document.querySelector('[data-rule-rows]')).not.toBeNull());
    const box = panel('Ready for an agent?');
    expect(within(box).getByRole('heading', { name: /Ticket rules/ })).toBeTruthy();
    expect(ruleRows()).toEqual([expect.stringMatching(/^Acceptance criteria as Given\/When\/Then Thin: None of the 3 patterns was found/)]);
    expect(within(box).getByRole('button', { name: 'Fix with AI agent: Acceptance criteria as Given/When/Then' })).toBeTruthy();
  });

  it('shows no Fix on a rule the item meets', async () => {
    await open(item('card-payments', 'corp-jira:PAY-101'), { rules: fixtureStandards(), assignments: fixtureAssignments({ delay: 0 }) });
    await waitFor(() => expect(document.querySelector('[data-rule-rows]')).not.toBeNull());
    expect(ruleRows()[0]).toMatch(/^Acceptance criteria as Given\/When\/Then Passes/);
    expect(screen.queryByRole('button', { name: /Fix with AI agent/ })).toBeNull();
  });

  it('asks the AI agent, then opens the assignment with its one proposal and its questions', async () => {
    await open(item('card-payments', 'corp-jira:PAY-103'), { rules: fixtureStandards(), assignments: fixtureAssignments({ delay: 0 }) });
    await userEvent.click(await screen.findByRole('button', { name: /Fix with AI agent/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Fix with AI agent' });
    expect(dialog.textContent).toContain('State the acceptance criteria as scenarios');
    expect(dialog.textContent).toContain('What toil found');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fix with AI agent' }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/project\/card-payments\/assignment\//));
    await go(window.location.hash);
    await waitFor(() => expect(document.body.textContent).toContain('Rewrite the acceptance criteria of PAY-103 to meet "Acceptance criteria as Given/When/Then"'), { timeout: 4000 });
  });

  it('says no AI agent is set up, and links to setting one up, rather than offering a button that can only fail', async () => {
    const real = fixtureAssignments({ delay: 0 });
    const none: AssignmentsApi = { ...real, list: async (p, o) => ({ ...(await real.list(p, o)), adapters: (await real.list(p, o)).adapters.map((a) => ({ ...a, problem: `${a.label} isn't signed in.` })) }) };
    await open(item('card-payments', 'corp-jira:PAY-103'), { rules: fixtureStandards(), assignments: none });
    await userEvent.click(await screen.findByRole('button', { name: /Fix with AI agent/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Fix with AI agent' });
    await waitFor(() => expect(dialog.querySelector('[data-no-agent]')).not.toBeNull());
    expect(within(dialog).getByRole('link', { name: 'Set up an AI agent' }).getAttribute('href')).toBe('#/settings/agent');
    expect(within(dialog).queryByRole('button', { name: 'Fix with AI agent' })).toBeNull();
  });
});

describe("the Command Center's Ticket rules card (#657)", () => {
  it('says how many open items miss each rule, and each line filters the list to them', async () => {
    await open('#/project/card-payments/command-center', { rules: fixtureStandards() });
    const card = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-ticket-rules] ul');
      if (!el) throw new Error('not yet');
      return el.closest<HTMLElement>('[data-ticket-rules]')!;
    });
    const line = within(card).getByRole('link', { name: "2 of 4 stories miss 'Acceptance criteria as Given/When/Then'" });
    expect(within(card).getByRole('link', { name: "1 of 1 bug misses 'Steps to reproduce'" })).toBeTruthy();
    await go(line.getAttribute('href')!);
    await waitFor(() => expect(document.querySelector('[data-rule-filter]')).not.toBeNull());
    expect(document.querySelector('[data-rule-filter]')!.textContent).toContain('Missing: Acceptance criteria as Given/When/Then');
    const table = screen.getByRole('table', { name: /items and their readiness/ });
    const keys = within(table).getAllByRole('rowheader').map((h) => /PAY-\d+/.exec(h.textContent ?? '')![0]);
    expect(keys.sort()).toEqual(['PAY-103', 'PAY-107']);
  });

  it('is a dash, not read yet, until the check comes back', async () => {
    await open('#/project/card-payments/command-center');
    const card = await waitFor(() => document.querySelector<HTMLElement>('[data-ticket-rules]')!);
    expect(card.textContent).toContain('– not read yet');
  });

  it('is not there for a Toil project that names no rules', async () => {
    await open('#/project/settlement/command-center', { rules: fixtureStandards() });
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('[data-ticket-rules]')).toBeNull();
  });
});

describe("the Work mix's Sort by (#657)", () => {
  it('views the mix by flow, in the address, and says the saved categories are unchanged', async () => {
    await open('#/project/sample-team/summary/mix');
    const select = await screen.findByRole('button', { name: /Sort by/ });
    expect(select.textContent).toContain('Keep the lights on / Feature (saved)');
    await go('#/project/sample-team/summary/mix?lens=flow');
    await waitFor(() => expect(document.querySelector('[data-mix-lens="flow"]')).not.toBeNull());
    expect(document.querySelector('[data-mix-lens]')!.textContent).toContain('Sorted by Feature / Defect / Risk / Debt for this view only');
    expect(document.querySelector('[data-mix-lead]')!.textContent).toMatch(/Defect \d+%/);
  });
});
