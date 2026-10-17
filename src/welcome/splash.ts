import { DURATION, logoFrame } from './logo.js';
import { cursor, mix, PALETTE, paint, type TermCaps, visibleLength } from './term.js';

/**
 * The splash: the logo on the left, the wordmark and the tagline on the right.
 * Each frame is built by `splashFrame(t)`, a pure function, and `playSplash`
 * only decides how often to ask for one. Any key skips to the end, because the
 * second time you see an animation it's no longer an animation, it's a queue.
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
const GAP = '   ';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The wordmark at time t: it sweeps in from the left, flame to amber, with a
 * bright leading edge, and once the signal has fired a shine crosses it.
 * `scale` 2 doubles every pixel's width, for terminals with room to spare.
 */
export function wordmarkFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode'>, scale: 1 | 2 = 1): string[] {
  const reveal = clamp((t - 0.35) / 0.6) * (WORD_WIDTH + 4);
  const shine = ((t - 1.35) / 0.45) * (WORD_WIDTH + 8) - 4;
  const lines: string[] = [];
  for (let row = 0; row < WORD.length; row += 2) {
    let out = '';
    for (let col = 0; col < WORD_WIDTH; col++) {
      const top = WORD[row]![col] === '#';
      const bottom = WORD[row + 1]![col] === '#';
      if (col > reveal || (!top && !bottom)) {
        out += ' '.repeat(scale);
        continue;
      }
      const glyph = caps.unicode ? (top && bottom ? '█' : top ? '▀' : '▄') : top && bottom ? '#' : top ? '"' : '.';
      const base = mix(PALETTE.accent, PALETTE.amber, col / (WORD_WIDTH - 1));
      const edge = clamp(1 - (reveal - col) / 4);
      const glint = t > 1.35 && t < 1.8 ? clamp(1 - Math.abs(shine - col) / 3) : 0;
      out += paint(caps, mix(base, PALETTE.ink, Math.max(edge * 0.8, glint * 0.9)), glyph.repeat(scale));
    }
    lines.push(out);
  }
  return lines;
}

/** Text that types itself out between `from` and `to` seconds. */
function typed(text: string, t: number, from: number, to: number): string {
  return text.slice(0, Math.round(clamp((t - from) / (to - from)) * text.length));
}

/** One frame of the splash, as lines. Every frame has the same height, so redrawing in place never scrolls. */
export function splashFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode' | 'columns'>, version: string): string[] {
  const logo = logoFrame(t, caps);
  const dot = caps.unicode ? '·' : '-';
  const wide = caps.columns >= LOGO_WIDTH + GAP.length + WORD_WIDTH * 2 + 6;
  const side = [
    '',
    '',
    '',
    ...wordmarkFrame(t, caps, wide ? 2 : 1),
    '',
    paint(caps, PALETTE.ink, typed(TAGLINE, t, 0.95, 1.45)),
    '',
    paint(caps, PALETTE.muted, typed('Enterprise tools, databases and code.', t, 1.2, 1.6)),
    paint(caps, PALETTE.faint, t > 1.5 ? `toil ${version} ${dot} by Imagile` : ''),
  ];
  const stacked = caps.columns < LOGO_WIDTH + GAP.length + Math.max(WORD_WIDTH, TAGLINE.length) + 4;
  if (stacked) {
    return [...logo, ...side.filter((_, i) => i >= 3)].map((line) => ` ${line}`);
  }
  return logo.map((line, i) => {
    const right = side[i] ?? '';
    const pad = ' '.repeat(Math.max(0, LOGO_WIDTH - visibleLength(line)));
    return ` ${line}${pad}${GAP}${right}`;
  });
}

export interface SplashIO {
  write: (text: string) => void;
  /** Resolves when any key is pressed; the splash then jumps to its last frame. */
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
  const height = still.length;

  io.write(`${cursor.hide}\n${splashFrame(0, caps, version).join('\n')}\n`);
  const start = now();
  try {
    for (;;) {
      const t = (now() - start) / 1000;
      const done = skipped || t >= DURATION;
      const frame = done ? still : splashFrame(t, caps, version);
      io.write(`${cursor.up(height)}${frame.map((line) => `${cursor.clearLine}${line}`).join('\n')}\n`);
      if (done) break;
      await sleep(FRAME_MS);
    }
  } finally {
    stopListening?.();
    io.write(cursor.show);
  }
}
