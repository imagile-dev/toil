import type { TerminalTheme } from './types.js';

/** Overworld's terminal version (ui/themes/overworld/theme.json). Every locked door has a key, and every key has an approval chain. */
export const overworld: TerminalTheme = {
  name: 'overworld',
  label: 'Overworld',
  schemes: {
    dark: {
      bg: '#111c16',
      ink: '#f3efdc',
      muted: '#bcc7b4',
      accent: '#5cc46e',
      link: '#f2c94c',
      ok: '#7ed98f',
      danger: '#ff8a7a',
    },
    light: {
      bg: '#e9efd6',
      ink: '#241c14',
      muted: '#46564a',
      accent: '#1a7a4a',
      link: '#7a5000',
      ok: '#1d6a31',
      danger: '#b0231a',
    },
  },
  terms: { agent: 'Sage', blocked: 'Locked door' },
  words: { attention: 'Locked doors', agent: 'Seek out the sage', quit: 'Save and quit' },
  ornament: 'fairies',
};
