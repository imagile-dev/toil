import { DURATION, logoCells, SPIN } from './logo.js';
import { blank, type Cell, cursor, mix, PALETTE, renderCells, textCells, type TermCaps } from './term.js';

/**
 * The splash: the logo on the left, the wordmark and the tagline on the right.
 * Each frame is built from cells by a pure function of time, and `playSplash`
 * only decides how often to ask for one. Any key skips to the end, because the
 * second time you see an animation it's no longer an animation, it's a queue.
 */

export const TAGLINE = 'Let your agents handle the toil.';

/**
 * How fast the timeline plays: 1.25 timeline seconds per real second. The
 * timeline (logo.ts) stays in round numbers; this is the one dial for pace.
 */
export const SPEED = 1.25;

// "toil" as a 14-row bitmap, hand-drawn after the wordmark's typeface (Fredoka,
// weight 600: round terminals, a footed t, 3-pixel strokes). Each pair of rows
// becomes one line of half-blocks, so it stands 7 lines tall. The site and Toil
// UI set the same word in the font itself; a terminal has no fonts to set.
const LETTERS: string[][] = [
  // t
  ['.......', '.......', '..###..', '..###..', '..###..', '#######', '#######', '..###..', '..###..', '..###..', '..###..', '..###..', '..####.', '...####'],
  // o
  ['.........', '.........', '.........', '.........', '.........', '..#####..', '.#######.', '###...###', '###...###', '###...###', '###...###', '###...###', '.#######.', '..#####..'],
  // i
  ['...', '###', '###', '...', '...', '###', '###', '###', '###', '###', '###', '###', '###', '###'],
  // l
  ['###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###', '###'],
];

const WORD: string[] = LETTERS[0]!.map((_, row) => LETTERS.map((letter) => letter[row]).join('..'));
const WORD_WIDTH = WORD[0]!.length;
const LOGO_WIDTH = 32;
const GAP = 3;
/** Blank lines above the wordmark, so the text column sits centred beside the 16-line logo. */
const LEAD = 2;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

type Caps = Pick<TermCaps, 'colorDepth' | 'unicode'>;

/**
 * The wordmark at time t as cells: it sweeps in from the left, flame to amber,
 * with a bright leading edge; a shine crosses it after the ring's turn. `scale` 2
 * doubles every pixel's width, for terminals with room to spare.
 */
export function wordmarkCells(t: number, caps: Pick<TermCaps, 'unicode'>, scale: 1 | 2 = 1): Cell[][] {
  const reveal = clamp((t - 0.3) / 0.6) * (WORD_WIDTH + 4);
  const shineAt = SPIN.to - 0.05;
  const shine = ((t - shineAt) / 0.45) * (WORD_WIDTH + 8) - 4;
  const rows: Cell[][] = [];
  for (let row = 0; row < WORD.length; row += 2) {
    const out: Cell[] = [];
    for (let col = 0; col < WORD_WIDTH; col++) {
      const top = WORD[row]![col] === '#';
      const bottom = WORD[row + 1]![col] === '#';
      if (col > reveal || (!top && !bottom)) {
        out.push(...blank(scale));
        continue;
      }
      const glyph = caps.unicode ? (top && bottom ? '█' : top ? '▀' : '▄') : top && bottom ? '#' : top ? '"' : '.';
      const base = mix(PALETTE.accent, PALETTE.amber, col / (WORD_WIDTH - 1));
      const edge = clamp(1 - (reveal - col) / 4);
      const glint = t > shineAt && t < shineAt + 0.5 ? clamp(1 - Math.abs(shine - col) / 3) : 0;
      const color = mix(base, PALETTE.ink, Math.max(edge * 0.8, glint * 0.9));
      for (let k = 0; k < scale; k++) out.push({ ch: glyph, color });
    }
    rows.push(out);
  }
  return rows;
}

/** The wordmark at time t, as painted lines. */
export function wordmarkFrame(t: number, caps: Caps, scale: 1 | 2 = 1): string[] {
  return wordmarkCells(t, caps, scale).map((row) => renderCells(row, caps));
}

/** Text that types itself out between `from` and `to` seconds. */
function typed(text: string, t: number, from: number, to: number): string {
  return text.slice(0, Math.round(clamp((t - from) / (to - from)) * text.length));
}

/** One frame of the splash, as lines. Every frame has the same height, so redrawing in place never scrolls. */
export function splashFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode' | 'columns'>, version: string): string[] {
  const logo = logoCells(t, caps);
  const dot = caps.unicode ? '·' : '-';
  const wide = caps.columns >= LOGO_WIDTH + GAP + WORD_WIDTH * 2 + 6;
  const side: Cell[][] = [
    ...Array.from({ length: LEAD }, () => []),
    ...wordmarkCells(t, caps, wide ? 2 : 1),
    [],
    textCells(typed(TAGLINE, t, 0.9, 1.4), PALETTE.ink),
    [],
    textCells(typed('Enterprise tools and databases.', t, 1.2, 1.6), PALETTE.muted),
    textCells(t > 1.5 ? `toil ${version} ${dot} by Imagile` : '', PALETTE.faint),
  ];
  const stacked = caps.columns < LOGO_WIDTH + GAP + Math.max(WORD_WIDTH, TAGLINE.length) + 4;
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
 * TOIL_NO_ANIMATION, CI, a small window) it prints the still and returns.
 */
export async function playSplash(io: SplashIO, caps: TermCaps, version: string): Promise<void> {
  const still = splashFrame(DURATION + 1, caps, version);
  if (!caps.animate) {
    io.write(`\n${still.join('\n')}\n`);
    return;
  }
  const now = io.now ?? (() => performance.now());
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let skipped = false;
  const stopListening = io.onKey?.(() => (skipped = true));
  const redraw = (lines: string[]) => io.write(`${cursor.up(still.length)}${lines.map((line) => `${cursor.clearLine}${line}`).join('\n')}\n`);

  io.write(`${cursor.hide}\n${splashFrame(0, caps, version).join('\n')}\n`);
  const start = now();
  try {
    for (;;) {
      const t = ((now() - start) / 1000) * SPEED;
      if (skipped || t >= DURATION) break;
      redraw(splashFrame(t, caps, version));
      await sleep(FRAME_MS);
    }
    redraw(still);
  } finally {
    stopListening?.();
    io.write(cursor.show);
  }
}
