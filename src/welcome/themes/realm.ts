import type { TerminalTheme } from './types.js';

/** Realm's terminal version (ui/themes/realm/theme.json). The campaign ledger, by day and by candlelight. Rulings on the rules go to a committee of one. */
export const realm: TerminalTheme = {
  name: 'realm',
  label: 'Realm',
  schemes: {
    light: {
      bg: '#cbbd9e',
      ink: '#1a1410',
      muted: '#46392c',
      accent: '#6e1c18',
      link: '#2b3f52',
      ok: '#2b4a22',
      danger: '#7f1a12',
    },
    dark: {
      bg: '#1c1712',
      ink: '#ece1c8',
      muted: '#bdae92',
      accent: '#d4705a',
      link: '#8fb4d4',
      ok: '#8fc47a',
      danger: '#f08a78',
    },
  },
  terms: { agent: 'Dungeon master', blocked: 'Broken road' },
  words: { attention: 'Broken roads', agent: 'Summon the dungeon master', quit: 'Leave the table' },
  ornament: 'embers',
};
