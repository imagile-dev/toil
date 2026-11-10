import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import type { ConfigApi } from '../src/config.ts';
import { getCurrentChart, setCurrentChart } from '../src/current-chart.ts';
import { DataContext } from '../src/data.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';
import { Charts } from '../src/views/Charts.tsx';
import { takeSaved } from '../src/views/charts/saved.ts';
import { loaded } from './harness.ts';

/**
 * The four more dashboards (Sprints, Where we're working, Flow, Explore), what every chart does (its menu, its
 * suggested questions, the chart the palette asks about), and Save to Charts, on the sample team (#567).
 */

const TEAM = '#/project/sample-team';
const facts = SAMPLE_TEAM.facts;

beforeEach(() => {
  localStorage.clear();
  setCurrentChart(null);
});
afterEach(() => {
  cleanup();
  setCurrentChart(null);
  vi.restoreAllMocks();
});

async function open(hash: string, config?: ConfigApi) {
  window.location.hash = hash;
  return render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} now={FIXTURE_NOW} preview {...(config ? { config } : {})} />);
}
const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};
const until = <T extends Element>(selector: string) =>
  waitFor(() => {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`no ${selector} yet`);
    return el;
  });

describe('the Charts list', () => {
  it('lists the dashboards in order, each headline worked out from the data', async () => {
    await open(`${TEAM}/charts`);
    await until('[data-chart-card="explore"]');
    expect([...document.querySelectorAll('[data-chart-card]')].map((c) => c.getAttribute('data-chart-card'))).toEqual(['mix', 'releases', 'sprints', 'where', 'flow', 'explore']);
    const text = (id: string) => document.querySelector(`[data-chart-card="${id}"]`)!.textContent!;
    expect(text('sprints')).toContain('Done per sprint: 18 to 25 items over the last 5 sprints (median 20)');
    expect(text('where')).toContain(`${facts.withNoEpic} of 136 items (14%) have no epic above them`);
    expect(text('flow')).toContain(`typically in ${facts.medianCycleDays} days`);
    expect(text('explore')).toContain('Pick what to count');
    expect(document.querySelector('[data-saved-view]')).toBeNull();
  });

  it('shows the views the team saved under their own heading, each opening Explore on its spec', async () => {
    const { data } = await loaded('sample-team');
    const toilProject = { ...data, views: { 'release-mix': { measure: 'items' as const, split: 'release', across: 'statusCategory', where: [{ dimension: 'category', op: '=' as const, values: ['ktlo'] }], title: 'Release mix', chart: 'bars' as const } } };
    window.location.hash = `${TEAM}/charts`;
    render(
      <DataContext.Provider value={{ toilProject, byId: new Map(data.items.map((i) => [i.id, i])), agent: scriptedAgent(), now: FIXTURE_NOW }}>
        <Charts />
      </DataContext.Provider>,
    );
    const card = await until<HTMLElement>('[data-saved-view="release-mix"]');
    expect(screen.getByRole('heading', { name: 'Saved by your team' })).toBeTruthy();
    const link = within(card).getByRole('link', { name: 'Release mix' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#/project/sample-team/charts/explore?measure=items&split=release&across=statusCategory&category=ktlo&chart=bars');
    expect(card.textContent).toContain('Items, by fix version, across status category');
  });
});

describe('Sprints', () => {
  it('leads with velocity, draws a column per sprint and a line for each, every figure a door', async () => {
    await open(`${TEAM}/charts/sprints`);
    const lead = await until<HTMLElement>('[data-sprints-lead]');
    expect(lead.textContent).toBe('Done per sprint: 18 to 25 items over the last 5 sprints (median 20), 52 to 82 points');
    const s25 = facts.sprints.find((s) => s.name === 'Sprint 25')!;
    const line = document.querySelector('[data-sprint="Sprint 25"]')!;
    expect(line.textContent).toContain(`${s25.done} done, ${s25.added} added after it started`);
    expect(document.querySelector('[data-sprint="Sprint 26"]')!.textContent).toContain('still running');
    expect(screen.getAllByText(/What became of each sprint's work/).length).toBeGreaterThan(0);
    await go(line.querySelector('a')!.getAttribute('href')!);
    const drawer = await until<HTMLElement>('[data-drill]');
    expect(Number(drawer.getAttribute('data-drill'))).toBe(s25.done);
    expect(drawer.querySelectorAll('tbody tr')).toHaveLength(s25.done);
  });

  it('splits the columns by category, planned or unplanned and team, from the address', async () => {
    await open(`${TEAM}/charts/sprints?split=category`);
    await waitFor(() => expect(screen.getAllByText(/Done in each sprint, by category/).length).toBeGreaterThan(0));
    await go(`${TEAM}/charts/sprints?split=planned`);
    await waitFor(() => expect(screen.getAllByText(/Done in each sprint, by planned or unplanned/).length).toBeGreaterThan(0));
    await go(`${TEAM}/charts/sprints?split=team&unit=points`);
    await waitFor(() => expect(screen.getAllByText(/Done in each sprint, by team, in points/).length).toBeGreaterThan(0));
  });
});

describe("Where we're working", () => {
  it('says how many epics have work and how much has none, each a door to its items', async () => {
    await open(`${TEAM}/charts/where`);
    const lead = await until<HTMLElement>('[data-where-lead]');
    expect(lead.textContent).toMatch(new RegExp(`^Work this week is spread across \\d epics; ${facts.withNoEpic} of 136 items \\(14%\\) have no epic above them\\.$`));
    const noEpic = document.querySelector('[data-figure="no-epic"] a')!;
    expect(noEpic.textContent).toBe(`${facts.withNoEpic} of 136 items`);
    await go(noEpic.getAttribute('href')!);
    const drawer = await until<HTMLElement>('[data-drill]');
    expect(drawer.querySelectorAll('tbody tr')).toHaveLength(facts.withNoEpic);
  });

  it('draws the heatmap with a mix for each row, and opens a streams list', async () => {
    await open(`${TEAM}/charts/where`);
    await until('[data-figure="streams"] a');
    expect(screen.getAllByText(/Days in progress by week, by parent › epic/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.where-mixes li').length).toBeGreaterThanOrEqual(5);
    await go(document.querySelector('[data-figure="streams"] a')!.getAttribute('href')!);
    const drawer = await until<HTMLElement>('[data-drill]');
    expect(Number(drawer.getAttribute('data-drill'))).toBeGreaterThan(0);
  });
});

describe('Flow', () => {
  it('leads with how many finish a week and the median cycle time, with the first section open and the rest folded', async () => {
    await open(`${TEAM}/charts/flow`);
    const lead = await until<HTMLElement>('[data-flow-lead]');
    expect(lead.textContent).toMatch(new RegExp(`^About \\d+ finished a week, typically in ${facts.medianCycleDays} days$`));
    const sections = [...document.querySelectorAll<HTMLDetailsElement>('[data-flow-section]')];
    expect(sections.map((d) => [d.getAttribute('data-flow-section'), d.open])).toEqual([['throughput', true], ['cfd', false], ['cycle', false], ['aging', false]]);
    sections.forEach((d) => (d.open = true));
    expect(screen.getAllByText('Items by status, at the end of each week').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Days from started to finished, by category/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Days in progress so far, by category/).length).toBeGreaterThan(0);
  });

  it('opens the items of a work-getting-old bar', async () => {
    await open(`${TEAM}/charts/flow`);
    await until('[data-flow-section="aging"]');
    (document.querySelector('[data-flow-section="aging"]') as HTMLDetailsElement).open = true;
    const bar = await until<SVGGElement>('[data-flow-section="aging"] [data-mark="bar0"]');
    await userEvent.click(bar);
    const drawer = await until<HTMLElement>('[data-drill]');
    expect(Number(drawer.getAttribute('data-drill'))).toBeGreaterThan(0);
  });
});

describe('Explore', () => {
  it('draws what the address names and keeps the whole view in it', async () => {
    await open(`${TEAM}/charts/explore?measure=items&split=type&across=statusCategory&share=1`);
    await waitFor(() => expect(screen.getAllByText('Items, by type, across status category').length).toBeGreaterThan(0));
    expect(document.querySelector('[data-explore-lead]')!.textContent).toMatch(/^\d+ items$/);
    await go(`${TEAM}/charts/explore?measure=cycleTime&split=team`);
    await waitFor(() => expect(screen.getAllByText('Cycle time, by team').length).toBeGreaterThan(0));
    await go(`${TEAM}/charts/explore?measure=nonsense`);
    expect((await until<HTMLElement>('[data-explore-error]')).textContent).toContain('Unknown measure');
  });

  it('opens on finished work by category when the address names nothing', async () => {
    await open(`${TEAM}/charts/explore`);
    await waitFor(() => expect(screen.getAllByText('Items finished, by category, across resolved, by month').length).toBeGreaterThan(0));
  });

  it('says in plain words that sample data cannot save a view', async () => {
    await open(`${TEAM}/charts/explore`);
    await until('[data-explore-save]');
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-explore-save]')!).getByRole('button', { name: 'Save to Charts' }));
    const note = await until<HTMLElement>('[data-explore-save-off]');
    expect(note.textContent).toMatch(/own machine/);
  });

  it('says it is sample data where the preview refuses changes', async () => {
    const config = { disabled: 'This is the preview.', areas: async () => [], settings: async () => ({}) as never, run: vi.fn() } as unknown as ConfigApi;
    await open(`${TEAM}/charts/explore`, config);
    await until('[data-explore-save]');
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-explore-save]')!).getByRole('button', { name: 'Save to Charts' }));
    const note = await until<HTMLElement>('[data-explore-save-off]');
    expect(note.textContent).toMatch(/sample data/);
    expect(note.textContent).not.toMatch(/projects view|--/);
    expect(config.run).not.toHaveBeenCalled();
  });

  it("hands toil's own command the view, with the name and title typed, and refreshes", async () => {
    const run = vi.fn(async () => ({ ok: true, data: {}, error: null, meta: {} }) as never);
    const config = { disabled: null, areas: async () => [], settings: async () => ({}) as never, run } as unknown as ConfigApi;
    await open(`${TEAM}/charts/explore?measure=items&split=type&across=statusCategory&release=2.4&chart=bars`, config);
    await until('[data-explore-save]');
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-explore-save]')!).getByRole('button', { name: 'Save to Charts' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name this view' }), 'Types by status');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith('projects view set', { toilProject: 'sample-team', name: 'types-by-status', measure: 'items', split: 'type', across: 'statusCategory', where: ['release = 2.4'], title: 'Types by status', chart: 'bars' });
    expect((await until<HTMLElement>('[data-explore-saved]')).textContent).toContain('Saved by your team');
    expect(takeSaved()).toBe(true);
    expect(takeSaved()).toBe(false);
  });

  it('offers to replace a view that already exists, without showing a command', async () => {
    const run = vi.fn(async (_c: string, input: Record<string, unknown>) =>
      input.replace ? ({ ok: true, data: {}, error: null, meta: {} } as never) : ({ ok: false, data: null, error: { code: 'INVALID_INPUT', message: 'Toil project sample-team\'s view types is already set.', fix: 'Pass --replace to change it, or pick another name.' }, meta: {} } as never),
    );
    const config = { disabled: null, areas: async () => [], settings: async () => ({}) as never, run } as unknown as ConfigApi;
    await open(`${TEAM}/charts/explore?measure=items&split=type`, config);
    await until('[data-explore-save]');
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-explore-save]')!).getByRole('button', { name: 'Save to Charts' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name this view' }), 'Types');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('already exists');
    expect(alert.textContent).not.toContain('--replace');
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    await waitFor(() => expect(run).toHaveBeenLastCalledWith('projects view set', expect.objectContaining({ replace: true })));
  });
});

