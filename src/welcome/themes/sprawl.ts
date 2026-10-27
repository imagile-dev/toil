import type { TerminalTheme } from './types.js';

/** Sprawl's terminal version (ui/themes/sprawl/theme.json). Neon on file after dark, the same city at dawn in daylight. */
export const sprawl: TerminalTheme = {
  name: 'sprawl',
  label: 'Sprawl',
  schemes: {
    dark: {
      bg: '#07060f',
      ink: '#eaf6ff',
      muted: '#a8a3cf',
      accent: '#ff2e88',
      link: '#3ff0ff',
      ok: '#39ff9c',
      danger: '#ff6470',
    },
    light: {
      bg: '#e9e7f2',
      ink: '#14102a',
      muted: '#4a4570',
      accent: '#b80f62',
      link: '#00667a',
      ok: '#0a6e3e',
      danger: '#bd1530',
    },
  },
  terms: { agent: 'Netrunner', blocked: 'Black ICE' },
  words: { attention: 'Black ICE', agent: 'Jack in a netrunner', quit: 'Jack out' },
  ornament: 'rain',
};
