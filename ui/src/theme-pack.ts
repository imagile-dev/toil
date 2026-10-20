/**
 * The shape of a theme pack's manifest (`theme.json`, #206), apart from the
 * themes themselves, so the server can read a theme's voice without loading
 * any stylesheet.
 * The standard form for colours, in triplicate per scheme.
 */

import type { WordKey } from './wording.ts';

/** The tokens every theme defines for every scheme it offers. */
export const TOKENS = [
  'bg', 'surface', 'raised', 'ink', 'muted', 'line', 'accent', 'accentInk', 'link', 'focus',
  'ok', 'warn', 'danger', 'bannerBg', 'bannerInk',
] as const;
export type Token = (typeof TOKENS)[number];
export type Scheme = 'light' | 'dark';

/**
 * The words a theme may rename. Each is shown with the real word beside it
 * ("Campaign (Epic)"), never instead of it (#206).
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
  /**
   * The theme's ambient effects (#348), so Settings knows what its particle
   * switch controls: `particles` names a preset in src/ambient/presets.ts. A
   * theme without it has no particles and no switch. Plain has none.
   */
  ambient?: { particles?: string };
  /** Sound is off by default in every theme (#206); none ships any yet. */
  sounds: Record<string, string>;
  assets: Record<string, string>;
  terms?: Partial<Record<TermKey, string>>;
  /** Themed wording (#283): the theme's own microcopy, by key, over the standard text in src/wording.ts. */
  lexicon?: Partial<Record<WordKey, string>>;
  /** Themed agent voice (#283): the register the agent answers in, added to its prompt as style. Plain has none. */
  voice?: string;
}
