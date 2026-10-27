/**
 * What the terminal in front of us can do, decided once, from the environment.
 * Everything here is plain ANSI over Node's own TTY streams: no curses, no
 * terminfo, no package. Terminals have been parsing these escape sequences
 * since before most change-approval boards were formed, and with fewer meetings.
 */

export type Rgb = readonly [number, number, number];

/**
 * toil's own palette, Toil UI Plain's dark scheme, which the site wears too
 * (#442): the blue accent and its lighter highlight, the neutrals, dim (the
 * game's remembered map, faint mixed toward bg and held to 3:1), and ok and
 * danger for a result that worked or didn't. A frame given no theme draws in
 * it, as tests and the site's recording of the menu do. The menu and its game
 * draw in the theme's palette, Crate's by default (#467, #471), whose faint is
 * lifted for lighter dark terminals, so it's a little lighter than this one's.
 */
export const PALETTE = {
  accent: [140, 196, 255],
  highlight: [194, 224, 255],
  ink: [232, 234, 237],
  muted: [167, 175, 186],
  faint: [134, 143, 155],
  dim: [94, 101, 112],
  bg: [15, 17, 21],
  ok: [111, 211, 148],
  danger: [255, 138, 128],
} as const satisfies Record<string, Rgb>;

/** The colour roles every theme's terminal palette fills (src/welcome/themes/). */
export type Palette = Record<keyof typeof PALETTE, Rgb>;

/**
 * The palette a frame is drawn in: the theme's, carried on the caps, or toil's
 * own (Plain's dark scheme) where none was given, as in most tests.
 */
export function pal(caps: object): Palette {
  return (caps as { palette?: Palette }).palette ?? PALETTE;
}

export interface TermCaps {
  /** 1 (no color), 4 (16 colors), 8 (256) or 24 (truecolor). */
  colorDepth: 1 | 4 | 8 | 24;
  /** Braille and box drawing render as intended; otherwise draw in ASCII. */
  unicode: boolean;
  /** Frames may be redrawn in place. */
  animate: boolean;
  columns: number;
  rows: number;
  /** The theme's colours for this terminal's background (src/welcome/themes/); toil's own when absent. */
  palette?: Palette;
  /** It draws OSC 8 hyperlinks, so a key can open its ticket; otherwise the URL is printed beside it. */
  hyperlinks?: boolean;
}

export interface TermLike {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
}

/** Reduced motion: TOIL_REDUCED_MOTION, or TOIL_NO_ANIMATION, its older name. The splash is then drawn once. */
export function reducedMotion(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TOIL_REDUCED_MOTION || env.TOIL_NO_ANIMATION);
}

/**
 * Detects capabilities. NO_COLOR, reduced motion, CI, TERM=dumb and a narrow
 * window all mean a still frame. Unicode is assumed except on a Windows
 * console that isn't Windows Terminal or another known modern host, where
 * braille may come out as boxes. That legacy console host also gets the still
 * frame, because redrawing in place is the one thing it can't be trusted with.
 */
export function detectCaps(out: TermLike, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): TermCaps {
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
  const raw = noColor ? 1 : (out.getColorDepth?.(env) ?? 1);
  const colorDepth = raw >= 24 ? 24 : raw >= 8 ? 8 : raw >= 4 ? 4 : 1;
  const modernHost = isModernHost(env, platform);
  const unicode = env.TOIL_ASCII ? false : modernHost;
  const columns = out.columns ?? 80;
  const rows = out.rows ?? 24;
  const animate =
    out.isTTY === true && modernHost && !noColor && !reducedMotion(env) && !env.CI && env.TERM !== 'dumb' && columns >= 40 && rows >= 12;
  return { colorDepth, unicode, animate, columns, rows, hyperlinks: out.isTTY === true && drawsHyperlinks(env) };
}

/**
 * Terminals known to draw OSC 8 hyperlinks: Windows Terminal, VS Code's,
 * iTerm2, WezTerm, Ghostty, and VTE's (GNOME Terminal and its kin) from 0.50.
 * Any other gets the URL printed instead, since an unknown one may print the
 * escape as text.
 */
