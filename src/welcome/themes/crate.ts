import type { TerminalTheme } from './types.js';

/**
 * Crate's terminal version (ui/themes/crate/theme.json), in the site's blue
 * (#472): its link is the site's highlight, and its faint is the site's faint
 * token, so on a dark terminal the default menu wears the site's palette. The light
 * scheme is the same blue deepened for warm paper, and needs no extras.
 * test/brand-sync.test.ts holds both to the site. Signed for in triplicate;
 * the third copy is filed under 'probably fine'.
 */
export const crate: TerminalTheme = {
  name: 'crate',
  label: 'Crate',
  schemes: {
    dark: {
      bg: '#0f1115',
      ink: '#e8eaed',
      muted: '#a7afba',
      accent: '#8cc4ff',
      link: '#c2e0ff',
      ok: '#6fd394',
      danger: '#ff8a80',
      faint: '#868f9b',
    },
    light: {
      bg: '#f4f2ed',
      ink: '#1a1e26',
      muted: '#505865',
      accent: '#1b66c4',
      link: '#0e4a96',
      ok: '#146c2e',
      danger: '#b42318',
    },
  },
  terms: {},
  words: { attention: 'Stuck in the aisle', agent: 'Put an agent on the dock', quit: 'Clock out' },
  ornament: 'orbit',
};
