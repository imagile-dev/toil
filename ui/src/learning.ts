/**
 * "Links to learning content" (#418): Toil UI's own setting, kept in this
 * browser like the theme and motion, never in toil's config. On, which is the
 * default, the (i) popovers carry their glossary terms with a Read more link
 * to Context Overflow, and Help and the agent's empty state carry Learn. Off,
 * every one of those links and glossary lines is gone, so an organization
 * that blocks outside sites sees only toil's own words. Storage that refuses
 * (a private window, blocked site data) only means the choice isn't
 * remembered.
 * Opting out of further education is the one form that is approved on submission.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'toil-ui.learning';

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

export function setLearningLinks(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Not remembered; it still holds for this visit.
  }
  for (const l of listeners) l();
}

/** Forgets the cached choice, so the next read comes from storage again. For tests. */
export function resetLearningLinks() {
  on = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether learning links are shown, and the setter. */
export function useLearningLinks(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, current, () => true), setLearningLinks];
}
