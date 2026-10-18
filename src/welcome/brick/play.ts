import type { Key } from '../menu.js';
import { cursor, fitLine, type TermCaps, wrapLine } from '../term.js';
import { type Game, type Input, press, start, step } from './game.js';
import { frame, refusal } from './render.js';

/**
 * The one part of the game that touches a terminal: it reads keys, calls
 * `step` on a fixed tick and draws each frame from the top of the screen.
 * The menu owns raw mode, the alternate screen and putting both back; this
 * loop only promises to stop drawing the moment it's told to, so nothing it
 * writes can land after the terminal has been handed back. A game that
 * outlives its terminal is a ticket nobody wants to be assigned.
 */

/** One tick of game time. Fixed, so a slow machine plays slower rather than skipping through bricks. */
export const TICK_MS = 33;

export interface PlayIO {
  write: (text: string) => void;
  /** Every key while the game runs; returns an unsubscribe. */
  onKey: (handler: (key: Key) => void) => () => void;
  /** The terminal now: colours, Unicode and size, read again every frame so a resize is seen. */
  caps: () => TermCaps;
  /** False on a console that can't redraw in place (the splash's legacy-console rule). */
  movesCursor: boolean;
  /** The best score so far this session. */
  best: number;
  /** A notice to show instead of the key line, such as the Ctrl+C warning. */
  notice?: () => string;
  /** Aborted when the whole menu is exiting; the game stops at once and draws nothing more. */
  signal: AbortSignal;
}

/** A key as the game understands it, or 'quit', or nothing. */
export function inputOf(key: Key): Input | 'quit' | undefined {
  if (key.ctrl) return key.name === 'c' ? 'pause' : undefined;
  switch (key.name) {
    case 'left':
    case 'a':
      return 'left';
    case 'right':
    case 'd':
      return 'right';
    case 'space':
    case 'return':
    case 'enter':
      return 'launch';
    case 'p':
      return 'pause';
    case 'q':
    case 'escape':
      return 'quit';
    default:
      return undefined;
  }
}

/** Plays until q or Esc, or until `signal` aborts. Resolves to the best score this session and the score of the game in play when it stopped. */
export function playBrick(io: PlayIO): Promise<{ best: number; last: number }> {
  return new Promise((resolve, reject) => {
    let game: Game = start();
    let best = io.best;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    let shown = '';

    // Each line is cleared as it's overwritten rather than the whole screen
    // first, so frames don't flicker, and an unchanged frame isn't sent at all.
    const draw = () => {
      const caps = io.caps();
      const why = refusal(caps, io.movesCursor);
      const lines = why ? ['', ...wrapLine(`  ${why}`, caps.columns - 1), '', '  Press any key to go back.'] : frame(game, caps, { best, notice: io.notice?.() ?? '' });
      const text = `${cursor.home}${lines.map((l) => `${cursor.clearLine}${fitLine(l, caps.columns - 1)}`).join('\n')}${cursor.clearDown}`;
      if (text !== shown) io.write(text);
      shown = text;
    };

    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopKeys();
      io.signal.removeEventListener('abort', stop);
      if (err === undefined) resolve({ best, last: game.score });
      else reject(err instanceof Error ? err : new Error(String(err)));
    };
    const stop = () => finish();
    // A bug in a frame or a bounce stops the game and reaches the menu, which
    // puts the terminal back before the error is shown, rather than dying in a timer.
    const guarded =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch (err) {
          finish(err);
        }
      };

    const stopKeys = io.onKey(guarded((key: Key) => {
      if (done) return;
      // A window too small (or a console that can't redraw) shows why; any key goes back.
      if (refusal(io.caps(), io.movesCursor)) return stop();
      const input = inputOf(key);
      if (input === 'quit') return stop();
      if (!input) return;
      // Ctrl+C pauses rather than toggles, so the second press (which exits) finds it still paused.
      if (key.ctrl && game.status === 'paused') return void draw();
      game = press(game, input);
      draw();
    }));

    const tick = guarded(() => {
      if (done) return;
      if (!refusal(io.caps(), io.movesCursor)) {
        game = step(game, TICK_MS / 1000);
        best = Math.max(best, game.score);
      }
      draw();
      timer = setTimeout(tick, TICK_MS);
    });

    if (io.signal.aborted) return finish();
    io.signal.addEventListener('abort', stop);
    tick();
  });
}
