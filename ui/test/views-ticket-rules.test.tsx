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
 * Command Center's Ticket rules card and the list it drills to, the
 * assignment page a fix opens (the proposal first, the command one press in),
 * and the Work mix's Categories, which views another built-in scheme without
 * saving anything.
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
    // The reason is toil's own words (src/core/standards), so it is matched loosely here.
    expect(ruleRows()).toEqual([expect.stringMatching(/^Acceptance criteria as Given\/When\/Then Thin: \S/)]);
    // The row's source is one press in: in the page, folded under the row's own disclosure.
    expect(document.querySelector('[data-rule-rows] details:not([open]) .field')!.textContent).toMatch(/^Source: /);
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
    expect(dialog.textContent).toContain("What's missing");
    expect(dialog.textContent).toContain('Nothing changes in Jira until you apply it.');
    expect(dialog.textContent).not.toMatch(/approve/i);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for a rewrite' }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/project\/card-payments\/assignment\//));
    await go(window.location.hash);
    await waitFor(() => expect(document.body.textContent).toContain('Rewrite the acceptance criteria of PAY-103 to meet "Acceptance criteria as Given/When/Then"'), { timeout: 4000 });
  });

  it('offers one Fix all on a standard with several misses, which asks for one rewrite that meets them all', async () => {
    const rules = fixtureStandards();
    const bug = (await rules.check('card-payments')).result!.items.find((i) => i.results.filter((r) => r.standard === 'bug-repro' && r.state !== 'pass').length === 3)!;
    await open(item('card-payments', bug.id), { rules, assignments: fixtureAssignments({ delay: 0 }) });
    await waitFor(() => expect(document.querySelector('[data-rule-group="bug-repro"]')).not.toBeNull());
    const group = document.querySelector<HTMLElement>('[data-rule-group="bug-repro"]')!;
    expect(within(group).getAllByRole('button', { name: /Fix/ }).map((b) => b.textContent)).toEqual([expect.stringMatching(/^Fix all 3 with AI agent/)]);
    await userEvent.click(within(group).getByRole('button', { name: /Fix all 3/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Fix with AI agent' });
    for (const name of ['Steps to reproduce', 'Expected result', 'Actual result']) expect(dialog.textContent).toContain(name);
    expect(dialog.textContent).toContain('Ticket rules');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for a rewrite' }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/project\/card-payments\/assignment\//));
    await go(window.location.hash);
    await waitFor(() => expect(document.querySelector('[data-assignment-rule]')?.textContent).toBe('To meet the ticket rules Steps to reproduce, Expected result and Actual result.'));
    await waitFor(() => expect(document.body.textContent).toContain('to meet 3 ticket rules'), { timeout: 4000 });
  });

  it("leads a fix's page with what to do, and puts the change and Apply before the command", async () => {
    await open(item('card-payments', 'corp-jira:PAY-103'), { rules: fixtureStandards(), assignments: fixtureAssignments({ delay: 0 }) });
    await userEvent.click(await screen.findByRole('button', { name: /Fix with AI agent/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Fix with AI agent' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for a rewrite' }));
    await waitFor(() => expect(window.location.hash).toMatch(/assignment\//));
    await go(window.location.hash);
    const card = await waitFor(() => screen.getByRole('article', { name: /Proposal: Rewrite the acceptance criteria of PAY-103/ }), { timeout: 4000 });
    expect(document.querySelector('[data-assignment-rule]')!.textContent).toBe('To meet the ticket rule Acceptance criteria as Given/When/Then.');
    expect(document.querySelector('[data-assignment-lead]')!.textContent).toBe('Nothing has changed yet. Review the proposal below and apply it.');
    // The run's times and figures are one press in.
    expect(document.querySelector('[data-assignment-run]:not([open])')!.textContent).toMatch(/Created .*sample figures/);
    // Under the title: the field table, by its plain name, then Apply; the command and its advice are in a closed disclosure, never in red.
    const order = [...card.querySelectorAll('h3, table, .proposal-actions, details')].map((e) => e.tagName.toLowerCase() + (e.classList.contains('proposal-actions') ? '.actions' : ''));
    expect(order).toEqual(['h3', 'table', 'div.actions', 'details']);
    expect(within(card).getByRole('rowheader').textContent).toMatch(/Acceptance criteria$/);
    expect(card.textContent).toContain('Replaces the acceptance criteria.');
    expect(within(card).getByRole('cell', { name: /Given a customer with a saved card token/ })).toBeTruthy();
    const command = card.querySelector<HTMLDetailsElement>('details[data-proposal-command]')!;
    expect(command.open).toBe(false);
    expect(command.querySelector('summary')!.textContent).toBe('Show the command');
    expect(card.querySelector('.failure')).toBeNull();
    expect(command.querySelector('[data-command-advice]')?.className ?? 'note').toBe('note');
    expect(within(card).getByRole('button', { name: /^Apply/ })).toBeTruthy();
  });

  it('says no AI agent is set up, and links to setting one up, rather than offering a button that can only fail', async () => {
    const real = fixtureAssignments({ delay: 0 });
    const none: AssignmentsApi = { ...real, list: async (p, o) => ({ ...(await real.list(p, o)), adapters: (await real.list(p, o)).adapters.map((a) => ({ ...a, problem: `${a.label} isn't signed in.` })) }) };
    await open(item('card-payments', 'corp-jira:PAY-103'), { rules: fixtureStandards(), assignments: none });
    await userEvent.click(await screen.findByRole('button', { name: /Fix with AI agent/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Fix with AI agent' });
    await waitFor(() => expect(dialog.querySelector('[data-no-agent]')).not.toBeNull());
    expect(within(dialog).getByRole('link', { name: 'Set up an AI agent' }).getAttribute('href')).toBe('#/settings/agent');
    expect(within(dialog).queryByRole('button', { name: 'Ask for a rewrite' })).toBeNull();
    // The details for whoever sets it up are a disclosure with a visible chevron.
    expect(dialog.querySelector('[data-no-agent] details > summary .disclosure-chevron')).not.toBeNull();
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
    const line = within(card).getByRole('link', { name: '2 of 4 stories miss acceptance criteria as Given/When/Then' });
    expect(line.querySelector('strong')!.textContent).toBe('2 of 4');
    // A standard with several rules is one line, and drills to items that miss any of them.
    const repro = within(card).getByRole('link', { name: '1 of 1 bug misses steps to reproduce, expected result and actual result' });
    expect(repro.getAttribute('href')).toContain('rule=bug-repro');
    expect(repro.getAttribute('href')).not.toContain('rule=bug-repro%2F');
    await go(line.getAttribute('href')!);
    await waitFor(() => expect(document.querySelector('[data-rule-filter]')).not.toBeNull());
    expect(document.querySelector('[data-rule-filter]')!.textContent).toContain('Missing: Acceptance criteria as Given/When/Then');
    const table = screen.getByRole('table', { name: /items and their readiness/ });
    const keys = within(table).getAllByRole('rowheader').map((h) => /PAY-\d+/.exec(h.textContent ?? '')![0]);
    expect(keys.sort()).toEqual(['PAY-103', 'PAY-107']);
    // The filtered rule's line leads each item's Why not ready, and Clear takes the filter off.
    for (const row of within(table).getAllByRole('row').slice(1)) expect(row.querySelector('.why-not li')!.textContent).toMatch(/^Acceptance criteria as Given\/When\/Then:/);
    expect(within(document.querySelector<HTMLElement>('[data-rule-filter]')!).getByRole('link', { name: /^Clear/ }).getAttribute('href')).not.toContain('rule=');
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

describe("the Work mix's Categories (#657)", () => {
  it('views the mix by flow, in the address, says the saved categories are unchanged, and goes back to them', async () => {
    await open('#/project/sample-team/summary/mix');
    const select = await screen.findByRole('button', { name: /Categories/ });
    expect(select.textContent).toContain("KTLO: Keep the lights on / Feature (your team's)");
    // It comes first, apart from the menus that cut the chart.
    expect(document.querySelector('.chart-menus > :first-child')!.classList.contains('chart-menus__lens')).toBe(true);
    await go('#/project/sample-team/summary/mix?lens=flow');
    await waitFor(() => expect(document.querySelector('[data-mix-lens="flow"]')).not.toBeNull());
    const note = document.querySelector<HTMLElement>('[data-mix-lens]')!;
    expect(note.textContent).toContain("Viewing as Feature / Defect / Risk / Debt. Your team's saved categories haven't changed.");
    expect(within(note).getByRole('link', { name: 'Back to saved' }).getAttribute('href')).not.toContain('lens=');
    expect(screen.getByRole('button', { name: /Categories/ }).textContent).toContain('Flow: Feature / Defect / Risk / Debt');
    expect(document.querySelector('[data-mix-lead]')!.textContent).toMatch(/Defect \d+%/);
  });
});
