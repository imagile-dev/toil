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
  },
  terms: { agent: 'Sage', blocked: 'Locked door' },
  words: { attention: 'Locked doors', agent: 'Seek out the sage', quit: 'Save and quit' },
  ornament: 'fairies',
};
