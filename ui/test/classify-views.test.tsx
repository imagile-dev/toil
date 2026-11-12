import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import type { ClassifyApi, LedgerView } from '../src/classify-api.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureClassify, sampleLedgerLines, sampleRevision, standingOf } from '../src/fixtures/classify.ts';
import { SAMPLE_SCHEME_STATS } from '../src/fixtures/classify-stats.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { defaultScheme } from '../../src/core/classify/builtin.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';
import { needsAPerson } from '../src/model/classify.ts';
import type { WorkItem } from '../src/toil.ts';
import { ChatScope } from '../src/components/ask.tsx';
import { memoryAnalyses } from '../src/analyses.ts';
import { ClassifyProvider } from '../src/classify-state.tsx';
import { DataContext, type Data } from '../src/data.ts';
import type { ToilProjectData } from '../src/load.ts';
import { SkinProvider, skinsFor } from '../src/skins.tsx';
import { Classify } from '../src/views/Classify.tsx';
import { loaded } from './harness.ts';

/**
 * Sorting work into categories on the sample team (#566): the Classify view and its keys, the agent's answers as
 * suggestions, Apply's approval card in each state (sample, writes off, written), "How it's doing" with its dashes, the
 * tune flow with a worse revision, the reclassify popover with its undo, and the Classification editor. The sample's
 * ledger is scripted and in memory, so none of it needs a tracker or a disk.
 */

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

const TEAM = '#/project/sample-team';

function open(hash: string, classify: ClassifyApi = fixtureClassify(), extra: Partial<Parameters<typeof App>[0]> = {}) {
  window.location.hash = hash;
  return render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} classify={classify} now={FIXTURE_NOW} preview {...extra} />);
}
const until = <T extends Element>(selector: string) =>
  waitFor(() => {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`no ${selector} yet`);
    return el;
  });
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-row]')];
/** A suggestion for an item nothing in the list sits under: an answer on an epic is its tasks' answer too, which would empty the list. */
const leafProposal = () => [...document.querySelectorAll<HTMLElement>('[data-proposal]')].find((p) => !/follows? its answer/.test(p.closest('[data-row]')!.textContent!))!;
const press = async (name: string | RegExp) => act(async () => void fireEvent.click(await screen.findByRole('button', { name })));

