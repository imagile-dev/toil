/**
 * "Apply board moves when I drop a card": Toil UI's own setting, kept in this
 * browser like the theme and the learning links, never in toil's config. On,
 * which is the default, dropping a card on another column makes the move
 * through toil's own command (behind the connection's `writes`, which stays
 * the person's). Off, a drop only proposes the move, with the command to run
 * yourself. The setting is the person's say on the page; whether the connection
 * allows it is still toil's. Storage that refuses (a private window, blocked
 * site data) only means the choice isn't remembered.
 * A drop is consent already given by hand, so asking again would be a form about the form.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'toil-ui.board-moves';

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let on: boolean | null = null;
const listeners = new Set<() => void>();

function current(): boolean {
  on ??= remembered();
  return on;
}

export function setBoardMoves(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Not remembered; it still holds for this visit.
  }
  for (const l of listeners) l();
}

/** Forgets the cached choice, so the next read comes from storage again. For tests. */
export function resetBoardMoves() {
  on = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a drop applies the move, and the setter. */
export function useBoardMoves(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, current, () => true), setBoardMoves];
}
