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
import { DEFAULT_THEME } from '../../theme/default.js';

export type { MenuWords, Ornament, SchemeColours, TerminalTheme } from './types.js';
export { ORNAMENTS } from './types.js';

/**
 * The welcome menu's themes (#427): one terminal version of each Toil UI
 * theme, in Toil UI's picker order. `"theme"` in ~/.toil/config.json picks
 * one, `TOIL_THEME` overrides it, and Crate is the default (#467), the same
 * constant Toil UI reads (src/theme/default.ts). A theme changes
 * the menu's colours, the splash and a few of its words, and nothing an
 * agent or a script reads: never an envelope, help text, an error or a fix.
 */
export const TERMINAL_THEMES: readonly TerminalTheme[] = [plain, crate, harvest, starship, realm, sprawl, frontier, overworld];

export { DEFAULT_THEME };

export const THEME_NAMES: readonly string[] = TERMINAL_THEMES.map((t) => t.name);

/** The theme by name; undefined for a name toil doesn't have. */
export const findTheme = (name: string | undefined): TerminalTheme | undefined => TERMINAL_THEMES.find((t) => t.name === name);

/** The theme by name, or the default (Crate) for anything toil doesn't have. */
export const themeNamed = (name: string | undefined): TerminalTheme => findTheme(name) ?? findTheme(DEFAULT_THEME)!;

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
 * The least lightness (HSL) a derived light scheme gives its colours, as
 * opposed to its greys. A dark theme's colours are pale tints, and a pale
 * tint turned over lands next to black: Crate's #c2e0ff became #001e3d, so on
 * a light terminal its headings, the game's items, stairs and staff, and the
 * morale bar all read as body text. Kept between this and the middle, they
 * stay blue, red and green, and still clear the bar.
 */
export const LIGHT_HUE_FLOOR = 0.3;

/**
 * A scheme for a terminal of the kind the theme doesn't have: each colour's
 * lightness turned over (dark ink becomes light ink, a deep red accent a pale
 * one), keeping its hue, on a plain background of that kind. On a light
 * terminal the colours (not ink or muted) are then squeezed up into
 * LIGHT_HUE_FLOOR to the middle, keeping their order, so they stay colours.
 * `palette()` then lifts anything still short of the bar.
 */
export function deriveScheme(from: SchemeColours, to: Background): SchemeColours {
  const flip = (hex: string, hue = false) => {
    const [h, s, l] = toHsl(hexToRgb(hex));
    const turned = 1 - l;
    const kept = hue && to === 'light' && turned < 0.5 ? LIGHT_HUE_FLOOR + turned * (1 - 2 * LIGHT_HUE_FLOOR) : turned;
    return rgbToHex(fromHsl([h, s, kept]));
  };
  return {
    bg: DERIVED_BG[to],
    ink: flip(from.ink),
    muted: flip(from.muted),
    accent: flip(from.accent, true),
    link: flip(from.link, true),
    ok: flip(from.ok, true),
    danger: flip(from.danger, true),
    ...(from.highlight ? { highlight: flip(from.highlight, true) } : {}),
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
 * The light ground every role is lifted against on a light terminal, as well
 * as the scheme's own: Solarized Light's cream (#467). The menu draws on the
 * terminal's own background, which toil knows only as light or dark, and a
 * light terminal is often off-white (One Half Light is #fafafa), so a colour
 * at exactly 4.5:1 on white falls short there. Lifted against the darkest
 * common light ground, it clears the bar on that ground and on everything
 * lighter. Four-and-a-half to one, on any paper the office has in stock.
 */
export const LIGHT_GROUND = '#fdf6e3';

/**
 * The dark ground every role is lifted against on a dark terminal, for the
 * same reason (#471): Nord's #2e3440, the lightest of the common dark
 * schemes (One Half Dark's #282c34, Solarized Dark's #002b36, VS Code's
 * #1e1e1e, black). A colour lighter than the ground reads at least as well on
 * every darker one, so lifted against this it clears the bar on all of them.
 */
export const DARK_GROUND = '#2e3440';

/**
 * The contrast the game's remembered map takes (#471): squares seen before
 * and out of sight now. They're a drawing, the fog of war, not text, so they
 * meet WCAG's 3:1 for graphics and stay dimmer than the lit map beside them.
 */
export const DIM_CONTRAST = 3;

/** How far dim is mixed from faint toward the background, before it's lifted to DIM_CONTRAST. */
export const DIM_MIX = 0.45;

/** The ground a role is lifted against: the scheme's own, or the common ground of its kind that's harder to read on. */
function groundFor(background: Background, bg: Rgb): Rgb {
  const common = hexToRgb(background === 'light' ? LIGHT_GROUND : DARK_GROUND);
  const harder = background === 'light' ? luminance(common) < luminance(bg) : luminance(common) > luminance(bg);
  return harder ? common : bg;
}

/**
 * A theme's palette for a terminal of this background. Highlight is the
 * theme's link colour, or, where the link is the accent, a lighter (or on a
 * light terminal, deeper) tint of the accent; faint is muted mixed toward the
 * background; dim, the game's remembered map, is faint mixed further toward
 * it. Every role but dim meets MIN_CONTRAST on the scheme's background and on
 * the common ground of its kind (LIGHT_GROUND or DARK_GROUND), and dim meets
 * DIM_CONTRAST there, so the menu and the game read on a light terminal, a
 * near-black one and a lighter dark one alike.
 */
export function palette(theme: TerminalTheme, background: Background): Palette {
  const s = schemeFor(theme, background);
  const bg = hexToRgb(s.bg);
  const accent = hexToRgb(s.accent);
  const ink = hexToRgb(s.ink);
  const muted = hexToRgb(s.muted);
  const link = hexToRgb(s.link);
  const highlight = s.highlight ? hexToRgb(s.highlight) : s.link.toLowerCase() === s.accent.toLowerCase() ? mix(accent, ink, 0.45) : link;
  const ground = groundFor(background, bg);
  const lift = (c: Rgb) => readable(c, ground);
  const faint = lift(s.faint ? hexToRgb(s.faint) : mix(muted, bg, 0.25));
  return {
    accent: lift(accent),
    highlight: lift(highlight),
    ink: lift(ink),
    muted: lift(muted),
    faint,
    dim: readable(mix(faint, bg, DIM_MIX), ground, DIM_CONTRAST),
    bg,
    ok: lift(hexToRgb(s.ok)),
    danger: lift(hexToRgb(s.danger)),
  };
}
