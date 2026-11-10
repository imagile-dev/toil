import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Agent, AskExtra } from '../src/agent.ts';
import { App } from '../src/App.tsx';
import { CellChip } from '../src/components/items.tsx';
import { paletteEntries, type EntriesInput } from '../src/components/palette.tsx';
import { askAboutChart } from '../src/commands.ts';
import { getCurrentChart, setCurrentChart } from '../src/current-chart.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { cellCite } from '../src/view-context.ts';
import { sampleContext } from './view-context-kit.ts';

/**
 * Ask about this chart (#567), on the page: the chip that says what is
 * attached and takes it off, what a question carries, the palette command that
 * exists only while a chart is on screen, and a cell citation drawn as a chip.
 */

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init });

async function open(agent: Agent, toilProject = 'sample-team') {
  window.location.hash = `#/project/${toilProject}`;
  render(<App execute={fixtureExecute().execute} agent={agent} now={FIXTURE_NOW} preview />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
}

beforeEach(() => {
  localStorage.clear();
  setCurrentChart(null);
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  setCurrentChart(null);
  window.history.replaceState(null, '', '/');
});

describe('opening Ask with a chart', () => {
  it('attaches it as a chip with a suggested question, sends nothing yet, and takes it off with the x', async () => {
    const sent: AskExtra[] = [];
    const agent: Agent = { starters: () => [], ask: async (_t, prompt, _s, _c, extra) => (sent.push(extra ?? {}), { prompt, parts: [{ text: 'Fine.' }], citations: [], by: 'Claude', proposals: [] }) };
    await open(agent);
    const context = sampleContext();
    act(() => askAboutChart(context, 'Why did the mix move?'));
    const chat = await screen.findByRole('dialog', { name: 'Ask about sample-team' });
    expect(within(chat).getByText('About: Work mix by release')).toBeTruthy();
    expect((within(chat).getByRole('textbox', { name: 'Your question' }) as HTMLInputElement).value).toBe('Why did the mix move?');
    expect(sent).toEqual([]);

    // Sent, it carries the context as it was built; the server checks it.
    await userEvent.click(within(chat).getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.context).toEqual(context);

    // Removed, the next question carries none.
    await userEvent.click(within(chat).getByRole('button', { name: 'Stop asking about this chart' }));
    expect(within(chat).queryByText('About: Work mix by release')).toBeNull();
    await userEvent.type(within(chat).getByRole('textbox', { name: 'Your question' }), 'And now?{Enter}');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.context).toBeUndefined();
  });

  it('shows the chip on the bar too, so what is attached is in sight before the conversation opens', async () => {
    await open(scriptedAgent());
    act(() => askAboutChart(sampleContext('Releases')));
    const chat = await screen.findByRole('dialog', { name: 'Ask about sample-team' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask about sample-team' })).toBeNull());
    const bar = screen.getByRole('region', { name: 'Ask about sample-team' });
    expect(within(bar).getByText('About: Releases')).toBeTruthy();
    expect(chat.isConnected).toBe(false);
  });

  it('answers in the preview from the chart, with each cell it cites drawn as a chip of the row and column', async () => {
    await open(scriptedAgent());
    const context = sampleContext();
    act(() => askAboutChart(context));
    const chat = await screen.findByRole('dialog', { name: 'Ask about sample-team' });
    await userEvent.type(within(chat).getByRole('textbox', { name: 'Your question' }), 'Explain this{Enter}');
    await waitFor(() => expect(chat.querySelectorAll('[data-cell-cite]').length).toBe(2), { timeout: 3000 });
    for (const chip of chat.querySelectorAll('[data-cell-cite]')) {
      const cell = context.cells.find((c) => cellCite(c) === chip.getAttribute('data-cell-cite'))!;
      expect(chip.textContent).toContain(cell.rowLabel);
      expect(chip.textContent).toContain(cell.columnLabel);
    }
  }, 20_000);
});

describe('the cell chip', () => {
  it('is plain text with no handler, a button with one, and a bare marked citation for a cell the chart does not hold', async () => {
    const context = sampleContext();
    const cell = context.cells.find((c) => c.count > 0)!;
    const picked: Array<[string, string]> = [];
    const { rerender } = render(<CellChip cite={cellCite(cell)} view={context} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText(`Chart cell: ${cell.rowLabel}, ${cell.columnLabel}`)).toBeTruthy();
    rerender(<CellChip cite={cellCite(cell)} view={context} onPress={(column, row) => picked.push([column, row])} />);
    await userEvent.click(screen.getByRole('button', { name: `Chart cell: ${cell.rowLabel}, ${cell.columnLabel}` }));
    expect(picked).toEqual([[cell.column, cell.row]]);
    rerender(<CellChip cite="v:nothing/v:nowhere" view={context} />);
    expect(screen.getByText('cell:v:nothing/v:nowhere').className).toBe('missing');
    rerender(<CellChip cite={cellCite(cell)} view={null} />);
    expect(screen.getByText(`cell:${cellCite(cell)}`).className).toBe('missing');
  });
});

describe('the current chart and the palette', () => {
  const base = (over: Partial<EntriesInput> = {}): EntriesInput => ({
    route: { view: 'dashboard', toilProject: 'sample-team' },
    toilProjects: ['sample-team'],
    loaded: {},
    analyses: {},
    synced: undefined,
    at: Date.parse(FIXTURE_NOW),
    themes: [{ name: 'plain', label: 'Plain' }],
    currentTheme: 'plain',
    setTheme: () => {},
    scheme: 'system',
    setScheme: () => {},
    onSync: undefined,
    focused: null,
    canAssign: false,
    adapters: null,
    agentSettings: false,
    openShortcuts: () => {},
    ...over,
  });

  it('registers and clears the chart a view is showing', () => {
    expect(getCurrentChart()).toBeNull();
    const context = sampleContext();
    setCurrentChart(context);
    expect(getCurrentChart()).toBe(context);
    setCurrentChart(null);
    expect(getCurrentChart()).toBeNull();
  });

  it('offers "Ask about this chart" only while a chart is on screen, apart from "Ask about <project>"', async () => {
    const execute = fixtureExecute().execute;
    const { loadToilProject } = await import('../src/load.ts');
    const data = await loadToilProject(execute, 'sample-team');
    const ids = (chart: ReturnType<typeof sampleContext> | null) => paletteEntries(base({ loaded: { 'sample-team': { ok: true, value: data } }, chart })).filter((e) => e.id.startsWith('cmd:ask'));
    expect(ids(null).map((e) => e.label)).toEqual(['Ask about sample-team']);
    const context = sampleContext();
    const withChart = ids(context);
    expect(withChart.map((e) => e.label)).toEqual(['Ask about sample-team', 'Ask about this chart']);
    expect(withChart[1]!.go).toEqual({ command: { kind: 'ask-about', context } });
  });

  it('runs from the palette: it opens Ask with the chart attached', async () => {
    await open(scriptedAgent());
    const context = sampleContext();
    act(() => setCurrentChart(context));
    await act(async () => {
      press('k', { ctrlKey: true });
    });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await userEvent.click(within(palette).getByRole('menuitem', { name: /^Ask about this chart/ }));
    const chat = await screen.findByRole('dialog', { name: 'Ask about sample-team' });
    expect(within(chat).getByText('About: Work mix by release')).toBeTruthy();
  }, 20_000);
});
