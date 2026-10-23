import type { TerminalTheme } from './types.js';

/** Plain's terminal version (ui/themes/plain/theme.json). The control group. Every study needs one, and this one never asks for a budget. */
export const plain: TerminalTheme = {
  name: 'plain',
  label: 'Plain',
  schemes: {
    light: {
      bg: '#ffffff',
      ink: '#1b1f24',
      muted: '#4f5863',
      accent: '#0b5cad',
      link: '#0b5cad',
      ok: '#116329',
      danger: '#b42318',
    },
    dark: {
      bg: '#0f1115',
      ink: '#e8eaed',
      muted: '#a7afba',
      accent: '#8cc4ff',
      link: '#8cc4ff',
      ok: '#6fd394',
      danger: '#ff8a80',
      // The site's highlight and faint tokens (site/src/styles/global.css), which test/brand-sync.test.ts holds the terminal to.
      highlight: '#c2e0ff',
      faint: '#868f9b',
    },
  },
  terms: {},
  words: { attention: 'Needs attention', agent: 'Connect an agent', quit: 'Back to your shell' },
  ornament: 'orbit',
};
