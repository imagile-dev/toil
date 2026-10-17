import { DURATION, logoCells, SPIN } from './logo.js';
import { blank, type Cell, cursor, mix, PALETTE, renderCells, textCells, type TermCaps } from './term.js';

/**
 * The splash: the logo on the left, the wordmark and the tagline on the right.
 * A wave of colour sweeps the stage before anything draws, and another wipes it
 * away on the way out. Each frame is built from cells by a pure function of
 * time, and `playSplash` only decides how often to ask for one. Any key skips
 * to the end, because the second time you see an animation it's no longer an
 * animation, it's a queue.
 */

export const TAGLINE = 'Let your agents handle the toil.';

// "toil" as a 10-row bitmap; each pair of rows becomes one line of half-blocks.
const LETTERS: string[][] = [
  // t
  ['.##..', '.##..', '#####', '.##..', '.##..', '.##..', '.##..', '.##..', '.##..', '..###'],
  // o
  ['......', '......', '......', '.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  // i
  ['##', '##', '..', '##', '##', '##', '##', '##', '##', '##'],
  // l
  ['##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '##.', '.##'],
];

const WORD: string[] = LETTERS[0]!.map((_, row) => LETTERS.map((letter) => letter[row]).join('..'));
const WORD_WIDTH = WORD[0]!.length;
const LOGO_WIDTH = 32;
const GAP = 3;

/** The colour wave before the entrance: 0..INTRO seconds. */
export const INTRO = 0.55;
/** The wave out to the menu, in seconds. */
export const OUTRO = 0.5;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

type Caps = Pick<TermCaps, 'colorDepth' | 'unicode'>;

/**
 * The wordmark at time t as cells: it sweeps in from the left, flame to amber,
 * with a bright leading edge; a shine crosses it after the spin. `scale` 2
 * doubles every pixel's width, for terminals with room to spare.
 */
export function wordmarkCells(t: number, caps: Pick<TermCaps, 'unicode'>, scale: 1 | 2 = 1): Cell[][] {
  const reveal = clamp((t - 0.75) / 0.6) * (WORD_WIDTH + 4);
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

type Layout = Pick<TermCaps, 'unicode' | 'columns'>;

const stackedFor = (columns: number) => columns < LOGO_WIDTH + GAP + Math.max(WORD_WIDTH, TAGLINE.length) + 4;

/** The splash's content at time t, as rows of cells, before any wave. */
function stageCells(t: number, caps: Layout, version: string): Cell[][] {
  const logo = logoCells(t, caps);
  const dot = caps.unicode ? '·' : '-';
  const wide = caps.columns >= LOGO_WIDTH + GAP + WORD_WIDTH * 2 + 6;
  const side: Cell[][] = [
    [],
    [],
    [],
    ...wordmarkCells(t, caps, wide ? 2 : 1),
    [],
    textCells(typed(TAGLINE, t, 1.35, 1.85), PALETTE.ink),
    [],
    textCells(typed('Enterprise tools, databases and code.', t, 1.65, 2.05), PALETTE.muted),
    textCells(t > 1.95 ? `toil ${version} ${dot} by Imagile` : '', PALETTE.faint),
  ];
  if (stackedFor(caps.columns)) return [...logo, ...side.slice(3)].map((row) => [{ ch: ' ' }, ...row]);
  return logo.map((row, i) => [{ ch: ' ' }, ...row, ...blank(GAP), ...(side[i] ?? [])]);
}

/** The width every row is padded to, so a wave crosses the whole stage. */
function stageWidth(caps: Layout): number {
  const wide = caps.columns >= LOGO_WIDTH + GAP + WORD_WIDTH * 2 + 6;
  return stackedFor(caps.columns) ? 1 + LOGO_WIDTH : 1 + LOGO_WIDTH + GAP + Math.max(wide ? WORD_WIDTH * 2 : WORD_WIDTH, TAGLINE.length + 6);
}

const SHADES_UNICODE = ['█', '▓', '▒', '░'];
const SHADES_ASCII = ['#', '+', '-', '.'];

/**
 * A diagonal band of shading, flame to amber, sweeping left to right as p goes
 * 0 to 1. 'in' reveals what's behind it (the stage, still empty while the wave
 * runs); 'out' leaves blank behind it and the content ahead of it untouched.
 */
export function wave(rows: Cell[][], p: number, direction: 'in' | 'out', caps: Pick<TermCaps, 'unicode'>, width: number): Cell[][] {
  const band = 7;
  const span = width + rows.length * 2 + band * 2;
  const centre = p * span - band;
  const shades = caps.unicode ? SHADES_UNICODE : SHADES_ASCII;
  return rows.map((row, y) => {
    const out: Cell[] = [];
    for (let x = 0; x < width; x++) {
      const d = x + y * 2 - centre;
      const cell = row[x] ?? { ch: ' ' };
      if (Math.abs(d) <= band) {
        const k = Math.abs(d) / band;
        const shade = shades[Math.min(shades.length - 1, Math.floor(k * shades.length))]!;
        out.push({ ch: shade, color: mix(mix(PALETTE.accent, PALETTE.amber, x / width), PALETTE.ink, (1 - k) * 0.35) });
      } else if (d > band) out.push(direction === 'in' ? { ch: ' ' } : cell);
      else out.push(direction === 'in' ? cell : { ch: ' ' });
    }
    return out;
  });
}

/** One frame of the splash, as lines. Every frame has the same height, so redrawing in place never scrolls. */
export function splashFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode' | 'columns'>, version: string): string[] {
  let rows = stageCells(t, caps, version);
  if (t < INTRO) rows = wave(rows, t / INTRO, 'in', caps, stageWidth(caps));
  return rows.map((row) => renderCells(row, caps));
}

/** The still, wiped away by the outro wave as p goes 0 to 1. */
export function outroFrame(p: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode' | 'columns'>, version: string): string[] {
  return wave(stageCells(DURATION + 1, caps, version), p, 'out', caps, stageWidth(caps)).map((row) => renderCells(row, caps));
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
  let skipped = false;
  const stopListening = io.onKey?.(() => (skipped = true));
  io.write(`${cursor.hide}\n${splashFrame(0, caps, version).join('\n')}\n`);
  try {
    await animate(io, still.length, (t) => (skipped || t >= DURATION ? null : splashFrame(t, caps, version)));
    io.write(`${cursor.up(still.length)}${still.map((line) => `${cursor.clearLine}${line}`).join('\n')}\n`);
  } finally {
    stopListening?.();
    io.write(cursor.show);
  }
}

/**
 * The wave out, drawn from the top-left of a cleared screen (the alternate
 * screen the menu lives on). Skippable like the rest.
 */
export async function playOutro(io: SplashIO, caps: TermCaps, version: string): Promise<void> {
  if (!caps.animate) return;
  let skipped = false;
  const stopListening = io.onKey?.(() => (skipped = true));
  const height = outroFrame(0, caps, version).length;
  io.write(`${cursor.home}\n${outroFrame(0, caps, version).join('\n')}\n`);
  try {
    await animate(io, height, (t) => (skipped || t >= OUTRO ? null : outroFrame(t / OUTRO, caps, version)));
  } finally {
    stopListening?.();
  }
}

/** Redraws `height` lines in place with whatever `frame(t)` returns, until it returns null. */
async function animate(io: SplashIO, height: number, frame: (t: number) => string[] | null): Promise<void> {
  const now = io.now ?? (() => performance.now());
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  for (;;) {
    const lines = frame((now() - start) / 1000);
    if (!lines) return;
    io.write(`${cursor.up(height)}${lines.map((line) => `${cursor.clearLine}${line}`).join('\n')}\n`);
    await sleep(FRAME_MS);
  }
}
