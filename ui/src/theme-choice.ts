/**
 * Which theme and colour scheme are showing, and how deep the theme goes
 * (#283): "Themed wording" (the theme's lexicon) and "Themed agent voice" (its
 * voice in the agent's prompt), both on unless switched off. A `?theme=`,
 * `?scheme=`, `?wording=off` or `?voice=off` in the address wins (it makes a
 * view linkable as it looked), then what this browser picked last, then
 * Crate, the default (#277), with both on. The choice is a convenience, so
 * storage that refuses (a private window, blocked site data) just means it
 * isn't remembered. Preferences are honoured without a request form.
 */

import { useEffect, useState } from 'react';
import { showFavicon } from './favicon.ts';
import { DEFAULT_THEME, THEMES, loadThemeStyles } from './themes.ts';

export type SchemeChoice = 'system' | 'light' | 'dark';
const SCHEMES: SchemeChoice[] = ['system', 'light', 'dark'];
const KEY = 'toil-ui.theme';

export interface ThemeChoice {
  theme: string;
  scheme: SchemeChoice;
  /** The theme's own microcopy (src/wording.ts); off reads the standard text. */
  wording: boolean;
  /** The theme's voice in the agent's prompt; off sends the rules and your instructions only. */
  voice: boolean;
}

function remembered(): Partial<Record<keyof ThemeChoice, unknown>> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Partial<Record<keyof ThemeChoice, unknown>>) : {};
  } catch {
    return {};
  }
}

/** `?wording=off` and `?voice=off` switch one off, `on` switches it on; anything else leaves it to what was saved. */
function flag(param: string | null, saved: unknown): boolean {
  if (param === 'off') return false;
  if (param === 'on') return true;
  return typeof saved === 'boolean' ? saved : true;
}

export function initialChoice(search: string): ThemeChoice {
  const params = new URLSearchParams(search);
  const saved = remembered();
  const theme = [params.get('theme'), saved.theme].find((t): t is string => THEMES.some((m) => m.name === t)) ?? DEFAULT_THEME;
  const scheme = [params.get('scheme'), saved.scheme].find((s): s is SchemeChoice => SCHEMES.includes(s as SchemeChoice)) ?? 'system';
  return { theme, scheme, wording: flag(params.get('wording'), saved.wording), voice: flag(params.get('voice'), saved.voice) };
}

export function useThemeChoice() {
  const [choice, setChoice] = useState(() => initialChoice(window.location.search));
  useEffect(() => {
    void loadThemeStyles(choice.theme);
    document.documentElement.dataset.theme = choice.theme;
    document.documentElement.dataset.scheme = choice.scheme;
    try {
      localStorage.setItem(KEY, JSON.stringify(choice));
    } catch {
      // Not remembered; nothing else depends on it.
    }
    // The tab's icon follows the scheme too (Plain has one per scheme), and with
    // `system` it follows the operating system as it changes.
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
    const icon = () => showFavicon(choice.theme, choice.scheme === 'system' ? (dark?.matches ? 'dark' : 'light') : choice.scheme);
    icon();
    dark?.addEventListener('change', icon);
    return () => dark?.removeEventListener('change', icon);
  }, [choice]);
  return {
    ...choice,
    setTheme: (theme: string) => setChoice((c) => ({ ...c, theme })),
    setScheme: (scheme: SchemeChoice) => setChoice((c) => ({ ...c, scheme })),
    setWording: (wording: boolean) => setChoice((c) => ({ ...c, wording })),
    setVoice: (voice: boolean) => setChoice((c) => ({ ...c, voice })),
  };
}

export type ThemeChoiceState = ReturnType<typeof useThemeChoice>;