export function drawsHyperlinks(env: NodeJS.ProcessEnv): boolean {
  if (env.TERM === 'dumb') return false;
  return Boolean(env.WT_SESSION) || ['vscode', 'iTerm.app', 'WezTerm', 'ghostty'].includes(env.TERM_PROGRAM ?? '') || Number(env.VTE_VERSION) >= 5000;
}

/** Anything but the legacy Windows console host, which can't be trusted to redraw in place or draw braille. */
export function isModernHost(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32' || Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON' || env.TERM);
}

/**
 * Whether a frame may be redrawn in place, whatever anyone thinks of
 * animation: a TTY on a modern host that isn't TERM=dumb. The game needs
 * this; NO_COLOR and TOIL_NO_ANIMATION only change how it looks.
 */
export function movesCursor(out: TermLike, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  return out.isTTY === true && isModernHost(env, platform) && env.TERM !== 'dumb';
}

const ESC = '\x1b[';

/** Foreground color at whatever depth the terminal supports; '' with no color. */
export function fg(caps: Pick<TermCaps, 'colorDepth'> & Partial<Pick<TermCaps, 'palette'>>, [r, g, b]: Rgb): string {
  switch (caps.colorDepth) {
    case 24:
      return `${ESC}38;2;${r};${g};${b}m`;
    case 8:
      return `${ESC}38;5;${to256([r, g, b], pal(caps).bg)}m`;
    case 4:
      return `${ESC}${to16(r, g, b)}m`;
    default:
      return '';
  }
}

export function style(caps: Pick<TermCaps, 'colorDepth'>, code: 'bold' | 'dim' | 'reset'): string {
  if (caps.colorDepth === 1) return '';
  return `${ESC}${code === 'bold' ? 1 : code === 'dim' ? 2 : 0}m`;
}

/** Paint text in a color, resetting after. */
export function paint(caps: Pick<TermCaps, 'colorDepth'>, color: Rgb, text: string): string {
  const open = fg(caps, color);
  return open ? `${open}${text}${ESC}0m` : text;
}

/** A color between two others, t in 0..1. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

/**
 * A colour between two others mixed in linear light, t in 0..1, so its
 * luminance lies between theirs: a blend of two colours that both read on a
 * background reads on it too, where `mix`, in sRGB, can dip below both (#471).
 */
export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  const one = (i: 0 | 1 | 2) => {
    const x = toLinear(a[i]);
    return toSrgb(x + (toLinear(b[i]) - x) * k);
  };
  const out: Rgb = [one(0), one(1), one(2)];
  // Rounding to whole channels can carry it a hair past both; then the nearer of the two stands in.
  const [la, lb, lo] = [lum(a), lum(b), lum(out)];
  return lo < Math.min(la, lb) || lo > Math.max(la, lb) ? (k < 0.5 ? a : b) : out;
}

const lum = ([r, g, b]: Rgb) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/**
 * The contrast on its background above which a colour may round toward the
 * background. 7.5:1 on any theme's background, black included, still leaves
 * 4.5:1 on the common ground of its kind (LIGHT_GROUND, DARK_GROUND in
 * themes/), so a colour well clear of the bar keeps its hue rather than
 * drifting to the one corner that lies further out (Crate's blue highlight to
 * cyan on a dark terminal).
 */
const ROUNDING_SLACK = 7.5;

/** The six levels of each channel in the 256-colour cube. */
const CUBE = [0, 95, 135, 175, 215, 255];

/** A colour in OKLab, where distance follows what the eye sees: a green is nearer another green than a grey of its lightness. */
function oklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Every colour from 16 up: the cube, then the 24 greys, measured once. */
const XTERM = Array.from({ length: 240 }, (_, i) => {
  const color: Rgb = i < 216 ? [CUBE[Math.floor(i / 36)]!, CUBE[Math.floor(i / 6) % 6]!, CUBE[i % 6]!] : [8 + 10 * (i - 216), 8 + 10 * (i - 216), 8 + 10 * (i - 216)];
  return { index: 16 + i, color, lum: lum(color), lab: oklab(color) };
});