describe('what every chart does', () => {
  it('registers the main chart while the page is open, and clears it when it goes', async () => {
    await open(`${TEAM}/charts/sprints`);
    await waitFor(() => expect(getCurrentChart()?.title).toMatch(/What became of each sprint's work/));
    await go(`${TEAM}/charts`);
    await waitFor(() => expect(getCurrentChart()).toBeNull());
  });

  it('opens Ask with the chart attached from a suggested question', async () => {
    await open(`${TEAM}/charts/where`);
    await userEvent.click(await screen.findByRole('button', { name: 'What are we spread across?' }));
    const chat = await screen.findByRole('dialog', { name: 'Ask about sample-team' });
    expect(within(chat).getByText(/About: Days in progress by week/)).toBeTruthy();
    expect((within(chat).getByRole('textbox', { name: 'Your question' }) as HTMLInputElement).value).toBe('What are we spread across?');
  });

  it('copies the figures for any AI from the menu', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open(`${TEAM}/charts/releases`);
    await userEvent.click((await screen.findAllByRole('button', { name: /^Menu for Burn-up: 2\.4/ }))[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy for AI' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = (writeText.mock.calls as unknown as string[][])[0]![0]!;
    expect(text.startsWith('# Burn-up: 2.4')).toBe(true);
    expect(text).toContain('My question:');
    expect((await until<HTMLElement>('[data-chart-said]')).textContent).toContain('Copied for AI');
  });

  it('exports the figures as a CSV download, with no server involved', async () => {
    const make = vi.fn(() => 'blob:chart');
    Object.defineProperty(URL, 'createObjectURL', { value: make, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await open(`${TEAM}/charts/sprints`);
    await userEvent.click((await screen.findAllByRole('button', { name: /^Menu for What became of each sprint/ }))[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export the figures' }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalled();
    const blob = (make.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toMatch(/^What became of it,Sprint 21,/);
    expect((await until<HTMLElement>('[data-chart-said]')).textContent).toContain('what-became-of-each-sprint-s-work.csv');
  });

  it('draws the due date as a rule, and "Scope" beside "Done" in the burn-up legend', async () => {
    await open(`${TEAM}/charts/releases`);
    const section = await until<HTMLElement>('[data-release="2.4"]');
    await waitFor(() => expect(section.querySelector('.ck-marker')).toBeTruthy());
    expect(section.querySelector('.ck-marker')!.textContent).toBe('Due 24 Oct');
    const legend = section.querySelector('.ck-legend')!.textContent!;
    expect(legend).toContain('Done');
    expect(legend).toContain('Scope');
    expect(section.textContent).not.toContain('Everything in it: dashed');
    expect(within(section).getByRole('heading', { name: 'Mix' })).toBeTruthy();
  });

  it('says dates in notes as "16 Jul", never as ISO days', async () => {
    await open(`${TEAM}/charts/flow`);
    await until('[data-flow-section="throughput"] .ck-source');
    expect(document.querySelector('[data-flow-section="throughput"] .ck-source')!.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
