import type { TerminalTheme } from './types.js';

/** Realm's terminal version (ui/themes/realm/theme.json). The campaign ledger. Rulings on the rules go to a committee of one. */
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
  },
  terms: { agent: 'Dungeon master', blocked: 'Broken road' },
  words: { attention: 'Broken roads', agent: 'Summon the dungeon master', quit: 'Leave the table' },
  ornament: 'embers',
};
