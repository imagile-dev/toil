// @vitest-environment jsdom
// A design review's findings, each held here so the next round doesn't file them again under a new ticket number.
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { focusQuietly } from '../src/App.tsx';
import { cardWhy } from '../src/components/summary.tsx';
import { open, panel, resetBrowserState } from './views-kit.tsx';

beforeEach(resetBrowserState);

describe('the focus a new page takes (#657)', () => {
  it('draws no ring until the heading loses focus, and never scrolls', () => {
    const h1 = document.createElement('h1');
    h1.tabIndex = -1;
    document.body.append(h1);
    focusQuietly(h1);
    expect(document.activeElement).toBe(h1);
    expect(h1.hasAttribute('data-nav-focus')).toBe(true);
    h1.blur();
    expect(h1.hasAttribute('data-nav-focus')).toBe(false);
    h1.remove();
  });
});

describe("a Summary card's line on why (#657)", () => {
  it('keeps a short line whole, a long one to its first sentence, and a failed read every word', () => {
    expect(cardWhy({ id: 'risk', tone: 'danger', why: 'Its tests are failing.' })).toBe('Its tests are failing.');
    const long = 'It can’t move until another story is finished. 2 other stories (11 points) wait behind it, and one of them is due in the next release.';
    expect(cardWhy({ id: 'risk', tone: 'danger', why: long })).toBe('It can’t move until another story is finished.');
    const failed = `${'The Jira read failed. '.repeat(6)}Sync again.`;
    expect(cardWhy({ id: 'clear', tone: 'warn', why: failed })).toBe(failed);
  });
});

describe('Tickets (#657)', () => {
  it('puts Open the board on the heading row as a quiet button, and the filter bar with the table it filters', async () => {
    await open('#/project/card-payments/command-center');
    const board = document.querySelector<HTMLAnchorElement>('[data-open-board]')!;
    expect(board.closest('.view-head__row')).not.toBeNull();
    expect(board.className).toMatch(/btn--quiet/);
    const items = panel('Items');
    expect(within(items).getByRole('table')).toBeTruthy();
    expect(items.querySelector('.filter-bar, [data-filter-bar]') ?? within(items).queryByRole('button', { name: /Add filter/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start 1 ready item' }).textContent).toBe('Start 1');
  });
});
