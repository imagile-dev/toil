import type { TerminalTheme } from './types.js';

/** Frontier's terminal version (ui/themes/frontier/theme.json). Territory claimed by memo, surveyed by a second memo. */
export const frontier: TerminalTheme = {
  name: 'frontier',
  label: 'Frontier',
  schemes: {
    light: {
      bg: '#d6c4a0',
      ink: '#22170d',
      muted: '#4b3925',
      accent: '#8a3812',
      link: '#1f4859',
      ok: '#2e5a1c',
      danger: '#8c1c10',
    },
  },
  terms: { agent: 'Operator', blocked: 'Busted axle' },
  words: { attention: 'Busted axles', agent: 'Wire up the operator', quit: 'Ride out' },
  ornament: 'steam',
};
