/**
 * What this browser remembers about the dossiers (#342), beside the theme:
 * when each dossier's dashboard was last opened here, so its card can say
 * what changed since, and which was opened most recently, so it can lead the
 * Dossiers view. Kept in localStorage, per browser, never sent anywhere; a
 * browser that keeps nothing (a private window, blocked storage) gets cards
 * that say nothing about "since". Renaming a dossier carries its entry over.
 * The sign-in sheet at the front desk, minus the clipboard.
 */

const KEY = 'toil-ui:looked';

type Looked = Record<string, string>;

function read(): Looked {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string' && !Number.isNaN(Date.parse(e[1]))));
  } catch {
    return {};
  }
}

function write(looked: Looked) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(looked));
  } catch {
    // Storage is off or full: the cards just won't say what changed since.
  }
}

/** When this browser last opened the dossier's dashboard, or null. */
export const lastLooked = (dossier: string): string | null => read()[dossier] ?? null;

/** The dossier opened most recently in this browser, of those named. */
export function lastOpened(names: string[]): string | null {
  const looked = read();
  return names.filter((n) => looked[n]).sort((a, b) => (looked[a]! < looked[b]! ? 1 : -1))[0] ?? null;
}

export function markLooked(dossier: string, at = new Date().toISOString()) {
  write({ ...read(), [dossier]: at });
}

/** A renamed dossier keeps what this browser knew about it. */
export function renameLooked(from: string, to: string) {
  const { [from]: was, ...rest } = read();
  if (was !== undefined) write({ ...rest, [to]: was });
}
