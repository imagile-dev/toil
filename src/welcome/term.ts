/**
 * What the terminal in front of us can do, decided once, from the environment.
 * Everything here is plain ANSI over Node's own TTY streams: no curses, no
 * terminfo, no package. Terminals have been parsing these escape sequences
 * since before most change-approval boards were formed, and with fewer meetings.
 */

export type Rgb = readonly [number, number, number];

/** toil's palette, the same values as the site's tokens. */
export const PALETTE = {
  accent: [255, 106, 61],
  amber: [255, 184, 77],
  ink: [246, 241, 233],
  muted: [180, 169, 152],
  faint: [133, 122, 108],
  bg: [22, 19, 15],
} as const satisfies Record<string, Rgb>;

export interface TermCaps {
  /** 1 (no color), 4 (16 colors), 8 (256) or 24 (truecolor). */
  colorDepth: 1 | 4 | 8 | 24;
  /** Braille and box drawing render as intended; otherwise draw in ASCII. */
  unicode: boolean;
  /** Frames may be redrawn in place. */
  animate: boolean;
  columns: number;
  rows: number;
}

export interface TermLike {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
}

/**
 * Detects capabilities. NO_COLOR, TOIL_NO_ANIMATION, CI, TERM=dumb and a narrow
 * window all mean a still frame. Unicode is assumed except on a Windows
 * console that isn't Windows Terminal or another known modern host, where
 * braille may come out as boxes.
 */
export function detectCaps(out: TermLike, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): TermCaps {
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
  const raw = noColor ? 1 : (out.getColorDepth?.(env) ?? 1);
  const colorDepth = raw >= 24 ? 24 : raw >= 8 ? 8 : raw >= 4 ? 4 : 1;
  const modernWindowsHost = Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON' || env.TERM);
  const unicode = env.TOIL_ASCII ? false : platform !== 'win32' || modernWindowsHost;
  const columns = out.columns ?? 80;
  const rows = out.rows ?? 24;
  const animate =
    out.isTTY === true && !noColor && !env.TOIL_NO_ANIMATION && !env.CI && env.TERM !== 'dumb' && columns >= 40 && rows >= 12;
  return { colorDepth, unicode, animate, columns, rows };
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
  // Warm palette only: bright yellow for amber, bright red for flame, white for ink.
  if (r > 200 && g > 200 && b > 200) return 97;
  if (r > 200 && g > 150) return 93;
  if (r > 200) return 91;
  if (r > 120) return 33;
  return 90;
}

/** Printable width, ignoring escape sequences. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return [...text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')].length;
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
