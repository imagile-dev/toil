import { emitKeypressEvents } from 'node:readline';
import { initialState, type Key, type MenuState, reduce, render } from './menu.js';
import type { WelcomeData } from './screens.js';
import { playSplash } from './splash.js';
import { cursor, detectCaps } from './term.js';

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
}

/**
 * Runs the splash, then the menu, until the user quits. The terminal is put
 * back the way it was found on every way out: quit, Ctrl+C, or an error.
 */
export async function runWelcome(io: WelcomeIO, data: WelcomeData): Promise<void> {
  const { input, output } = io;
  const write = (text: string) => output.write(text);
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  const keyListeners = new Set<(key: Key) => void>();
  const onKeypress = (_: string, key: Key | undefined) => {
    for (const l of keyListeners) l(key ?? {});
  };
  input.on('keypress', onKeypress);
  const onKey = (handler: () => void) => {
    const l = () => handler();
    keyListeners.add(l);
    return () => keyListeners.delete(l);
  };

  let altScreen = false;
  const restore = () => {
    if (altScreen) write(cursor.altScreenOff);
    write(cursor.show);
    input.off('keypress', onKeypress);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
  };

  try {
    await playSplash({ write, onKey }, detectCaps(output, io.env), data.version);
    await pause(io.env.TOIL_NO_ANIMATION ? 0 : 600, onKey);

    write(`${cursor.altScreenOn}${cursor.hide}`);
    altScreen = true;
    let state: MenuState = initialState;
    const draw = () => {
      const caps = detectCaps(output, io.env);
      write(`${cursor.home}${cursor.clearDown}${render(state, caps, data).join('\n')}`);
    };
    draw();
    output.on('resize', draw);

    await new Promise<void>((done) => {
      const l = async (key: Key) => {
        state = reduce(state, key);
        if (state.quit) {
          keyListeners.delete(l);
          output.off('resize', draw);
          done();
          return;
        }
        if (state.replay) {
          keyListeners.delete(l);
          write(`${cursor.home}${cursor.clearDown}`);
          await playSplash({ write: (t) => write(t.replace(/^\n/, '')), onKey }, detectCaps(output, io.env), data.version);
          await pause(800, onKey);
          state = { ...state, replay: false };
          keyListeners.add(l);
        }
        draw();
      };
      keyListeners.add(l);
    });
  } finally {
    restore();
  }
  write(`toil ${data.version}. Every command prints JSON; try \`${[data.launch.command, ...data.launch.args, '--help'].join(' ')}\`.\n`);
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
