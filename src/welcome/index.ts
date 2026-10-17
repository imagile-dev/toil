import { emitKeypressEvents } from 'node:readline';
import { initialState, type Key, type MenuState, reduce, render } from './menu.js';
import type { WelcomeData } from './screens.js';
import { playSplash } from './splash.js';
import { cursor, detectCaps, PALETTE, paint } from './term.js';

export type { WelcomeData } from './screens.js';

/**
 * Bare `toil` on an interactive terminal opens the welcome screen. Anything
 * else (arguments, a pipe, an agent, CI, MCP) gets the JSON CLI exactly as
 * before, because a menu that appears in a pipeline is how a five-minute job
 * becomes an incident review.
 */
export function wantsWelcome(args: string[], input: { isTTY?: boolean }, output: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  return args.length === 0 && input.isTTY === true && output.isTTY === true && !env.CI;
}

export interface WelcomeIO {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
  /** Where SIGINT comes from; the process, except in tests. */
  signals?: Pick<NodeJS.Process, 'on' | 'off'>;
}

/** How long after a first Ctrl+C a second one exits. */
export const CTRL_C_WINDOW_MS = 2000;

/**
 * Ctrl+C needs saying twice: the first press warns (and skips the splash), a
 * second within the window exits. Returns a function that records a press and
 * says whether it was the second. One stray keystroke shouldn't end a session,
 * and two deliberate ones shouldn't need a form.
 */
export function doubleTap(windowMs: number, now: () => number): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    const second = t - last <= windowMs;
    last = second ? -Infinity : t;
    return second;
  };
}

const NOTICE = 'Press Ctrl+C again to exit.';

/**
 * Runs the splash, then the menu, until the user quits ('quit') or presses
 * Ctrl+C twice ('interrupted'). The terminal is put back the way it was found
 * on every way out, errors included.
 */
export async function runWelcome(io: WelcomeIO, data: WelcomeData): Promise<'quit' | 'interrupted'> {
  const { input, output } = io;
  const write = (text: string) => output.write(text);
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  // One "exit now" signal that ends whichever phase is running.
  let interrupted = false;
  let exitNow = () => {};
  const exited = new Promise<void>((resolve) => (exitNow = resolve));
  const ctrlC = doubleTap(CTRL_C_WINDOW_MS, () => Date.now());
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let redraw: (() => void) | undefined;
  const setNotice = (text: string) => {
    notice = text;
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => setNotice(''), CTRL_C_WINDOW_MS);
    redraw?.();
  };

  const keyListeners = new Set<(key: Key) => void>();
  const onKeypress = (_: string, key: Key | undefined) => {
    const k = key ?? {};
    if (k.ctrl && k.name === 'c') {
      if (ctrlC()) {
        interrupted = true;
        exitNow();
        return;
      }
      setNotice(NOTICE);
    } else if (notice) setNotice('');
    // Every key, the first Ctrl+C included, also skips the splash.
    for (const l of keyListeners) l(k);
  };
  input.on('keypress', onKeypress);
  // Ctrl+C usually arrives as a keypress in raw mode, but some terminals and
  // tools send SIGINT instead. Both count the same, so a second one exits
  // cleanly rather than leaving the terminal on the alternate screen.
  const onSigint = () => onKeypress('', { ctrl: true, name: 'c' });
  const signals = io.signals ?? process;
  signals.on('SIGINT', onSigint);
  const onKey = (handler: () => void) => {
    const l = () => handler();
    keyListeners.add(l);
    return () => keyListeners.delete(l);
  };

  let altScreen = false;
  const restore = () => {
    clearTimeout(noticeTimer);
    signals.off('SIGINT', onSigint);
    if (altScreen) write(cursor.altScreenOff);
    write(cursor.show);
    input.off('keypress', onKeypress);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
  };

  try {
    const caps = detectCaps(output, io.env);
    await Promise.race([playSplash({ write, onKey }, caps, data.version), exited]);
    if (interrupted) return 'interrupted';
    if (notice) write(`  ${paint(caps, PALETTE.accent, notice)}\n`);
    await Promise.race([pause(io.env.TOIL_NO_ANIMATION ? 0 : 600, onKey), exited]);
    if (interrupted) return 'interrupted';

    // The menu lives on the alternate screen, so the finished splash stays in
    // the scrollback of the normal one.
    write(`${cursor.altScreenOn}${cursor.hide}`);
    altScreen = true;
    let state: MenuState = initialState;
    redraw = () => {
      const now = detectCaps(output, io.env);
      write(`${cursor.home}${cursor.clearDown}${render(state, now, data, notice).join('\n')}`);
    };
    redraw();
    output.on('resize', redraw);

    await Promise.race([
      exited,
      new Promise<void>((done) => {
        const l = (key: Key) => {
          if (key.ctrl && key.name === 'c') return;
          state = reduce(state, key);
          if (state.quit) {
            keyListeners.delete(l);
            done();
            return;
          }
          redraw?.();
        };
        keyListeners.add(l);
      }),
    ]);
    output.off('resize', redraw);
    return interrupted ? 'interrupted' : 'quit';
  } finally {
    restore();
    write(`toil ${data.version}. Every command prints JSON; try \`${[data.launch.command, ...data.launch.args, '--help'].join(' ')}\`.\n`);
  }
}

/** A short beat after the splash, cut short by any key. */
function pause(ms: number, onKey: (h: () => void) => () => void): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = onKey(() => finish());
    const timer = setTimeout(() => finish(), ms);
    function finish() {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}
