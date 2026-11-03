/**
 * Plain words (prototype): a switch that renames engineer and toil jargon in
 * the screens' labels and copy as everyday words, with the precise term one
 * hover away. Same build either way: `?words=plain` in the address turns it
 * on, `?words=standard` turns it off, and what a person last chose is kept in
 * this browser (`toil-ui.words`), read once when the page starts, the way
 * `?theme=` is (src/theme-choice.ts). Plain words are the default: only a
 * person who chose standard, in Settings or in the address, reads toil's own
 * terms (#552). Storage that refuses just means it isn't remembered.
 *
 * It renames control names (a tab, a button, a link) and the copy around
 * them, never a fact, a number, a command, an error or its fix: those read
 * the same either way, so what a person, a script or voice control looks for
 * is the one name on screen (WCAG 2.5.3). A name is only ever swapped
 * at the place that renders it, so its visible label and its accessible name
 * are the same words, and its `title` says what toil calls it.
 *
 * It sits beside themes, not under them. A theme still decides colours,
 * shapes, moments and the microcopy it words (src/wording.ts); where plain
 * words has a text of its own for a key (PLAIN_WORDS), that text is the one
 * shown, and any other microcopy has the three jargon words swapped in it
 * (`plainify`). The glossary of words nobody asked for, translated by the
 * people who first wrote them down.
 */

import { useSyncExternalStore } from 'react';
import { wordFor, type WordKey } from './wording.ts';

const KEY = 'toil-ui.words';

/** `?words=plain` / `?words=standard` in the address wins, then what this browser chose last, then plain. */
export function initialPlain(search: string, saved: string | null): boolean {
  const param = new URLSearchParams(search).get('words');
  if (param === 'plain') return true;
  if (param === 'standard' || param === 'off') return false;
  return saved !== 'standard';
}

let current: boolean | null = null;
const listeners = new Set<() => void>();

function remember(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'plain' : 'standard');
  } catch {
    // Not remembered; nothing else depends on it.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.words = on ? 'plain' : 'standard';
}

/** Read once, the first time anything asks; after that the switch is the only thing that changes it. */
function read(): boolean {
  if (current === null) {
    if (typeof window === 'undefined') return true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // Treated as never chosen.
    }
    current = initialPlain(window.location.search, saved);
    remember(current);
  }
  return current;
}

/** Turns plain words on or off, for every screen at once. */
export function setPlain(on: boolean) {
  current = on;
  remember(on);
  for (const l of listeners) l();
}

/** Forgets the choice read at start-up, so the next read comes from the address and storage again. For tests. */
export function resetPlain() {
  current = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export interface Plain {
  on: boolean;
  /** The plain word when plain words are on, else the standard one. Both name the same control. */
  pw: (standard: string, plain: string) => string;
  /** The hover that names what toil calls it, when plain words are on; nothing otherwise. */
  title: (precise: string) => string | undefined;
  /** A sentence with its jargon swapped (plainify) when plain words are on; as it is otherwise. */
  text: (standard: string) => string;
}

export function usePlain(): Plain {
  const on = useSyncExternalStore(subscribe, read, () => true);
  return { on, pw: (standard, plain) => (on ? plain : standard), title: (precise) => (on ? `In toil: ${precise}` : undefined), text: (standard) => (on ? plainify(standard) : standard) };
}

/** Whether plain words are on, for code outside a component (a test, the word lookup). */
export const plainOn = (): boolean => read();

/** "Toil project" keeps its capital T mid-sentence, since it is a name; the other swaps follow the case of the word they replace. */
const keepCase = (from: string, to: string) => (to.startsWith('Toil ') || from[0] === from[0]!.toUpperCase() ? to[0]!.toUpperCase() + to.slice(1) : to);

/**
 * The three words that confuse most, swapped inside a sentence: dossier to
 * Toil project (not "team": a dossier needn't be one, and "project" alone
 * collides with Jira's and Azure DevOps's), pull request to code review,
 * agent to AI helper. A `toil dossiers …` command is left alone, since a
 * command is typed exactly, and so is a dossier inside an id or a path
 * (`dossier-setup`, `dossier:card-payments`).
 */
export function plainify(text: string): string {
  return text
    .replace(/(?<!toil |[\w:/-])(dossier)(s?)\b(?![\w:/-]|\.\w)/gi, (_m, w: string, s: string) => keepCase(w, 'Toil project') + s)
    .replace(/\b(pull request)(s?)\b/gi, (_m, w: string, s: string) => keepCase(w, 'code review') + s)
    .replace(/\b(agent)(s?)\b/gi, (_m, w: string, s: string) => keepCase(w, 'AI helper') + s);
}

/**
 * The microcopy plain words writes itself, in place of the theme's and the
 * standard text, for the keys that name a control or a screen. A `{name}`
 * and every `toil …` command the standard text has is kept.
 */
export const PLAIN_WORDS: Partial<Record<WordKey, string>> = {
  'dossiers.lede': 'Each Toil project is one body of work: its code, its tracker, its builds and its releases. Pick one to see its stories, code reviews and releases together. On the command line, a Toil project is called a dossier.',
  'dossier.eyebrow': 'Toil project',
  'empty.dossiers': 'toil sees no Toil projects yet. A Toil project is made with toil dossiers init.',
  'loading.dossiers': 'Reading your Toil projects…',
  'ask.placeholder': 'Ask a question about {name}',
  'ask.placeholder.short': 'Ask a question',
  'ask.note': 'Every answer says which items it comes from. The AI helper only reads: it never changes a ticket. Anything it suggests comes back for you to approve.',
  'ask.welcome': 'Ask anything about {name}: its sprint, its people, what is stuck or waiting on a review. Every answer says which items it comes from.',
  'status.cache': 'Reading saved data',
  'status.live': 'Reading live from your tools',
  'status.registry': 'Reading what a tool can answer',
  'status.writing': 'Writing the answer',
};

/**
 * The microcopy for a key: src/wording.ts as it is with plain words off; with them on, plain words' own text
 * where it has one, else the theme's or the standard text with its jargon swapped.
 */
export function wordsFor(lexicon: Partial<Record<WordKey, string>> | undefined, themed: boolean, plain: boolean, key: WordKey, vars?: Record<string, string>): string {
  if (!plain) return wordFor(lexicon, themed, key, vars);
  const own = PLAIN_WORDS[key];
  return own ? wordFor({ [key]: own }, true, key, vars) : plainify(wordFor(lexicon, themed, key, vars));
}
