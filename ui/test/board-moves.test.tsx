import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { fixtureClassify } from '../src/fixtures/classify.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import type { ClassifyApi } from '../src/classify-api.ts';
import type { MoveOutcome } from '../src/board-api.ts';
import { resetBoardMoves, setBoardMoves } from '../src/board-moves.ts';
import { appliesItself } from '../src/model/board.ts';
import { dropVerdict } from '../src/views/Board.tsx';
import type { WorkItem } from '../src/toil.ts';

/**
 * What a drop does (a person moved a card): with "Apply board moves when I drop a card" on, the default, the move is made
 * through the server and toil; every other case is the proposal it always was, with the line saying why. A drop and the
 * card's menu are one code path (`move` in Board.tsx), and the menu is how these tests make it, since jsdom has no layout
 * for a pointer to drag across.
 */

beforeEach(() => {
  localStorage.clear();
  resetBoardMoves();
});
afterEach(cleanup);

const PAY = 'corp-jira:PAY-102';

/** A ClassifyApi that can apply a move, whatever the sample's script says; `moveItem` is the spy. */
function api(moveItem: ClassifyApi['moveItem'], movesDisabled: string | null = null): ClassifyApi {
  return { ...fixtureClassify(), movesDisabled, ...(moveItem ? { moveItem } : {}) };
}

async function openBoard(classify: ClassifyApi | undefined) {
  window.location.hash = '#/project/card-payments/board';
  render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview {...(classify ? { classify } : {})} />);
  const board = await screen.findByRole('region', { name: 'Sprint 42 board' });
  return {
    board,
    col: (name: string) => within(board).getByRole('region', { name: new RegExp(`^${name}`) }),
    grip: () => within(board).getByRole('group', { name: 'PAY-102 Store tokens in the vault' }),
  };
}

/** Moves PAY-102 from its card's menu, as a drop on the column would. */
async function drop(grip: HTMLElement, to: 'In progress' | 'Done' | 'To do') {
  fireEvent.contextMenu(grip);
  const menu = await screen.findByRole('menu', { name: 'PAY-102 Store tokens in the vault' });
  await userEvent.click(within(menu).getByRole('menuitem', { name: to }));
}

const inColumn = (col: HTMLElement) => within(col).queryByRole('group', { name: 'PAY-102 Store tokens in the vault' }) !== null;

describe('the setting', () => {
  it('is on until a person turns it off, and is remembered in this browser', async () => {
    window.location.hash = '#/settings/general';
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    const box = await screen.findByRole('checkbox', { name: 'Apply board moves when I drop a card' });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem('toil-ui.board-moves')).toBeNull();
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(localStorage.getItem('toil-ui.board-moves')).toBe('off');
    // A fresh read of storage, as a reload would make.
    resetBoardMoves();
    cleanup();
    window.location.hash = '#/settings/general';
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    expect(((await screen.findByRole('checkbox', { name: 'Apply board moves when I drop a card' })) as HTMLInputElement).checked).toBe(false);
  });

  it('explains itself in an (i) beside it, with a Read more link to the docs', async () => {
    window.location.hash = '#/settings/general';
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    await screen.findByRole('checkbox', { name: 'Apply board moves when I drop a card' });
    await userEvent.click(document.querySelector<HTMLElement>('[data-help="board-moves"]')!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/Dropping a card on another column makes the move through toil/);
    expect(within(dialog).getByRole('link', { name: /Read more/ }).getAttribute('href')).toBe('https://imagile-dev.github.io/toil/docs/ui/#board-moves');
  });
});

