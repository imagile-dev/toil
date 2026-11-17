// @vitest-environment jsdom
// A re-inspection booked after the work was signed off, which is the order most audits only aspire to.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { resetApplied } from '../src/applied.ts';
import { settledState, type AssignmentRecord, type AssignmentsApi } from '../src/assign/model.ts';
import { resetRechecks } from '../src/assign/recheck.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureAssignments } from '../src/fixtures/assignments.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { fixtureStandards } from '../src/fixtures/standards.ts';
import type { RulesApi } from '../src/rules.ts';
import { resetBrowserState } from './views-kit.tsx';

/**
 * Sync and check again (#657, round 4): an applied fix's card syncs the Toil
 * project and checks the rule on what that sync read, and says nothing about
 * the rule until a reading newer than the press is on screen.
 */

beforeEach(() => {
  resetBrowserState();
  resetApplied();
  resetRechecks();
});

const ITEM = 'corp-jira:PAY-103';

/** The sample's assignments with one rule fix on PAY-103, its proposal applied. */
async function appliedFix(): Promise<{ api: AssignmentsApi; id: string }> {
  const real = fixtureAssignments({ delay: 0 });
  const a = await real.assign({ toilProject: 'card-payments', item: ITEM, mode: 'refine', adapter: 'codex', standard: { standard: 'gherkin', rule: 'scenarios' } });
  let r: AssignmentRecord | null = null;
  await waitFor(async () => {
    r = structuredClone(await real.get(a.id));
    if (r.state !== 'needs-you') throw new Error('not yet');
  });
  const done = r!;
  for (const p of done.proposals) Object.assign(p, { status: 'applied', outcome: { at: '2026-10-13T09:15:00Z', ok: true, message: 'Applied with toil jira issue update.' } });
  done.state = settledState(done);
  return { api: { ...real, get: async (id) => (id === a.id ? structuredClone(done) : real.get(id)) }, id: a.id };
}

/** The sample's rule check, with PAY-103's Given/When/Then rule passing once `passes` is set. */
function rulesThatPass(): { api: RulesApi; pass: () => void } {
  const base = fixtureStandards();
  let passes = false;
  return {
    pass: () => void (passes = true),
    api: {
      check: async (p) => {
        const v = structuredClone(await base.check(p));
        if (passes && v.result) for (const i of v.result.items) if (i.id === ITEM) for (const r of i.results) if (r.standard === 'gherkin') Object.assign(r, { state: 'pass', reason: 'Every scenario has Given, When and Then.' });
        return v;
      },
    },
  };
}

describe('Sync and check again (#657, round 4)', () => {
  it('syncs, then says the rule now passes from the new reading, and nothing before it', async () => {
    const { api, id } = await appliedFix();
    const rules = rulesThatPass();
    let syncs = 0;
    window.location.hash = `#/project/card-payments/assignment/${id}`;
    const props = { execute: fixtureExecute().execute, agent: scriptedAgent(), config: fixtureConfig(), preview: true, assignments: api, rules: rules.api, onSync: () => void syncs++ };
    const view = render(<App {...props} now={FIXTURE_NOW} />);
    const button = await screen.findByRole('button', { name: 'Sync and check again' }, { timeout: 4000 });
    const box = button.closest<HTMLElement>('[data-check-again]')!;
    expect(box.querySelector('[data-again]')).toBeNull();
    await userEvent.click(button);
    expect(syncs).toBe(1);
    // Until a newer reading is on screen, it says only that it is syncing.
    expect(box.textContent).toContain('Syncing, then checking the rule again.');
    expect(box.querySelector('[data-again]')).toBeNull();

    // The sync finishes: the app is given a later reading, on which the rule passes.
    rules.pass();
    const later = new Date(Date.parse(FIXTURE_NOW) + 3_600_000).toISOString();
    await act(async () => view.rerender(<App {...props} now={later} />));
    const line = await waitFor(() => {
      const el = document.querySelector('[data-check-again] [data-again]');
      if (!el) throw new Error('not yet');
      return el;
    });
    expect(line.textContent).toBe('Acceptance criteria as Given/When/Then: now passes');
    expect(line.getAttribute('data-again')).toBe('pass');
    expect(within(document.querySelector<HTMLElement>('[data-check-again]')!).getByRole('status').textContent).toMatch(/^Read /);
  });

  it('says what is still missing when the new reading still misses the rule', async () => {
    const { api, id } = await appliedFix();
    window.location.hash = `#/project/card-payments/assignment/${id}`;
    const props = { execute: fixtureExecute().execute, agent: scriptedAgent(), config: fixtureConfig(), preview: true, assignments: api, rules: fixtureStandards(), onSync: () => undefined };
    const view = render(<App {...props} now={FIXTURE_NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync and check again' }, { timeout: 4000 }));
    const later = new Date(Date.parse(FIXTURE_NOW) + 3_600_000).toISOString();
    await act(async () => view.rerender(<App {...props} now={later} />));
    const line = await waitFor(() => {
      const el = document.querySelector('[data-check-again] [data-again]');
      if (!el) throw new Error('not yet');
      return el;
    });
    expect(line.getAttribute('data-again')).toBe('missing');
    expect(line.textContent).toMatch(/^Acceptance criteria as Given\/When\/Then: still missing: /);
  });

  it("isn't offered where nothing can sync", async () => {
    const { api, id } = await appliedFix();
    window.location.hash = `#/project/card-payments/assignment/${id}`;
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} preview now={FIXTURE_NOW} assignments={api} rules={fixtureStandards()} />);
    await screen.findByRole('article', { name: /Proposal:/ }, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'Sync and check again' })).toBeNull();
  });
});
