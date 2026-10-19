/**
 * The shape of a theme pack's manifest (`theme.json`, #206), apart from the
 * themes themselves, so the server can check a user's theme without loading
 * any stylesheet.
 */

/** The tokens every theme defines for every scheme it offers. */
export const TOKENS = [
  'bg', 'surface', 'raised', 'ink', 'muted', 'line', 'accent', 'accentInk', 'link', 'focus',
  'ok', 'warn', 'danger', 'bannerBg', 'bannerInk',
] as const;
export type Token = (typeof TOKENS)[number];
export type Scheme = 'light' | 'dark';

/**
 * The words a theme may rename. Each is shown with the real word beside it
 * ("Quest (Epic)"), never instead of it (#206).
 */
export const TERMS = ['epic', 'board', 'dependencies', 'sprint', 'agent', 'blocked'] as const;
export type TermKey = (typeof TERMS)[number];

export interface ThemeManifest {
  name: string;
  label: string;
  description: string;
  schemes: Partial<Record<Scheme, Record<Token, string>>>;
  fonts: { body: string; display: string; mono: string };
  radius: string;
  motion: 'none' | 'subtle';
  /** Sound is off by default in every theme (#206); none ships any yet. */
  sounds: Record<string, string>;
  assets: Record<string, string>;
  terms?: Partial<Record<TermKey, string>>;
}
