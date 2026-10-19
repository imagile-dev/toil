/**
 * The active theme, for the words a theme renames. Kept apart from the skin
 * registry so a skin can read it without importing the registry that imports
 * the skin.
 */

import { createContext, useContext } from 'react';
import { THEMES, type TermKey, type ThemeManifest } from './themes.ts';

const ThemeContext = createContext<ThemeManifest>(THEMES[0]!);
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

/**
 * A theme's own word for something, always with the real one beside it
 * (#206, principle 4): Realm's epic reads "Quest (Epic)", and Plain, which
 * renames nothing, reads "Epic".
 */
export function themed(theme: ThemeManifest, key: TermKey, real: string): string {
  const word = theme.terms?.[key];
  return word && word.toLowerCase() !== real.toLowerCase() ? `${word} (${real})` : real;
}

export function useTerm(): (key: TermKey, real: string) => string {
  const theme = useTheme();
  return (key, real) => themed(theme, key, real);
}
