import type { TerminalTheme } from './types.js';

/** Sprawl's terminal version (ui/themes/sprawl/theme.json). Neon on file, with the variance request still pending. */
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
  },
  terms: { agent: 'Netrunner', blocked: 'Black ICE' },
  words: { attention: 'Black ICE', agent: 'Jack in a netrunner', quit: 'Jack out' },
  ornament: 'rain',
};
