/**
 * What the terminal in front of us can do, decided once, from the environment.
 * Everything here is plain ANSI over Node's own TTY streams: no curses, no
 * terminfo, no package. Terminals have been parsing these escape sequences
 * since before most change-approval boards were formed, and with fewer meetings.
 */

export type Rgb = readonly [number, number, number];

/**
 * toil's palette, the same values as the site's tokens (Toil UI Plain's dark
 * scheme, #442): the blue accent and its lighter highlight, the neutrals, and
 * ok and danger for a result that worked or didn't.
 */
export const PALETTE = {
  accent: [140, 196, 255],
  highlight: [194, 224, 255],
  ink: [232, 234, 237],
  muted: [167, 175, 186],
  faint: [134, 143, 155],
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
  return { colorDepth, unicode, animate, columns, rows };
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
export function fg(caps: Pick<TermCaps, 'colorDepth'>, [r, g, b]: Rgb): string {
  switch (caps.colorDepth) {
    case 24:
      return `${ESC}38;2;${r};${g};${b}m`;
    case 8:
      return `${ESC}38;5;${to256(r, g, b)}m`;
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

function to256(r: number, g: number, b: number): number {
  const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
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

/** Printable width, ignoring escape sequences. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return [...text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')].length;
}

/**
 * A line cut to `width` printable characters, escape sequences kept, so a
 * narrow window clips the screen instead of wrapping it into a different one.
 */
export function fitLine(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let out = '';
  let shown = 0;
  // eslint-disable-next-line no-control-regex
  for (const part of text.split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith('\x1b[')) {
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
  // eslint-disable-next-line no-control-regex
  const tokens = text.slice(indent.length).split(/(\x1b\[[0-9;?]*[A-Za-z]| +)/).filter(Boolean);
  const lines: string[] = [];
  let line = indent;
  let shown = indent.length;
  let active = '';
  for (const token of tokens) {
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
  const same = (a?: Rgb, b?: Rgb) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
  for (const cell of cells) {
    const color = cell.ch === ' ' ? undefined : cell.color;
    if (!same(color, open)) {
      if (open) out += '\x1b[0m';
      if (color) out += fg(caps, color);
      open = color;
    }
    out += cell.ch;
  }
  if (open && caps.colorDepth > 1) out += '\x1b[0m';
  return out;
}
