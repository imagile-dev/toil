/**
 * The shape of a terminal theme: the welcome menu's version of one Toil UI
 * theme (ui/themes/<name>/theme.json). Toil can't depend on Toil UI, so each
 * theme's terminal version is written here, and test/theme-sync.test.ts holds
 * its name, label, colours, words and splash cues to the theme's own file.
 * Interdepartmental alignment, enforced by a test rather than a steering group.
 */

/** A scheme's colours, copied from the theme's `schemes.<light|dark>` in theme.json, as hex. */
export interface SchemeColours {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  link: string;
  ok: string;
  danger: string;
  /** Headings and values. The theme's `link` unless it says otherwise; Plain's dark takes the site's highlight token. */
  highlight?: string;
  /** Hints and key lines. Mixed from muted toward bg unless the theme says otherwise; Plain's dark takes the site's faint token. */
  faint?: string;
}

/**
 * What the splash draws around the badge, by the theme's particles in Toil UI
 * (`ambient.particles`): the ring of tool dots, crops growing, a jump to warp,
 * embers, rain, steam or fairies. Each is one short animation that settles on
 * a still, never an ambient effect that keeps moving.
 */
export const ORNAMENTS = ['orbit', 'crops', 'warp', 'embers', 'rain', 'steam', 'fairies'] as const;
export type Ornament = (typeof ORNAMENTS)[number];

/**
 * The menu's own words that a theme may change: a heading and two short
 * labels, never a word that names a toil command, a field or a result.
 */
export interface MenuWords {
  /** The home screen's heading over the rows that need attention. The plain words follow it when they differ. */
  attention: string;
  /** The home row that opens Connect an agent. When it differs from the plain one, its hint says what it is. */
  agent: string;
  /** The Quit row's hint. */
  quit: string;
}

/** Toil UI's renamed words (`terms` in theme.json) that the menu's words use. */
export type TermKey = 'agent' | 'blocked';

export interface TerminalTheme {
  /** The theme's folder under ui/themes/, and what `toil theme set` takes. */
  name: string;
  label: string;
  /** Every scheme theme.json has, with the same colours. A terminal of the other kind gets one derived from it. */
  schemes: { light?: SchemeColours; dark?: SchemeColours };
  /** Copies of theme.json's `terms` for the words that use them, so a word can't drift from the theme. */
  terms: Partial<Record<TermKey, string>>;
  words: MenuWords;
  ornament: Ornament;
}
