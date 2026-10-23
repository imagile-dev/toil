import type { TerminalTheme } from './types.js';

/** Crate's terminal version (ui/themes/crate/theme.json). Signed for in triplicate; the third copy is filed under 'probably fine'. */
export const crate: TerminalTheme = {
  name: 'crate',
  label: 'Crate',
  schemes: {
    dark: {
      bg: '#16130f',
      ink: '#f6f1e9',
      muted: '#b4a998',
      accent: '#ff6a3d',
      link: '#ffb84d',
      ok: '#ffb84d',
      danger: '#ff6a3d',
    },
  },
  terms: {},
  words: { attention: 'Stuck in the aisle', agent: 'Put an agent on the dock', quit: 'Clock out' },
  ornament: 'orbit',
};
