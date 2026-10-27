import type { TerminalTheme } from './types.js';

/** Frontier's terminal version (ui/themes/frontier/theme.json). Territory claimed by memo, surveyed by a second memo, and re-surveyed after dark by lamplight. */
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
    dark: {
      bg: '#15181f',
      ink: '#f1e4c6',
      muted: '#cdb998',
      accent: '#e2a23f',
      link: '#8ec3d6',
      ok: '#8cc46a',
      danger: '#f08a72',
    },
  },
  terms: { agent: 'Operator', blocked: 'Busted axle' },
  words: { attention: 'Busted axles', agent: 'Wire up the operator', quit: 'Ride out' },
  ornament: 'steam',
};
