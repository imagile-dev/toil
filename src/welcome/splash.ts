import { BLINKS, DURATION, logoCells, PLAIN_LOOK, SPIN } from './logo.js';
import { blank, type Cell, cursor, mix, pal, renderCells, textCells, type TermCaps } from './term.js';
import type { SplashLook } from './themes/index.js';
import { WORDMARK } from './wordmark.js';

/**
 * The splash: the logo on the left, the wordmark and the tagline on the right.
 * Each frame is built from cells by a pure function of time, and `playSplash`
 * only decides how often to ask for one. Any key skips to the end, because the
 * second time you see an animation it's no longer an animation, it's a queue.
 */

export const TAGLINE = 'Let your agents handle the toil.';

/** The line under the tagline in Plain, and in any theme whose moments give no splash line of its own. */
export const PLAIN_LINE = 'Enterprise tools and databases.';

/**
 * How fast the timeline plays: 1.25 timeline seconds per real second. The
 * timeline (logo.ts) stays in round numbers; this is the one dial for pace.
 */
export const SPEED = 1.25;

/** The wordmark's pixels (src/welcome/wordmark.ts, generated from Fredoka 600). */
const WORD = WORDMARK;
/** Lines the word itself takes: two pixel rows per line. */
const WORD_LINES = WORD.length / 2;
/** Columns the word takes: two pixels per column. */
const WORD_COLS = WORD[0]!.length / 2;
/** The word, its one-cell shadow, a space and the two-cell cursor. */
const WORDMARK_WIDTH = WORD_COLS + 1 + 1 + 2;
const LOGO_WIDTH = 32;
const GAP = 3;
/** A blank line above the wordmark, so the text column sits centred beside the 16-line logo. */
const LEAD = 1;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

type Caps = Pick<TermCaps, 'colorDepth' | 'unicode'>;

/** Quadrant blocks by the pixels they fill: top-left 1, top-right 2, bottom-left 4, bottom-right 8. */
const QUADRANTS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];

/** ASCII for the same four pixels: the top half, the bottom half, or more. */
function asciiQuadrant(bits: number): string {
  if ((bits & 12) === 0) return '"';
  if ((bits & 3) === 0) return '.';
  return '#';
}

const ink = (row: number, col: number) => WORD[row]?.[col] === '#';
const bitsAt = (line: number, cell: number, dy = 0, dx = 0) =>
  (ink(line * 2 - dy, cell * 2 - dx) ? 1 : 0) | (ink(line * 2 - dy, cell * 2 + 1 - dx) ? 2 : 0) | (ink(line * 2 + 1 - dy, cell * 2 - dx) ? 4 : 0) | (ink(line * 2 + 1 - dy, cell * 2 + 1 - dx) ? 8 : 0);

/**
 * The wordmark at time t as cells: Fredoka's "toil", the accent blue at the
 * baseline rising to its highlight at the top, over a one-cell shadow in a dark
 * blue, with a cursor after it that blinks with the badge's. It sweeps in from
 * the left with a bright leading edge, and a shine crosses it after the ring's
 * turn. Without colour it's the shape alone; without Unicode, ASCII. The
 * welcome menu draws the same cells, so the word has one shape everywhere.
 */
export function wordmarkCells(t: number, caps: Pick<TermCaps, 'unicode'> & Partial<Pick<TermCaps, 'colorDepth'>>): Cell[][] {
  const colour = (caps.colorDepth ?? 24) > 1;
  const PALETTE = pal(caps);
  const reveal = clamp((t - 0.3) / 0.6) * (WORDMARK_WIDTH + 4);
  const shineAt = SPIN.to - 0.05;
  const shine = ((t - shineAt) / 0.45) * (WORDMARK_WIDTH + 8) - 4;
  const shadow = mix(PALETTE.bg, PALETTE.accent, 0.38);
  const cursorOn = !BLINKS.some(([from, to]) => t > from && t < to);
  const rows: Cell[][] = [];
  // One more line than the word, for the shadow below it.
  for (let line = 0; line <= WORD_LINES; line++) {
    const out: Cell[] = [];
    for (let col = 0; col < WORDMARK_WIDTH; col++) {
      if (col > reveal) {
        out.push({ ch: ' ' });
        continue;
      }
      const bits = line < WORD_LINES ? bitsAt(line, col) : 0;
      if (bits) {
        // The vertical gradient, by the line's place in the word, then the sweep and the shine.
        const base = mix(PALETTE.accent, PALETTE.highlight, 1 - line / (WORD_LINES - 1));
        const edge = clamp(1 - (reveal - col) / 4);
        const glint = t > shineAt && t < shineAt + 0.5 ? clamp(1 - Math.abs(shine - col) / 3) : 0;
        out.push({ ch: caps.unicode ? QUADRANTS[bits]! : asciiQuadrant(bits), color: mix(base, PALETTE.ink, Math.max(edge * 0.8, glint * 0.9)) });
        continue;
      }
      // The shadow shows only where the word doesn't, and only in colour: as shape alone it would read as more letters.
      const behind = bitsAt(line, col, 2, 2);
      if (behind && colour && caps.unicode) {
        out.push({ ch: QUADRANTS[behind]!, color: shadow });
        continue;
      }
      // The cursor, two cells on the baseline after the word and its shadow.
      if (line === WORD_LINES - 1 && col >= WORD_COLS + 2 && cursorOn) {
        out.push({ ch: caps.unicode ? '▄' : '_', color: PALETTE.accent });
        continue;
      }
      out.push({ ch: ' ' });
    }
    rows.push(out);
  }
  return rows;
}