describe('a drop with the setting on', () => {
  it('moves the card at once, sends only the Toil project, the item and the column, and says so with an Undo that sends the reverse', async () => {
    let finish!: (o: MoveOutcome) => void;
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>().mockImplementationOnce(() => new Promise<MoveOutcome>((r) => (finish = r)));
    const { board, col, grip } = await openBoard(api(moveItem));
    await drop(grip(), 'In progress');
    expect(moveItem).toHaveBeenCalledTimes(1);
    expect(moveItem).toHaveBeenCalledWith('card-payments', PAY, 'IN_PROGRESS');
    // In its new column before the tracker has answered, quietly marked as moving; no proposal and no ghost.
    expect(inColumn(col('In progress'))).toBe(true);
    expect(inColumn(col('To do'))).toBe(false);
    expect(within(board.parentElement!).getByText('Moving…')).toBeTruthy();
    expect(within(board).queryByRole('article')).toBeNull();
    expect(document.querySelector('[data-proposed-ghost]')).toBeNull();
    await act(async () => finish({ status: 'applied', transition: 'Start progress', toStatus: 'In Progress' }));
    const line = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-board-notice="moved"]');
      if (!el) throw new Error('no notice yet');
      return el;
    });
    expect(line.textContent).toContain('with the transition Start progress');
    expect(line.textContent).toContain('Moved PAY-102 to In progress');
    expect(screen.queryByText('Moving…')).toBeNull();
    expect(inColumn(col('In progress'))).toBe(true);
    // The Undo is the reverse move, by the same route.
    moveItem.mockResolvedValueOnce({ status: 'applied', transition: 'Stop progress', toStatus: 'To Do' });
    await userEvent.click(screen.getByRole('button', { name: 'Undo the move of PAY-102' }));
    await waitFor(() => expect(moveItem).toHaveBeenLastCalledWith('card-payments', PAY, 'TODO'));
    await waitFor(() => expect(inColumn(col('To do'))).toBe(true));
    expect(inColumn(col('In progress'))).toBe(false);
    expect(moveItem).toHaveBeenCalledTimes(2);
  });

  it("sends the card back and says in toil's own words why, when toil refuses; the message stays until dismissed", async () => {
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>().mockRejectedValue(new Error("Changes to corp-jira are switched off, so PAY-102 wasn't changed. Turn writes on for corp-jira under Settings, Connections."));
    const { col, grip } = await openBoard(api(moveItem));
    await drop(grip(), 'Done');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/PAY-102 was not moved to Done.*switched off.*Settings, Connections/);
    expect(inColumn(col('To do'))).toBe(true);
    expect(inColumn(col('Done'))).toBe(false);
    expect(screen.queryByText('Moving…')).toBeNull();
    // Nothing else on screen takes it away.
    await userEvent.click(within(col('To do')).getAllByRole('link')[0]!).catch(() => undefined);
    expect(screen.getByRole('alert')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("shows the proposal with the moves toil offers when more than one transition leads there, and sends nothing more", async () => {
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>().mockResolvedValue({ status: 'proposal', why: 'choices', reason: '"start" is ambiguous for PAY-102 (Story, now To Do): more than one move leads into its status category: In Progress, In Review.', detail: 'PAY-102 offers: In Progress; In Review. Pass one of them with --to <status>.' });
    const { board, col, grip } = await openBoard(api(moveItem));
    await drop(grip(), 'In progress');
    const card = await within(board).findByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.querySelector('[data-proposal-why]')!.textContent).toMatch(/ambiguous for PAY-102/);
    expect(card.textContent).toContain('In Progress; In Review');
    expect(within(card).queryByRole('button', { name: /^Apply/ })).toBeNull();
    // The card went back to the column the tracker still has it in.
    expect(inColumn(col('To do'))).toBe(true);
    expect(moveItem).toHaveBeenCalledTimes(1);
  });

  it('leaves a connection with writes off as a proposal that says so', async () => {
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>().mockResolvedValue({ status: 'proposal', why: 'writes-off', reason: 'Changes to corp-jira are switched off, so this move was not applied. Turn them on under Settings, Connections, or apply the proposal yourself.' });
    const { board, col, grip } = await openBoard(api(moveItem));
    await drop(grip(), 'In progress');
    const card = await within(board).findByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.querySelector('[data-proposal-why]')!.textContent).toMatch(/switched off/);
    expect(inColumn(col('To do'))).toBe(true);
  });
});

