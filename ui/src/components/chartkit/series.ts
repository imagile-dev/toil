/**
 * Which four series marks are showing: the current theme's `series` for the
 * colour scheme in effect (src/theme-pack.ts, `Mark`). The scheme is read the
 * way the particles and the tab icon read it (`useResolvedScheme`), so
 * "system" is whatever the operating system has now.
 *
 * - `useSeriesMarks(): Mark[]` is the four marks of the current theme and scheme.
 * - `marksFor(theme, scheme)` is the same without React.
 * - `useDrawSimple(): boolean` is whether to draw plain borders rather than
 *   frames: Simple chart marks is on, or the system forces colours.
 *
 * Four marks is what the committee budgeted for. A fifth was requested and filed under "Other".
 */

import { useEffect, useState } from 'react';
import { useSimpleMarks } from '../../simple-marks.ts';
import { useTheme, useThemeChoiceContext } from '../../theme-context.ts';
import { useResolvedScheme } from '../../theme-choice.ts';
import type { Mark, Scheme, ThemeManifest } from '../../theme-pack.ts';

export const marksFor = (theme: ThemeManifest, scheme: Scheme): Mark[] => [...theme.series[scheme]];

export function useSeriesMarks(): Mark[] {
  const theme = useTheme();
  const { scheme } = useThemeChoiceContext();
  return marksFor(theme, useResolvedScheme(scheme));
}

/** Whether the system is drawing in forced colours (Windows High Contrast), where every mark is a system colour and only its border style tells it apart. */
export function useForcedColors(): boolean {
  const [forced, setForced] = useState(() => window.matchMedia?.('(forced-colors: active)')?.matches ?? false);
  useEffect(() => {
    const q = window.matchMedia?.('(forced-colors: active)');
    if (!q) return;
    const follow = () => setForced(q.matches);
    follow();
    q.addEventListener('change', follow);
    return () => q.removeEventListener('change', follow);
  }, []);
  return forced;
}

/** Plain borders instead of frames: the setting, or forced colours. (A segment too small for a frame is decided per segment by `MarkRect`.) */
export function useDrawSimple(): boolean {
  const simple = useSimpleMarks();
  const forced = useForcedColors();
  return simple || forced;
}
