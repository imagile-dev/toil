import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureAssignments } from '../src/fixtures/assignments.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import type { AssignmentsApi } from '../src/assign/model.ts';

/**
 * Assignments in the views (#293), on the sample's queue: the Agents lane
 * and its inbox, the Assign dialog, the assignment page with its proposals
 * and Apply, and each agent's assignments on the People view.
 */

async function open(hash: string, assignments: AssignmentsApi = fixtureAssignments({ delay: 1 })) {
  window.location.hash = hash;
  const view = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview assignments={assignments} />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  return view;
}

async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the Agents lane', () => {
  it('shows the inbox, waiting for Start, and every assignment with its state, mode and adapter', async () => {
    await open('#/dossier/card-payments');
    const lane = await screen.findByRole('region', { name: 'Agents' });
    const inbox = await within(lane).findByRole('region', { name: 'Agent inbox' });
    expect(inbox.textContent).toContain('asked for by the tracker\'s label agent:refine');
    expect(within(inbox).getByRole('button', { name: /^Start/ })).toBeTruthy();
    const cards = within(within(lane).getByRole('list', { name: 'Assignments' })).getAllByRole('listitem');
    expect(cards.map((c) => c.querySelector('.assign-state')?.textContent)).toEqual(['Working', 'Needs you', 'Failed', 'Done']);
    expect(lane.textContent).toContain('2 run at a time, for up to 20 minutes each');
  }, 20_000);

  it('assigns from a board card, through the dialog, onto the assignment page', async () => {
    await open('#/dossier/card-payments');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button').find((b) => b.textContent === 'Assign corp-jira:PAY-103 to an agent…')!);
    const dialog = await screen.findByRole('dialog', { name: 'Assign to an agent' });
    await within(dialog).findByRole('radiogroup', { name: 'Adapter' });
    await user.click(within(dialog).getByRole('radio', { name: /Investigate/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/dossier\/card-payments\/assignment\/sample-new-/));
  }, 20_000);
});

describe('the assignment page', () => {
  it('shows the report, the question and each proposal with its diff and Apply, with no axe violations', async () => {
    const { container } = await open('#/dossier/card-payments/assignment/sample-needsyou-0002');
    await screen.findByRole('heading', { name: 'Proposals' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Refine: Store tokens in the vault');
    expect(screen.getByText(/Which vault holds the tokens in staging/)).toBeTruthy();
    const card = screen.getByRole('article', { name: /Add acceptance criteria to PAY-102/ });
    expect(within(card).getByRole('region', { name: /What Add acceptance criteria to PAY-102 changes/ })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: /^Apply/ }));
    // The sample has no tracker, and says so on the card.
    await within(screen.getByRole('article', { name: /Add acceptance criteria to PAY-102/ })).findByText(/This is sample data/);
  }, 20_000);

  it('says why a failed run stopped, and keeps its transcript', async () => {
    await open('#/dossier/card-payments/assignment/sample-failed-0000004');
    await screen.findByText(/Stopped at the time limit of 20 minutes/, { selector: 'p[role="note"]' });
    expect(screen.getByText(/Transcript \(4 lines\)/)).toBeTruthy();
  }, 20_000);
});

describe('the People view', () => {
  it("lists each agent's assignments as a teammate's", async () => {
    await open('#/dossier/card-payments/people');
    const section = await screen.findByRole('region', { name: "Agents' assignments" });
    await within(section).findByRole('heading', { name: 'Codex' });
    expect(within(section).getByRole('heading', { name: 'Claude' })).toBeTruthy();
  }, 20_000);
});

describe("the Command Center's start (#307)", () => {
  it('queues an implement assignment for each ready item, and says so', async () => {
    const api = fixtureAssignments({ delay: 1 });
    await open('#/dossier/card-payments/command-center', api);
    const slate = screen.getByRole('region', { name: 'Start every ready item' });
    await userEvent.setup().click(within(slate).getByRole('button', { name: /^Start 1 ready item/ }));
    await within(slate).findByText(/^Queued one implement assignment on Codex\. They run 2 at a time/);
    const list = await api.list('card-payments');
    expect(list.assignments.filter((a) => a.mode === 'implement' && a.item === 'corp-jira:PAY-101' && a.state !== 'failed')).toHaveLength(1);
  }, 20_000);

  it('starts nothing, and says why, where no repository has a local path', async () => {
    const api = fixtureAssignments({ delay: 1 });
    const { startReadyWith } = await import('../src/assign/start.ts');
    await expect(startReadyWith(api, 'checkout-web')({ id: 'x', items: ['github:imagile/payments-web#41'] })).rejects.toThrow(/lists no repository with a local path.*Nothing was started/);
    expect((await api.list('checkout-web')).assignments).toEqual([]);
  });
});
