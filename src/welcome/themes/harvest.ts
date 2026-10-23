import type { TerminalTheme } from './types.js';

/** Harvest's terminal version (ui/themes/harvest/theme.json). Seasonal staffing, approved one growing cycle at a time. */
export const harvest: TerminalTheme = {
  name: 'harvest',
  label: 'Harvest',
  schemes: {
    light: {
      bg: '#efe3c2',
      ink: '#2b1a0e',
      muted: '#5c3f24',
      accent: '#2f6b1f',
      link: '#8a3410',
      ok: '#2c6a1c',
      danger: '#a3200f',
    },
  },
  terms: { agent: 'Almanac' },
  words: { attention: 'Weeds in the rows', agent: 'Open the almanac', quit: 'Head back to the farmhouse' },
  ornament: 'crops',
};
