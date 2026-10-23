import { mix, type Palette, type Rgb } from '../term.js';
import { crate } from './crate.js';
import { frontier } from './frontier.js';
import { harvest } from './harvest.js';
import { SPLASH_CUES, type SplashCue } from './moments.generated.js';
import { overworld } from './overworld.js';
import { plain } from './plain.js';
import { realm } from './realm.js';
import { sprawl } from './sprawl.js';
import { starship } from './starship.js';
import type { Ornament, SchemeColours, TerminalTheme } from './types.js';

export type { MenuWords, Ornament, SchemeColours, TerminalTheme } from './types.js';
export { ORNAMENTS } from './types.js';

/**
 * The welcome menu's themes (#427): one terminal version of each Toil UI
 * theme, in Toil UI's picker order. `"theme"` in ~/.toil/config.json picks
 * one, `TOIL_THEME` overrides it, and Plain is the default. A theme changes
 * the menu's colours, the splash and a few of its words, and nothing an
 * agent or a script reads: never an envelope, help text, an error or a fix.
 */
export const TERMINAL_THEMES: readonly TerminalTheme[] = [plain, crate, harvest, starship, realm, sprawl, frontier, overworld];

export const DEFAULT_THEME = 'plain';

export const THEME_NAMES: readonly string[] = TERMINAL_THEMES.map((t) => t.name);

/** The theme by name; undefined for a name toil doesn't have. */
export const findTheme = (name: string | undefined): TerminalTheme | undefined => TERMINAL_THEMES.find((t) => t.name === name);

/** The theme by name, or Plain for anything toil doesn't have. */
export const themeNamed = (name: string | undefined): TerminalTheme => findTheme(name) ?? plain;

/** What the splash takes from a theme: what it draws around the badge, how the badge arrives, and its line. */
export interface SplashLook {
  ornament: Ornament;
  /** How the badge arrives: a one-shot motif from the theme's `moments.splash` (Toil UI's #419). */
  motif: 'fade' | 'rise' | 'drop' | 'pop' | 'slide';
  /** The theme's splash line, shown under the tagline in place of the plain one. */
  line?: string;
}

/**
 * The terminal's rendition of a #419 enter motif. The braille badge can fade,
 * move or scale; a stamp, a grow and a sweep read as a pop, a pop and a fade
 * at sixteen lines tall.
 */
const MOTIF: Record<string, SplashLook['motif']> = { fade: 'fade', rise: 'rise', drop: 'drop', pop: 'pop', slide: 'slide', stamp: 'pop', grow: 'pop', sweep: 'fade' };

/** The splash for a theme, its cues read from the theme's own `moments.splash` (generated from theme.json at build time). */
export function splashLook(theme: TerminalTheme): SplashLook {
  const cue: SplashCue | undefined = SPLASH_CUES[theme.name];
  return { ornament: theme.ornament, motif: MOTIF[cue?.motif ?? 'fade'] ?? 'fade', ...(cue?.line ? { line: cue.line } : {}) };
}

export const terminalMotif = (motif: string): SplashLook['motif'] | undefined => MOTIF[motif];


export type Background = 'light' | 'dark';

export const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG's contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const hi = Math.max(R, G, B);
  const lo = Math.min(R, G, B);
  const l = (hi + lo) / 2;
  if (hi === lo) return [0, 0, l];
  const d = hi - lo;
  const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
  const h = hi === R ? ((G - B) / d + (G < B ? 6 : 0)) / 6 : hi === G ? ((B - R) / d + 2) / 6 : ((R - G) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}

/** The bar every role but bg meets on its scheme's background: WCAG AA for text. */
export const MIN_CONTRAST = 4.5;

/** A colour moved lighter or darker, keeping its hue, until it reaches `ratio` on `bg`. */
export function readable(color: Rgb, bg: Rgb, ratio = MIN_CONTRAST): Rgb {
  if (contrast(color, bg) >= ratio) return color;
  const [h, s, l] = toHsl(color);
  const lighter = luminance(bg) < 0.18;
  for (let step = 1; step <= 50; step++) {
    const next = fromHsl([h, s, Math.max(0, Math.min(1, l + (lighter ? step : -step) * 0.02))]);
    if (contrast(next, bg) >= ratio) return next;
  }
  return lighter ? [255, 255, 255] : [0, 0, 0];
}

/** The background a derived scheme is checked against: near-black for dark, white for light. */
const DERIVED_BG: Record<Background, string> = { dark: '#121417', light: '#ffffff' };

/**
 * A scheme for a terminal of the kind the theme doesn't have: each colour's
 * lightness turned over (dark ink becomes light ink, a deep red accent a pale
 * one), keeping its hue, on a plain background of that kind. `palette()` then
 * lifts anything still short of the bar.
 */
export function deriveScheme(from: SchemeColours, to: Background): SchemeColours {
  const flip = (hex: string) => {
    const [h, s, l] = toHsl(hexToRgb(hex));
    return rgbToHex(fromHsl([h, s, 1 - l]));
  };
  return {
    bg: DERIVED_BG[to],
    ink: flip(from.ink),
    muted: flip(from.muted),
    accent: flip(from.accent),
    link: flip(from.link),
    ok: flip(from.ok),
    danger: flip(from.danger),
    ...(from.highlight ? { highlight: flip(from.highlight) } : {}),
  };
}

export const rgbToHex = (rgb: Rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** The scheme a terminal of this background shows: the theme's own, else one derived from the scheme it has. */
export function schemeFor(theme: TerminalTheme, background: Background): SchemeColours {
  const own = theme.schemes[background];
  if (own) return own;
  const other = theme.schemes[background === 'dark' ? 'light' : 'dark'];
  if (!other) throw new Error(`The ${theme.name} terminal theme has no colours.`);
  return deriveScheme(other, background);
}

/**
 * A theme's palette for a terminal of this background. Highlight is the
 * theme's link colour, or, where the link is the accent, a lighter (or on a
 * light terminal, deeper) tint of the accent; faint is muted mixed toward the
 * background. Every role meets MIN_CONTRAST on the scheme's background, so
 * the menu reads on a light terminal and a dark one alike.
 */
export function palette(theme: TerminalTheme, background: Background): Palette {
  const s = schemeFor(theme, background);
  const bg = hexToRgb(s.bg);
  const accent = hexToRgb(s.accent);
  const ink = hexToRgb(s.ink);
  const muted = hexToRgb(s.muted);
  const link = hexToRgb(s.link);
  const highlight = s.highlight ? hexToRgb(s.highlight) : s.link.toLowerCase() === s.accent.toLowerCase() ? mix(accent, ink, 0.45) : link;
  const faint = s.faint ? hexToRgb(s.faint) : mix(muted, bg, 0.25);
  const lift = (c: Rgb) => readable(c, bg);
  return { accent: lift(accent), highlight: lift(highlight), ink: lift(ink), muted: lift(muted), faint: lift(faint), bg, ok: lift(hexToRgb(s.ok)), danger: lift(hexToRgb(s.danger)) };
}
