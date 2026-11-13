/**
 * The chart on screen right now (#567). A Charts view registers the context of
 * the chart it is showing with `setCurrentChart` and clears it with
 * `setCurrentChart(null)` when it goes; the command palette reads it with
 * `useCurrentChart` to offer "Ask about this chart" only while there is one.
 * A tiny store with no provider, because the palette sits above every view and
 * cannot be handed anything by one. The register of what is currently
 * displayed is, appropriately, a register.
 */

import { useSyncExternalStore } from 'react';
import type { ViewContext } from './view-context.ts';

let current: ViewContext | null = null;
const listeners = new Set<() => void>();

/** Registers the chart on screen, or null when none is. */
export function setCurrentChart(context: ViewContext | null): void {
  if (context === current) return;
  current = context;
  for (const l of [...listeners]) l();
}

/** The chart on screen, or null. */
export const getCurrentChart = (): ViewContext | null => current;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The chart on screen, updated as views register and clear theirs. */
export function useCurrentChart(): ViewContext | null {
  return useSyncExternalStore(subscribe, getCurrentChart, getCurrentChart);
}