describe('the Classify view', () => {
  it('is the Board\'s third view, named in plain words with toil\'s own term on hover, listing what needs a person', async () => {
    open(`${TEAM}/board/classify`);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Sort work into categories' });
    expect(h1.getAttribute('title')).toBe('In toil: Classify');
    const views = screen.getByRole('navigation', { name: 'Board views' });
    expect(within(views).getAllByRole('link').map((l) => l.textContent)).toEqual(['Board', 'Ready to start?', 'Sort work into categories']);
    expect(within(views).getByRole('link', { name: 'Sort work into categories' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const first = rows()[0]!;
    expect(first.dataset.kind).toBe('unsure');
    expect(within(first).getByText(/Nothing has settled this one/)).toBeTruthy();
    expect(within(first).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Keep the lights on K', 'Feature F', 'Unsure U']);
    // The page names no code and no path.
    expect(document.body.textContent).not.toMatch(/signal:|~\/\.toil|classify correct|TOIL_/);
  });

  it('is also reached by its short address, and is not mistaken for a person on the board', async () => {
    open(`${TEAM}/classify`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sort work into categories' })).toBeTruthy();
    cleanup();
    open(`${TEAM}/board/classify`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sort work into categories' })).toBeTruthy();
    expect(document.querySelector('#board-filter')).toBeNull();
  });

  it('picks with K, F and U, confirms with Enter, moves to the next row, and says what changed with an undo', async () => {
    open(`${TEAM}/board/classify`);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const before = rows().length;
    // The last row is a task under the epic above it, so answering it settles only itself; answering the epic settles its tasks too.
    const all = rows();
    const first = all[all.length - 1]!;
    const id = first.dataset.row!;
    const nextId = all[all.length - 2]!.dataset.row!;
    first.focus();
    fireEvent.keyDown(first, { key: 'f' });
    expect((within(first).getByRole('radio', { name: /Feature/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(first, { key: 'k' });
    expect((within(first).getByRole('radio', { name: /Keep the lights on/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(first, { key: 'u' });
    expect((within(first).getByRole('radio', { name: /Unsure/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(first, { key: 'F' });
    await act(async () => void fireEvent.keyDown(first, { key: 'Enter' }));
    await waitFor(() => expect(rows().length).toBe(before - 1));
    expect(document.querySelector(`[data-row="${CSS.escape(id)}"]`)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(`[data-row="${CSS.escape(nextId)}"]`)));
    const notice = await until<HTMLElement>('[data-classify-notice="changed"]');
    expect(notice.textContent).toMatch(/is now Feature\. It is saved in your own record; the tracker changes when you apply it/);

    await act(async () => void fireEvent.click(within(notice).getByRole('button', { name: 'Undo' })));
    const back = await until<HTMLElement>('[data-classify-notice="reverted"]');
    expect(back.textContent).toMatch(/Changed back/);
    await waitFor(() => expect(rows().length).toBe(before));
  });

  it('confirms with Enter after a mouse pick leaves focus on the radio, but never on a link or the Confirm button', async () => {
    open(`${TEAM}/board/classify`);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const all = rows();
    const row = all[all.length - 1]!;
    const id = row.dataset.row!;
    const before = all.length;
    const radio = within(row).getByRole('radio', { name: /Feature/ }) as HTMLInputElement;
    await userEvent.click(radio.closest('label')!);
    expect(radio.checked).toBe(true);
    const link = row.querySelector('a')!;
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true);
    // The Confirm button handles its own Enter (a press), so the row's handler must not confirm a second time.
    const confirmButton = within(row).getByRole('button', { name: 'Confirm' });
    fireEvent.keyDown(confirmButton, { key: 'Enter' });
    expect(rows().length).toBe(before);
    await act(async () => void fireEvent.keyDown(radio, { key: 'Enter' }));
    await waitFor(() => expect(document.querySelector(`[data-row="${CSS.escape(id)}"]`)).toBeNull());
    expect(rows().length).toBe(before - 1);
  });

  it("does not take a key typed in a text field, and does not confirm a row with no pick", async () => {
    open(`${TEAM}/board/classify`);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const first = rows()[0]!;
    expect((within(first).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    const before = rows().length;
    await act(async () => void fireEvent.keyDown(first, { key: 'Enter' }));
    expect(rows().length).toBe(before);
    const box = document.createElement('input');
    first.appendChild(box);
    fireEvent.keyDown(box, { key: 'f' });
    expect(within(first).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it('shows an empty state that says everything is sorted, with the way on', async () => {
    const api = fixtureClassify();
    const all = await api.ledger('sample-team');
    const waiting = needsAPerson(SAMPLE_TEAM.owi.items as WorkItem[], defaultScheme(), all.standing).map((r) => r.item.id);
    const everyone: LedgerView = { ...all, standing: { ...all.standing, ...Object.fromEntries(waiting.map((id) => [id, { category: 'feature', reason: null }])) } };
    open(`${TEAM}/board/classify`, { ...api, ledger: async () => everyone });
    expect(await screen.findByText(/Everything is sorted|Every item has an answer/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nothing needs an answer' })).toBeTruthy();
  });
});

describe('the Classify view on work nobody read (principle 12)', () => {
  const ABSENCES = /Everything is sorted|Nothing here needs you|nothing unsure left|Nothing needs an answer|How it's doing|people agreed with/;
  const shell = async (change: (d: ToilProjectData) => ToilProjectData, sync?: () => void) => {
    const { data } = await loaded('sample-team');
    const toilProject = change(data);
    const d: Data = { toilProject, byId: new Map(toilProject.items.map((i) => [i.id, i])), prById: new Map(), agent: scriptedAgent(), now: FIXTURE_NOW, analyses: memoryAnalyses(), ...(sync ? { sync } : {}) };
    return render(
      <SkinProvider value={skinsFor('plain')}>
        <DataContext value={d}>
          <ChatScope>
            <ClassifyProvider>
              <Classify />
            </ClassifyProvider>
          </ChatScope>
        </DataContext>
      </SkinProvider>,
    );
  };

  it('says not read yet, with the action that reads it, and none of the absence sentences, when no items were read', async () => {
    let synced = 0;
    await shell((d) => ({ ...d, items: [], readTargets: [{ area: 'jira', label: 'jira', work: false, pullRequests: true }] }), () => synced++);
    expect(await screen.findByRole('heading', { name: 'Not read yet' })).toBeTruthy();
    expect(screen.getByText("This Toil project's work hasn't been read, so there is nothing to sort yet.")).toBeTruthy();
    expect(screen.getByText('jira: work items not read')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(synced).toBe(1);
    expect(document.body.textContent).not.toMatch(ABSENCES);
    expect(screen.queryByRole('button', { name: 'Ask your AI agent' })).toBeNull();
    expect(document.querySelector('[data-how-its-doing]')).toBeNull();
  });

  it('is also not read yet when items are empty with no failure recorded, and when every tracker failed', async () => {
    await shell((d) => ({ ...d, items: [] }));
    expect(await screen.findByRole('heading', { name: 'Not read yet' })).toBeTruthy();
    cleanup();
    await shell((d) => ({ ...d, readTargets: [{ area: 'jira', label: 'jira', work: false, pullRequests: true }] }));
    expect(await screen.findByRole('heading', { name: 'Not read yet' })).toBeTruthy();
  });

  it('names what could not be read when only some trackers failed, and never says everything is sorted', async () => {
    await shell((d) => ({ ...d, readTargets: [{ area: 'jira', label: 'jira', work: true, pullRequests: true }, { area: 'ado', label: 'ado web', work: false, pullRequests: true }] }));
    expect(await screen.findByRole('heading', { name: 'Nothing in what was read needs an answer' })).toBeTruthy();
    expect(screen.getByText('ado web: work items not read')).toBeTruthy();
    expect(screen.getByText('Nothing in what was read needs an answer.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Not read yet' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Everything is sorted|Nothing here needs you|nothing unsure left/);
  });

  it('keeps "Everything is sorted" where the work was read and nothing needs an answer', async () => {
    const api = fixtureClassify();
    const all = await api.ledger('sample-team');
    const waiting = needsAPerson(SAMPLE_TEAM.owi.items as WorkItem[], defaultScheme(), all.standing).map((r) => r.item.id);
    const everyone: LedgerView = { ...all, standing: { ...all.standing, ...Object.fromEntries(waiting.map((id) => [id, { category: 'feature', reason: null }])) } };
    open(`${TEAM}/board/classify`, { ...api, ledger: async () => everyone });
    expect(await screen.findByText(/Everything is sorted|Every item has an answer/)).toBeTruthy();
    expect(screen.queryByText(/Nothing in what was read/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/work items not read/);
  });
});

describe('the AI agent on the Classify view', () => {
  it('shows its answers as suggestions with its badge and reason, accepts them one by one or all at once, and applies nothing', async () => {
    const api = fixtureClassify();
    const apply = vi.spyOn(api, 'apply');
    const correct = vi.spyOn(api, 'correct');
    open(`${TEAM}/board/classify`, api);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    await press('Ask your AI agent');
    await until('[data-asked]');
    const proposals = [...document.querySelectorAll<HTMLElement>('[data-proposal]')];
    expect(proposals.length).toBeGreaterThan(3);
    expect(proposals[0]!.textContent).toMatch(/^Your AI agent suggests .+: /);
    expect(document.querySelector('[data-asked]')!.textContent).toMatch(/a scripted sample, not a model suggested a category/);
    const total = rows().length;
    // The sample's ten corrections are decided here and not yet written there, so some changes are already waiting.
    const waiting = () => Number(/(\d+) changes? waiting for the tracker/.exec(document.querySelector('[data-pending] h2')!.textContent!)![1]);
    const already = waiting();

    const one = leafProposal();
    const first = one.closest<HTMLElement>('[data-row]')!.dataset.row!;
    const reason = one.querySelector('p')!.textContent!.replace(/^.*suggests .+?: /, '');
    await act(async () => void fireEvent.click(within(one).getByRole('button', { name: 'Accept' })));
    await waitFor(() => expect(rows().length).toBe(total - 1));
    expect(waiting()).toBe(already + 1);
    // Accepting is the person's word, recorded as a pick is: with the agent's reason in it, and the same line offering to take it back.
    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct.mock.calls[0]![1]).toMatchObject({ item: expect.objectContaining({ id: first }), reason: `Accepted the AI agent's suggestion: ${reason}` });
    expect((await until<HTMLElement>('[data-classify-notice="changed"]')).textContent).toMatch(/is now (Feature|Keep the lights on). It is saved in your own record/);

    const all = await screen.findByRole('button', { name: /Accept all \d+/ });
    const n = Number(/(\d+)/.exec(all.textContent!)![1]);
    await act(async () => void fireEvent.click(all));
    await waitFor(() => expect(waiting()).toBe(already + 1 + n));
    // Accept all is one correction per suggestion, by the route a pick takes: no route of its own.
    expect(correct).toHaveBeenCalledTimes(1 + n);
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps an accepted suggestion settled after Apply: the item is not asked about again and the count does not go back up', async () => {
    const api = fixtureClassify();
    let planned: WorkItem[] = [];
    const apply = vi.fn(async () => ({ outcomes: [{ connection: 'sample-jira', changed: planned.map((i) => ({ key: i.source.key, text: 'added label' })), unchanged: [], failed: [], refused: null }], recorded: { ok: true as const } }));
    open(`${TEAM}/board/classify`, {
      ...api,
      disabled: null,
      apply: apply as unknown as ClassifyApi['apply'],
      plan: async (p, w) => {
        planned = w.items;
        return { id: 'plan-1', groups: (await api.plan(p, w)).groups.map((g) => ({ ...g, writes: true })), notes: [] };
      },
    });
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const total = rows().length;
    await press('Ask your AI agent');
    await until('[data-asked]');
    const proposal = leafProposal();
    const id = proposal.closest<HTMLElement>('[data-row]')!.dataset.row!;
    await act(async () => void fireEvent.click(within(proposal).getByRole('button', { name: 'Accept' })));
    await waitFor(() => expect(rows().length).toBe(total - 1));
    await press('Review and apply');
    const card = await until<HTMLElement>('[data-apply]');
    await waitFor(() => expect(card.querySelectorAll('[data-change]').length).toBeGreaterThan(0));
    await act(async () => void fireEvent.click(within(card).getByRole('button', { name: /^Apply \d+ changes?$/ })));
    await until('[data-outcome="done"]');
    await waitFor(() => expect(document.querySelector('[data-pending] h2')!.textContent).toBe('Nothing is waiting for the tracker'));
    // The tracker's label is not read back until the next sync, but the ledger holds the person's say, so the item stays answered.
    expect(rows().length).toBe(total - 1);
    expect(document.querySelector(`[data-row="${CSS.escape(id)}"]`)).toBeNull();
    expect(document.querySelector('#needs-head')!.textContent).toBe(`${total - 1} items need an answer`);
  });

  it('says when no AI agent is set up, and leaves the rows to be sorted by hand', async () => {
    const api = fixtureClassify();
    open(`${TEAM}/board/classify`, { ...api, agents: async () => [] });
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    expect((await screen.findAllByText(/No AI agent is set up yet/)).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Ask your AI agent' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the reason an answer was refused, and proposes nothing', async () => {
    const api = fixtureClassify();
    open(`${TEAM}/board/classify`, { ...api, ask: async () => { throw new Error("The AI agent's answer can't be used, so nothing was proposed."); } });
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    await press('Ask your AI agent');
    expect((await screen.findByRole('alert')).textContent).toMatch(/nothing was proposed/);
    expect(document.querySelector('[data-proposal]')).toBeNull();
  });
});

describe('Apply', () => {
  const accepted = async (api: ClassifyApi) => {
    open(`${TEAM}/board/classify`, api);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    await press('Ask your AI agent');
    await until('[data-asked]');
    // Each suggestion is recorded one at a time, and one on an epic takes its tasks' rows away before theirs are recorded: wait for every one.
    const correct = vi.spyOn(api, 'correct');
    const all = await screen.findByRole('button', { name: /Accept all \d+/ });
    const n = Number(/(\d+)/.exec(all.textContent!)![1]);
    await act(async () => void fireEvent.click(all));
    await waitFor(() => expect(correct).toHaveBeenCalledTimes(n));
    await waitFor(() => expect(document.querySelector('[data-proposal]')).toBeNull());
    // Accepting everything empties the list, whose empty state offers the same press as the pending section does; both wait until the last is recorded.
    await waitFor(() => expect((screen.getAllByRole('button', { name: 'Review and apply' })[0] as HTMLButtonElement).disabled).toBe(false));
    await act(async () => void fireEvent.click(screen.getAllByRole('button', { name: 'Review and apply' })[0]!));
  };

  it("shows every change before anything is written: the item, the label from and to, and the command, and says a sample can't write", async () => {
    await accepted(fixtureClassify());
    const card = await until<HTMLElement>('[data-apply]');
    await waitFor(() => expect(card.querySelectorAll('[data-change]').length).toBeGreaterThan(3));
    const first = card.querySelector<HTMLElement>('[data-change]')!;
    expect(first.textContent).toMatch(/SHOP-\d+ .+ now (Feature|Keep the lights on)/);
    expect(first.textContent).toMatch(/Label: .+ → (feature|ktlo)/);
    expect(card.querySelector('.apply__command code')!.textContent).toMatch(/^toil jira issue categorize .*--allow-write$/);
    expect(card.querySelector('[data-sample-cannot-write]')!.textContent).toMatch(/This is sample data, so nothing here can be written/);
    expect((within(card).getByRole('button', { name: /^Apply \d+ changes$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says in plain words that changes are switched off for the connection, and where to switch them on', async () => {
    const api = fixtureClassify();
    const base = await api.plan('sample-team', { items: [] });
    await accepted({ ...api, disabled: null, plan: async (p, w) => ({ ...base, groups: (await api.plan(p, w)).groups.map((g) => ({ ...g, writes: false })) }) });
    const off = await until<HTMLElement>('[data-writes-off]');
    expect(off.textContent).toMatch(/Changes to sample-jira are switched off, so nothing can be written there yet\. Turn them on for sample-jira under Settings, Connections/);
    expect((screen.getByRole('button', { name: /^Apply \d+ changes$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies on one press, reports each item's result, and a second press changes nothing more", async () => {
    const api = fixtureClassify();
    let planned: Array<{ source: { key: string } }> = [];
    const apply = vi.fn(async (_p: string, planId: string) => {
      expect(planId).toBe('plan-1');
      return {
        outcomes: [{ connection: 'sample-jira', changed: planned.slice(0, 1).map((i) => ({ key: i.source.key, text: 'added feature' })), unchanged: planned.slice(1).map((i) => i.source.key), failed: [{ key: 'SHOP-999', reason: 'Jira said no.' }], refused: null }],
        recorded: { ok: true as const },
      };
    });
    await accepted({
      ...api,
      disabled: null,
      apply: apply as unknown as ClassifyApi['apply'],
      plan: async (p, w) => {
        planned = w.items;
        return { id: 'plan-1', groups: (await api.plan(p, w)).groups.map((g) => ({ ...g, writes: true })), notes: [] };
      },
    });
    const card = await until<HTMLElement>('[data-apply]');
    await waitFor(() => expect(card.querySelectorAll('[data-change]').length).toBeGreaterThan(3));
    const button = within(card).getByRole('button', { name: /^Apply \d+ changes$/ });
    await act(async () => void fireEvent.click(button));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const done = await until<HTMLElement>('[data-outcome="done"]');
    expect(done.textContent).toMatch(/1 changed, \d+ already as wanted, 1 failed\./);
    expect(done.textContent).toMatch(/SHOP-999 failed: Jira said no\./);
    // Decided and written: nothing waits for the tracker any more.
    await waitFor(() => expect(document.querySelector('[data-pending] h2')!.textContent).toBe('Nothing is waiting for the tracker'));
    // Nothing says "nothing is written" beside a result that says something was.
    expect(card.textContent).not.toMatch(/Nothing is written/);
    expect(document.querySelector('[data-pending]')!.textContent).not.toMatch(/Decided here, not yet written|Nothing is written/);
    // Failures stay pending, so the page does not claim everything was written.
    expect(screen.queryByRole('button', { name: 'Apply again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('says everything decided was written when nothing is waiting, and Check again makes a fresh plan instead of spending the old id', async () => {
    const api = fixtureClassify();
    let planned: WorkItem[] = [];
    let plans = 0;
    const apply = vi.fn(async (_p: string, planId: string) => {
      expect(planId).toBe('plan-1');
      return { outcomes: [{ connection: 'sample-jira', changed: planned.map((i) => ({ key: i.source.key, text: 'added feature' })), unchanged: [], failed: [], refused: null }], recorded: { ok: true as const } };
    });
    await accepted({
      ...api,
      disabled: null,
      apply: apply as unknown as ClassifyApi['apply'],
      plan: async (p, w) => {
        planned = w.items;
        plans += 1;
        return { id: `plan-${plans}`, groups: (await api.plan(p, w)).groups.map((g) => ({ ...g, writes: true })), notes: [] };
      },
    });
    const card = await until<HTMLElement>('[data-apply]');
    await waitFor(() => expect(card.querySelectorAll('[data-change]').length).toBeGreaterThan(3));
    await act(async () => void fireEvent.click(within(card).getByRole('button', { name: /^Apply \d+ changes$/ })));
    await until('[data-outcome="done"]');
    await waitFor(() => expect(document.querySelector('[data-pending] h2')!.textContent).toBe('Nothing is waiting for the tracker'));
    const section = document.querySelector('[data-pending]')!;
    expect(section.textContent).toMatch(/Everything decided here has been written to the tracker\./);
    expect(section.textContent).not.toMatch(/Decided here, not yet written|Nothing is written/);
    await press('Check again');
    await waitFor(() => expect(plans).toBe(2));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-outcome]')).toBeNull();
  });
});

describe("How it's doing", () => {
  it('opens on the figures, in plain words, and offers to improve the categories once there are ten corrections', async () => {
    open(`${TEAM}/board/classify`);
    const doing = await until<HTMLDetailsElement>('[data-how-its-doing]');
    expect(doing.querySelector('summary')!.textContent).toMatch(/^How it's doing: people agreed with 55% of 22 checked$/);
    expect(doing.querySelector('[data-share="agreement"]')!.textContent).toBe('55%');
    expect(doing.querySelector('[data-overruled]')!.textContent).toBe('The bug or incident type was overruled 4 of 4 times, all to Feature.');
    expect(doing.textContent).not.toMatch(/signal:/);
    expect(doing.querySelector('[data-since-tune]')!.textContent).toBe('10 corrections since the categories were last improved.');
    expect(within(doing).getByRole('button', { name: 'Improve with your AI agent' })).toBeTruthy();
  });

  it('shows every share nobody has read as a dash and says it is not read yet, never 0%', async () => {
    const api = fixtureClassify();
    const base = await api.ledger('sample-team');
    const empty: LedgerView = { ...base, stats: { ...SAMPLE_SCHEME_STATS, agreement: { ...SAMPLE_SCHEME_STATS.agreement, overall: null, checked: 0 }, sources: [{ source: 'parent', checked: 0, confirmed: 0, overruled: 0, overruledTo: {}, agreement: null }], sinceLastTune: 2 } };
    open(`${TEAM}/board/classify`, { ...api, ledger: async () => empty });
    const doing = await until<HTMLDetailsElement>('[data-how-its-doing]');
    expect(doing.querySelector('summary')!.textContent).toBe("How it's doing: nothing has been checked yet");
    expect(doing.querySelector('[data-share="agreement"]')!.textContent).toBe('—');
    expect(doing.querySelector('[data-share="source"]')!.textContent).toBe('—');
    expect(doing.textContent).toMatch(/Nobody has checked an answer yet, so there is no figure/);
    expect(doing.textContent).not.toMatch(/0%/);
    expect(within(doing).queryByRole('button', { name: 'Improve with your AI agent' })).toBeNull();
  });

  it('is a dash when the record could not be read at all', async () => {
    const api = fixtureClassify();
    const base = await api.ledger('sample-team');
    open(`${TEAM}/board/classify`, { ...api, ledger: async () => ({ ...base, stats: null, notes: ["The ledger couldn't be read, so how it's doing is not read yet: nope."] }) });
    const doing = await until<HTMLDetailsElement>('[data-how-its-doing]');
    expect(doing.querySelector('[data-share="agreement"]')!.textContent).toBe('—');
    expect(doing.querySelector('summary')!.textContent).toBe("How it's doing: not read yet");
    expect(doing.textContent).toMatch(/The record could not be read, so this is not read yet/);
    expect(doing.querySelector('[data-since-tune]')!.textContent).toMatch(/not read yet/);
  });

  it("shows the agent's proposed changes beside the scores, and Use this version is a press that the sample refuses in words", async () => {
    open(`${TEAM}/board/classify`);
    const doing = await until<HTMLDetailsElement>('[data-how-its-doing]');
    await act(async () => void fireEvent.click(within(doing).getByRole('button', { name: 'Improve with your AI agent' })));
    const tune = await until<HTMLElement>('[data-tune]');
    expect(tune.textContent).toMatch(/Adds the rule "new-exports": when its title contains export, the category is Feature\./);
    expect(tune.textContent).toMatch(/Adds the guidance: A bug fix that adds a new capability/);
    expect(tune.querySelector('[data-backtest]')!.textContent).toMatch(/Tried on 4 corrections it had not seen: today's categories agree with people on 1 \(25%\); this version on 3 \(75%\)\./);
    expect(tune.querySelector('[data-backtest="better"]')).toBeTruthy();
    expect(tune.querySelector('[data-sample-cannot-write]')!.textContent).toMatch(/sample data/);
    expect((within(tune).getByRole('button', { name: 'Use this version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a revision that scores worse as worse, and applying one is the person-command path that saves a revision', async () => {
    const api = fixtureClassify();
    const scheme = defaultScheme();
    const applyRevision = vi.fn(async () => ({ revision: 2, kept: 'yours' as const, warnings: [] }));
    open(`${TEAM}/board/classify`, {
      ...api,
      disabled: null,
      tune: async () => ({ id: 'rev-1', by: 'a scripted sample', before: scheme, after: sampleRevision(scheme), changes: ['Adds the guidance: Be careful.'], backtest: { heldBack: 5, before: { agreed: 4, agreement: 0.8 }, after: { agreed: 2, agreement: 0.4 }, worse: true }, warnings: [] }),
      applyRevision,
    });
    const doing = await until<HTMLDetailsElement>('[data-how-its-doing]');
    await act(async () => void fireEvent.click(within(doing).getByRole('button', { name: 'Improve with your AI agent' })));
    const tune = await until<HTMLElement>('[data-tune]');
    const score = tune.querySelector<HTMLElement>('[data-backtest="worse"]')!;
    expect(score.className).toContain('failure');
    expect(score.textContent).toMatch(/this version on 2 \(40%\)\. This version scores worse than today's, so it is not an improvement\./);
    expect(tune.textContent).toMatch(/These categories are built in, so using this version saves it as your own copy/);
    await act(async () => void fireEvent.click(within(tune).getByRole('button', { name: 'Use this version' })));
    await waitFor(() => expect(applyRevision).toHaveBeenCalledWith('rev-1'));
    expect((await until('[data-saved-revision]')).textContent).toBe('Saved as revision 2, kept as your own copy.');
  });
});

describe('changing a category from where it is shown', () => {
  const sampleItem = () => rows()[0]!.dataset.row!;

  it("opens a small form from the item page's chip with the plain names and Unsure, records the choice, and undoes it", async () => {
    const api = fixtureClassify();
    open(`${TEAM}/board/classify`, api);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const id = sampleItem();
    cleanup();
    open(`${TEAM}/item/${encodeURIComponent(id)}`, api);
    const chip = await until<HTMLButtonElement>('button.cat-chip--button');
    expect(chip.textContent).toBe('Unsure');
    await userEvent.click(chip);
    const form = await until<HTMLElement>('[data-reclassify-form]');
    expect(within(form).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Keep the lights on', 'Feature', 'Unsure']);
    expect((within(form).getByRole('radio', { name: 'Unsure' }) as HTMLInputElement).checked).toBe(true);
    expect(within(form).getByText(/saved in your own record on this computer\. The tracker changes only when you apply it/)).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Confirm' })).toBeTruthy();
    await userEvent.click(within(form).getByRole('radio', { name: 'Feature' }));
    await userEvent.type(within(form).getByRole('textbox', { name: /Why/ }), 'It adds a screen.');
    const change = within(form).getByRole('button', { name: 'Change' });
    await userEvent.click(change);
    await waitFor(() => expect(document.querySelector('[data-reclassify-form]')).toBeNull());
    await waitFor(() => expect(document.querySelector('button.cat-chip--button')!.textContent).toBe('Feature · person'));
    const notice = await until<HTMLElement>('[data-classify-notice="changed"]');
    await userEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
    await until('[data-classify-notice="reverted"]');
    await waitFor(() => expect(document.querySelector('button.cat-chip--button')!.textContent).toMatch(/^(Unsure|Feature)/));
  });

  it('records the category an item already has as a confirmation', async () => {
    const api = fixtureClassify();
    const correct = vi.spyOn(api, 'correct');
    open(`${TEAM}/board/classify`, api);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    cleanup();
    const settled = sampleLedgerLines().find((l) => l.kind === 'verdict' && l.category === 'feature' && l.source === 'parent' && !Object.hasOwn(standingOf(sampleLedgerLines()), l.item))!;
    open(`${TEAM}/item/${encodeURIComponent(settled.item)}`, api);
    const chip = await until<HTMLButtonElement>('button.cat-chip--button');
    expect(chip.textContent).toBe('Feature · rules');
    await userEvent.click(chip);
    const form = await until<HTMLElement>('[data-reclassify-form]');
    expect((within(form).getByRole('radio', { name: 'Feature' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(form).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(correct).toHaveBeenCalledTimes(1));
    expect(correct.mock.calls[0]![1]).toMatchObject({ to: 'feature', reason: '', item: { id: settled.item } });
  });

  it('shows a refusal in the form and keeps it open, so nothing looks saved that was not', async () => {
    const api = fixtureClassify();
    open(`${TEAM}/board/classify`, api);
    await waitFor(() => expect(rows().length).toBeGreaterThan(5));
    const id = sampleItem();
    cleanup();
    open(`${TEAM}/item/${encodeURIComponent(id)}`, { ...api, correct: async () => { throw new Error('toil could not record the correction: the ledger is full.'); } });
    await userEvent.click(await until<HTMLButtonElement>('button.cat-chip--button'));
    const form = await until<HTMLElement>('[data-reclassify-form]');
    await userEvent.click(within(form).getByRole('radio', { name: 'Feature' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Change' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/the ledger is full/);
    expect(document.querySelector('[data-reclassify-form]')).toBeTruthy();
  });

  it("offers Change its category… in a board card's menu, and keeps the card's own chip display-only", async () => {
    open(`${TEAM}/board`);
    const card = await until<HTMLElement>('.card-grip');
    expect(document.querySelector('.card button.cat-chip--button')).toBeNull();
    fireEvent.keyDown(card, { key: 'm' });
    const menu = await screen.findByRole('menu');
    await act(async () => void fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change its category…' })));
    expect(await screen.findByRole('dialog', { name: /Change the category of/ })).toBeTruthy();
  });

  it('leaves the chip as it was, display-only, where there is no ledger to record in', async () => {
    window.location.hash = `${TEAM}/board/classify`;
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    await screen.findByRole('heading', { level: 1, name: 'Sort work into categories' });
    expect(document.querySelector('button.cat-chip--button')).toBeNull();
  });
});

describe('the Classification editor', () => {
  const editor = '#/settings/projects/sample-team/classification';

  it('opens on one line that says what the Toil project sorts by, with each part a step in', async () => {
    open(editor);
    const section = await until<HTMLElement>('[data-classification-editor]');
    expect(section.querySelector('[data-classification-summary]')!.textContent).toMatch(/^Keep the lights on \/ Feature, no rules, signals on, revision 1\. Built in to toil\./);
    const parts = [...section.querySelectorAll('details > summary')].map((s) => s.textContent);
    expect(parts).toEqual(['Which categories this Toil project uses', 'Where each tool keeps the category', 'The categories (2)', 'Rules (0)', 'Guidance for the AI agent, and the built-in signals']);
    expect(section.textContent).not.toMatch(/~\/\.toil|\.json|toil classify/);
    expect(within(section).queryByRole('button', { name: /Save as revision 2/ })).toBeNull();
  });

  it('names each problem where it is and keeps Save off until toil would accept the draft, counting what a rule would catch', async () => {
    const api = fixtureClassify();
    const saveScheme = vi.fn(async () => ({ revision: 2, kept: 'yours' as const, warnings: [] }));
    open(editor, { ...api, disabled: null, saveScheme }, { config: { ...fixtureConfig(), disabled: null } as never });
    const section = await until<HTMLElement>('[data-classification-editor]');
    await act(async () => void fireEvent.click(within(section).getByRole('button', { name: 'Add a rule' })));
    const save = within(section).getByRole('button', { name: /Save as revision 2/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const problems = await until<HTMLElement>('[data-problems]');
    expect(problems.textContent).toMatch(/Rule 1/);

    const card = section.querySelector<HTMLElement>('[data-rule-card="0"]')!;
    const [name, , , , title] = [...card.querySelectorAll('input')] as HTMLInputElement[];
    await userEvent.type(name!, 'orders');
    await userEvent.type(title!, 'order');
    await waitFor(() => expect(document.querySelector('[data-problems]')).toBeNull());
    await waitFor(() => expect(card.querySelector('[data-rule-count]')!.textContent).toMatch(/Matches \d+ items? read from this Toil project\./));
    expect(Number(/Matches (\d+)/.exec(card.querySelector('[data-rule-count]')!.textContent!)![1])).toBeGreaterThan(0);
    expect(section.textContent).toMatch(/These categories are built in, so saving makes your own copy/);

    await waitFor(() => expect(save.disabled).toBe(false));
    await act(async () => void fireEvent.click(save));
    await waitFor(() => expect(saveScheme).toHaveBeenCalledTimes(1));
    const [project, scheme] = saveScheme.mock.calls[0] as unknown as [string, { rules: Array<{ id: string; when: { title: string[] }; then: string }> }];
    expect(project).toBe('sample-team');
    expect(scheme.rules).toEqual([{ id: 'orders', when: { title: ['order'] }, then: 'ktlo' }]);
    expect((await screen.findByText('Saved as revision 2, kept as your own copy.')).closest('[role="status"]')).toBeTruthy();
  });

  it("says in the sample that nothing can be saved, with Save off even for a valid change", async () => {
    open(editor);
    const section = await until<HTMLElement>('[data-classification-editor]');
    await act(async () => void fireEvent.click(within(section).getByRole('checkbox', { name: /built-in signals/ })));
    expect(section.querySelector('[data-sample-cannot-write]')!.textContent).toMatch(/sample data/);
    expect((within(section).getByRole('button', { name: /Save as revision 2/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