describe('a drop that stays a proposal', () => {
  it('in the sample sends nothing, never moves the card, and says the sample cannot write', async () => {
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>();
    const { board, col, grip } = await openBoard(api(moveItem, "This is sample data, so nothing here can be written."));
    await drop(grip(), 'In progress');
    const card = within(board).getByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.querySelector('[data-proposal-why]')!.textContent).toMatch(/sample data/);
    // No primary action: the sample has nothing to apply it to.
    expect(within(card).queryByRole('button', { name: /^Apply/ })).toBeNull();
    expect(inColumn(col('To do'))).toBe(true);
    expect(screen.queryByText('Moving…')).toBeNull();
    expect(moveItem).not.toHaveBeenCalled();
  });

  it('with the setting off sends nothing and is the card it always was: the reason, an Apply, the command a step further in', async () => {
    setBoardMoves(false);
    const moveItem = vi.fn<NonNullable<ClassifyApi['moveItem']>>().mockResolvedValue({ status: 'applied', transition: 'Start progress', toStatus: 'In Progress' });
    const { board, col, grip } = await openBoard(api(moveItem));
    await drop(grip(), 'In progress');
    const card = within(board).getByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.querySelector('[data-proposal-why]')!.textContent).toMatch(/off in Settings, General/);
    expect(moveItem).not.toHaveBeenCalled();
    expect(inColumn(col('To do'))).toBe(true);
    // The command is behind "Show the command", still in the page for whoever opens it.
    const details = card.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Show the command');
    expect(details.textContent).toContain("toil jira issue transition 'PAY-102' --toil-project 'card-payments' --to 'start' --allow-write");
    expect(within(details as HTMLElement).getByRole('button', { name: 'Copy command' })).toBeTruthy();
    expect(within(card).getByRole('radio', { name: 'PowerShell' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    // A press on Apply is the same move, by the same route.
    await userEvent.click(within(card).getByRole('button', { name: 'Apply: Move PAY-102 to In progress' }));
    await waitFor(() => expect(moveItem).toHaveBeenCalledWith('card-payments', PAY, 'IN_PROGRESS'));
    await waitFor(() => expect(inColumn(col('In progress'))).toBe(true));
    expect(within(board).queryByRole('article', { name: /^Proposal/ })).toBeNull();
  });

  it("where a view has no server to ask, is the proposal, and says it can't change the tracker", async () => {
    const { board, col, grip } = await openBoard(undefined);
    await drop(grip(), 'In progress');
    const card = within(board).getByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.querySelector('[data-proposal-why]')!.textContent).toMatch(/can't change your tracker/);
    expect(inColumn(col('To do'))).toBe(true);
  });

  it('says on the dragged copy whether a drop moves the card or proposes the move', () => {
    const card = { statusCategory: 'TODO' } as WorkItem;
    expect(dropVerdict(card, 'DONE', true, true)).toEqual({ ok: true, text: 'Drop to move: Done' });
    expect(dropVerdict(card, 'DONE', true, false)).toEqual({ ok: true, text: 'Drop to propose: Done' });
    expect(dropVerdict(card, 'TODO', true, true).ok).toBe(false);
    // A lane is a grouping, not a status: a drop in another lane is refused whatever the setting says.
    expect(dropVerdict(card, 'DONE', false, true)).toEqual({ ok: false, text: 'Another lane: a lane is a grouping, nothing to change' });
  });

  it('leaves a GitHub card to its command, because a project Status has no category to choose by', () => {
    const of = (area: string) => ({ source: { area } }) as unknown as WorkItem;
    expect(appliesItself(of('jira'))).toBe(true);
    expect(appliesItself(of('ado'))).toBe(true);
    expect(appliesItself(of('github'))).toBe(false);
  });
});
