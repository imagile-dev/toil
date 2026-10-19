/**
 * Which theme and colour scheme are showing. A `?theme=` or `?scheme=` in the
 * address wins (it makes a view linkable as it looked), then what this browser
 * picked last, then Crate, the default (#277). The choice is a convenience,
 * so storage that refuses (a private window, blocked site data) just means it
 * isn't remembered. Preferences are honoured without a request form.
 */

import { useEffect, useState } from 'react';
import { showFavicon } from './favicon.ts';
import { DEFAULT_THEME, THEMES, loadThemeStyles } from './themes.ts';

export type SchemeChoice = 'system' | 'light' | 'dark';
const SCHEMES: SchemeChoice[] = ['system', 'light', 'dark'];
const KEY = 'toil-ui.theme';

function remembered(): { theme?: string; scheme?: string } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { theme?: string; scheme?: string };
  } catch {
    return {};
  }
}

export function initialChoice(search: string): { theme: string; scheme: SchemeChoice } {
  const params = new URLSearchParams(search);
  const saved = remembered();
  const theme = [params.get('theme'), saved.theme].find((t) => THEMES.some((m) => m.name === t)) ?? DEFAULT_THEME;
  const scheme = [params.get('scheme'), saved.scheme].find((s): s is SchemeChoice => SCHEMES.includes(s as SchemeChoice)) ?? 'system';
  return { theme, scheme };
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
  };
}