/** Rounded colours, by colour and background: a frame asks for the same few hundreds of times. */
const ROUNDED = new Map<string, number>();

/**
 * The 256-colour palette's nearest colour to this one by eye (OKLab), rounded
 * away from the background: the closest that is no nearer the background in
 * luminance, or that keeps ROUNDING_SLACK on it. Plain rounding to the nearest
 * can land on a lighter colour on a light terminal (Overworld's faint went
 * from 4.6:1 to 3.8:1), and macOS Terminal draws 256 colours on white by
 * default. Rounded this way, a colour that clears the bar in truecolour clears
 * it here too, and keeps its hue where the palette has one dark (or light)
 * enough, and losing colour costs extra: a green stays green, a grey stays grey. Nobody's brand guidelines
 * were consulted, only their luminance.
 */
function to256(rgb: Rgb, bg: Rgb): number {
  const key = `${rgb.join(',')}/${bg.join(',')}`;
  const known = ROUNDED.get(key);
  if (known !== undefined) return known;
  const [own, ground] = [lum(rgb), lum(bg)];
  const darker = ground > own;
  const ratio = (l: number) => (Math.max(l, ground) + 0.05) / (Math.min(l, ground) + 0.05);
  const [L, A, B] = oklab(rgb);
  const chroma = Math.hypot(A, B);
  let best = { index: 16, distance: Infinity };
  for (const c of XTERM) {
    if ((darker ? c.lum > own : c.lum < own) && ratio(c.lum) < ROUNDING_SLACK) continue;
    // Lightness counts half, since the filter above already looks after contrast, and colour lost counts
    // twice: a green heading is better as a darker green than as an olive or a grey of its lightness.
    const faded = Math.max(0, chroma - Math.hypot(c.lab[1], c.lab[2]));
    const distance = ((c.lab[0] - L) / 2) ** 2 + (c.lab[1] - A) ** 2 + (c.lab[2] - B) ** 2 + faded ** 2;
    if (distance < best.distance) best = { index: c.index, distance };
  }
  // Black (or white) is always no nearer the background, so something always qualifies.
  ROUNDED.set(key, best.index);
  return best.index;
}

function to16(r: number, g: number, b: number): number {
  // The nearest of the sixteen by hue: bright for a light colour (a palette
  // for a dark terminal), normal for a dark one (a palette for a light
  // terminal), and greys by how light they are. The older console host has
  // nothing else, and every theme still reads there.
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi - lo < 40) return hi > 200 ? 97 : hi > 160 ? 37 : hi > 60 ? 90 : 30;
  const d = hi - lo;
  const hue = (hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  // red 1, green 2, yellow 3, blue 4, magenta 5, cyan 6
  let base = hue < 20 || hue >= 330 ? 1 : hue < 70 ? 3 : hue < 160 ? 2 : hue < 195 ? 6 : hue < 265 ? 4 : 5;
  if (base === 4 && g > 210) base = 6;
  return ((hi + lo) / 2 >= 128 ? 90 : 30) + base;
}

/**
 * The escape sequences a line may hold, each taking no width: colours (CSI)
 * and terminal hyperlinks (OSC 8, opened and closed around a link's text),
 * kept whole so a cut never leaves one half-written.
 */
// eslint-disable-next-line no-control-regex
const ESCAPES = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\]8;[^\x1b]*\x1b\\)/;
// eslint-disable-next-line no-control-regex
const WRAP_TOKENS = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\]8;[^\x1b]*\x1b\\| +)/;

/** Printable width, ignoring escape sequences. */
export function visibleLength(text: string): number {
  return [...text.replace(new RegExp(ESCAPES.source, 'g'), '')].length;
}

/**
 * A line cut to `width` printable characters, escape sequences kept, so a
 * narrow window clips the screen instead of wrapping it into a different one.
 */
