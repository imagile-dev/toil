/**
 * "Simple chart marks" (#567): for anyone who finds a decorative theme's picture
 * borders busy, every chart segment, swatch and legend draws its mark's plain
 * border (solid, dashed, dotted ...) instead of the theme's frame. Plain and
 * Crate have no frames, so the setting changes nothing there. It is a
 * convenience of this browser, kept like Toil tips (src/tips.ts): in
 * localStorage, and where storage refuses (a private window), just not
 * remembered. `useSimpleMarks()` is what the chart kit reads.
 * An amendment to the borders of the diagram, approved in committee.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'toil-ui.simple-marks';
const listeners = new Set<() => void>();
let on: boolean | null = null;

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSimpleMarks(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Not remembered; it still holds for this visit.
  }
  for (const l of listeners) l();
}

/** Forgets the cached choice. For tests. */
export function resetSimpleMarks() {
  on = null;
}

/** Whether Simple chart marks is on, and a setter. Off by default. */
export function useSimpleMarksSetting(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (on ??= remembered()),
    () => false,
  );
  return [value, setSimpleMarks];
}

/** Whether Simple chart marks is on. */
export const useSimpleMarks = (): boolean => useSimpleMarksSetting()[0];