/** The wordmark at time t, as painted lines. */
export function wordmarkFrame(t: number, caps: Caps): string[] {
  return wordmarkCells(t, caps).map((row) => renderCells(row, caps));
}

/** Text that types itself out between `from` and `to` seconds. */
function typed(text: string, t: number, from: number, to: number): string {
  return text.slice(0, Math.round(clamp((t - from) / (to - from)) * text.length));
}

/** Words wrapped at spaces to `width` characters a line. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Wrapped lines that type themselves out together, each filling before the next starts. */
function typedLines(lines: string[], t: number, from: number, to: number): string[] {
  let left = Math.round(clamp((t - from) / (to - from)) * lines.reduce((n, l) => n + l.length, 0));
  return lines.map((l) => {
    const shown = l.slice(0, Math.max(0, left));
    left -= l.length;
    return shown;
  });
}

/** The text column's width beside the logo. */
const TEXT_WIDTH = Math.max(WORDMARK_WIDTH, TAGLINE.length);

/**
 * One frame of the splash, as lines. Every frame has the same height, so
 * redrawing in place never scrolls. The theme's look says what surrounds the
 * badge, how it arrives, and the line under the tagline, wrapped to the text
 * column: two lines at most beside the logo, which is sixteen tall, and as
 * many as it takes when the window is narrow enough to stack them.
 */
export function splashFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode' | 'columns'>, version: string, look: SplashLook = PLAIN_LOOK): string[] {
  const PALETTE = pal(caps);
  const logo = logoCells(t, caps, look);
  const dot = caps.unicode ? '·' : '-';
  const stacked = caps.columns < LOGO_WIDTH + GAP + TEXT_WIDTH + 4;
  const wrapped = wrapWords(look.line ?? PLAIN_LINE, stacked ? Math.max(20, caps.columns - 2) : TEXT_WIDTH);
  const lines = stacked || wrapped.length <= 2 ? wrapped : wrapped.slice(0, 2);
  const side: Cell[][] = [
    ...Array.from({ length: LEAD }, () => []),
    ...wordmarkCells(t, caps),
    [],
    textCells(typed(TAGLINE, t, 0.9, 1.4), PALETTE.ink),
    [],
    ...typedLines(lines, t, 1.2, 1.6).map((l) => textCells(l, PALETTE.muted)),
    textCells(t > 1.5 ? `toil ${version} ${dot} by Imagile` : '', PALETTE.faint),
  ];
  const rows = stacked
    ? [...logo, ...side.slice(LEAD)].map((row) => [{ ch: ' ' }, ...row])
    : logo.map((row, i) => [{ ch: ' ' }, ...row, ...blank(GAP), ...(side[i] ?? [])]);
  return rows.map((row) => renderCells(row, caps));
}

export interface SplashIO {
  write: (text: string) => void;
  /** Called on any key; the splash then jumps to its last frame. Returns an unsubscribe. */
  onKey?: (handler: () => void) => () => void;
  /** Injectable clock and timer, so tests don't wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const FRAME_MS = 33;

/**
 * Plays the splash in place. With animation off (not a TTY, NO_COLOR,
 * reduced motion, CI, a small window) it prints the still and returns.
 */
export async function playSplash(io: SplashIO, caps: TermCaps, version: string, look: SplashLook = PLAIN_LOOK): Promise<void> {
  const still = splashFrame(DURATION + 1, caps, version, look);
  if (!caps.animate) {
    io.write(`\n${still.join('\n')}\n`);
    return;
  }
  const now = io.now ?? (() => performance.now());
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let skipped = false;
  const stopListening = io.onKey?.(() => (skipped = true));
  const redraw = (lines: string[]) => io.write(`${cursor.up(still.length)}${lines.map((line) => `${cursor.clearLine}${line}`).join('\n')}\n`);

  io.write(`${cursor.hide}\n${splashFrame(0, caps, version, look).join('\n')}\n`);
  const start = now();
  try {
    for (;;) {
      const t = ((now() - start) / 1000) * SPEED;
      if (skipped || t >= DURATION) break;
      redraw(splashFrame(t, caps, version, look));
      await sleep(FRAME_MS);
    }
    redraw(still);
  } finally {
    stopListening?.();
    io.write(cursor.show);
  }
}