export function fitLine(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let out = '';
  let shown = 0;
  for (const part of text.split(ESCAPES)) {
    if (part.startsWith('\x1b')) {
      out += part;
      continue;
    }
    const chars = [...part];
    const room = Math.max(0, width - shown);
    out += chars.slice(0, room).join('');
    shown += Math.min(room, chars.length);
  }
  return out.includes('\x1b[') ? `${out}\x1b[0m` : out;
}

/**
 * A line wrapped at spaces to `width` printable characters, keeping its
 * indent and carrying an open colour onto the lines it continues on. A word
 * longer than the width is left for fitLine to cut.
 */
export function wrapLine(text: string, width: number): string[] {
  if (visibleLength(text) <= width) return [text];
  const indent = /^ */.exec(text)![0];
  const tokens = text.slice(indent.length).split(WRAP_TOKENS).filter(Boolean);
  const lines: string[] = [];
  let line = indent;
  let shown = indent.length;
  let active = '';
  for (const token of tokens) {
    if (token.startsWith('\x1b]')) {
      line += token;
      continue;
    }
    if (token.startsWith('\x1b[')) {
      line += token;
      active = token === '\x1b[0m' ? '' : token;
      continue;
    }
    const length = [...token].length;
    if (token.startsWith(' ')) {
      if (shown + length < width) {
        line += token;
        shown += length;
      } else if (shown > indent.length) {
        // No room for the space: break here, or the next word would be glued to this one.
        lines.push(active ? `${line.trimEnd()}\x1b[0m` : line.trimEnd());
        line = `${indent}${active}`;
        shown = indent.length;
      }
      continue;
    }
    if (shown + length > width && shown > indent.length) {
      lines.push(active ? `${line.trimEnd()}\x1b[0m` : line.trimEnd());
      line = `${indent}${active}`;
      shown = indent.length;
    }
    line += token;
    shown += length;
  }
  lines.push(line);
  return lines;
}

export const cursor = {
  hide: `${ESC}?25l`,
  show: `${ESC}?25h`,
  up: (n: number) => (n > 0 ? `${ESC}${n}A` : ''),
  col1: '\r',
  clearLine: `${ESC}2K`,
  clearDown: `${ESC}0J`,
  altScreenOn: `${ESC}?1049h`,
  altScreenOff: `${ESC}?1049l`,
  home: `${ESC}H`,
};

/** One character cell: what it shows, and in what color (none for blank or uncolored). */
export interface Cell {
  ch: string;
  color?: Rgb;
  /** Drawn bold at 256 colours and up, as the game's player is, so it stands out from walls of nearly the same ink on a light terminal. */
  bold?: boolean;
}

export const blank = (width: number): Cell[] => Array.from({ length: width }, () => ({ ch: ' ' }));

/** Text as cells, all in one color. */
export function textCells(text: string, color?: Rgb): Cell[] {
  return [...text].map((ch) => (color ? { ch, color } : { ch }));
}

/** Cells to a line, opening a color only when it changes, so a frame stays small. */
export function renderCells(cells: Cell[], caps: Pick<TermCaps, 'colorDepth'>): string {
  if (caps.colorDepth === 1) return cells.map((c) => c.ch).join('');
  let out = '';
  let open: Rgb | undefined;
  let heavy = false;
  const same = (a?: Rgb, b?: Rgb) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
  for (const cell of cells) {
    const color = cell.ch === ' ' ? undefined : cell.color;
    // Not at 16 colours: many terminals draw bold black as bright black, the walls' own grey there.
    const bold = !!color && cell.bold === true && caps.colorDepth >= 8;
    if (!same(color, open) || bold !== heavy) {
      if (open) out += '\x1b[0m';
      if (bold) out += '\x1b[1m';
      if (color) out += fg(caps, color);
      open = color;
      heavy = bold;
    }
    out += cell.ch;
  }
  if (open && caps.colorDepth > 1) out += '\x1b[0m';
  return out;
}
