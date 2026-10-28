import type { TerminalTheme } from './types.js';

/** Starship's terminal version (ui/themes/starship/theme.json). Bridge crew only, lights up or down. The rest of the org chart is somewhere aft. */
export const starship: TerminalTheme = {
  name: 'starship',
  label: 'Starship',
  schemes: {
    dark: {
      bg: '#05070f',
      ink: '#e6f1ff',
      muted: '#9fb4cd',
      accent: '#36d6ff',
      link: '#7fe3ff',
      ok: '#5df2a6',
      danger: '#ff7a8e',
    },
    light: {
      bg: '#eaf1f9',
      ink: '#0a1a2e',
      muted: '#3d566f',
      accent: '#00708f',
      link: '#00607f',
      ok: '#0b7a46',
      danger: '#b3213d',
    },
  },
  terms: { agent: "Ship's computer", blocked: 'Hazard' },
  words: { attention: 'Hazards', agent: "Link the ship's computer", quit: 'Leave the bridge' },
  ornament: 'warp',
};
