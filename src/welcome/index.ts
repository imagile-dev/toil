import { emitKeypressEvents } from 'node:readline';
import { CONTRACT_VERSION, type Envelope } from '../core/envelope.js';
import { playRogue, type SaveIO } from './rogue/play.js';
import { breadcrumb, finish, initialState, type Key, type MenuState, played, reduce, render } from './menu.js';
import type { WelcomeData } from './screens.js';
import { playSplash } from './splash.js';
import { cursor, detectCaps, movesCursor, PALETTE, paint } from './term.js';
import { commandLine, type Run, type StepResult } from './view.js';
import { outcome } from './views/result.js';

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
  /**
   * Runs one real toil command (`['connections', 'test', 'corp-jira']`) in this
   * process, prompting on this terminal, and returns the envelope it printed.
   * The menu does nothing else to config or connections, apart from `save`.
   */
  run?: (args: string[], signal: AbortSignal) => Promise<Envelope>;
  /** Where the game keeps its progress: under "game" in the user's config, sealed (src/welcome/rogue/save.ts). */
  save?: SaveIO;
  /** Reads everything the screens show again, after a command may have changed it. */
  reload?: () => WelcomeData;
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
export async function runWelcome(io: WelcomeIO, initial: WelcomeData): Promise<'quit' | 'interrupted'> {
  let data = initial;
  const { input, output } = io;
  const write = (text: string) => output.write(text);
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  // One "exit now" signal that ends whichever phase is running.
  let interrupted = false;
  let exitNow = () => {};
  // Aborted on the way out, so a game in progress stops drawing before the terminal is handed back.
  const exiting = new AbortController();
  const exited = new Promise<void>(
    (resolve) =>
      (exitNow = () => {
        exiting.abort();
        resolve();
      }),
  );
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
  // While a command runs, its own prompts own the keyboard; Ctrl+C cancels it.
  let busy = false;
  let running: AbortController | undefined;
  // While the game runs it draws the screen and reads keys itself; Ctrl+C still counts toward exiting.
  let gaming = false;
  const onKeypress = (_: string, key: Key | undefined) => {
    const k = key ?? {};
    if (busy) {
      if (k.ctrl && k.name === 'c') running?.abort();
      return;
    }
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
    // Here rather than after the menu loop, so an error that skips the loop still removes it.
    if (redraw) output.off('resize', redraw);
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
      // A running command or the game owns the screen; a resize or a notice
      // waits for it. Once exiting, nothing more is drawn.
      if (busy || gaming || exiting.signal.aborted) return;
      const now = detectCaps(output, io.env);
      write(`${cursor.home}${cursor.clearDown}${render(state, now, data, notice).join('\n')}`);
    };
    redraw();
    output.on('resize', redraw);

    // A run's commands prompt on this terminal, so the menu steps aside:
    // raw mode off, cursor on, its own keys ignored, and back again after.
    const perform = async (run: Run) => {
      const caps = detectCaps(output, io.env);
      const arrow = caps.unicode ? '›' : '>';
      write(`${cursor.home}${cursor.clearDown}${cursor.show}\n  ${paint(caps, PALETTE.highlight, `${breadcrumb(state, caps, data)} ${arrow} ${run.title}`)}\n`);
      const results: StepResult[] = [];
      for (const step of run.steps) {
        if (interrupted) break;
        if (step.label) write(`\n  ${paint(caps, PALETTE.highlight, step.label)}`);
        write(`\n  ${paint(caps, PALETTE.faint, `$ ${commandLine(data, step.args)}`)}\n\n`);
        running = new AbortController();
        if (input.isTTY) input.setRawMode(false);
        let envelope: Envelope;
        try {
          if (!io.run) throw new Error('This menu was opened without a way to run commands.');
          envelope = await io.run(step.args, running.signal);
        } catch (err) {
          // A command that throws instead of printing its envelope is still reported, never swallowed.
          envelope = { ok: false, data: null, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }, meta: { command: step.args.join(' '), durationMs: 0, version: data.version, contractVersion: CONTRACT_VERSION } };
        } finally {
          running = undefined;
          if (input.isTTY) input.setRawMode(true);
          input.resume();
        }
        results.push({ args: step.args, envelope });
        const o = outcome({ args: step.args, envelope });
        write(`  ${paint(caps, o.good ? PALETTE.ok : PALETTE.danger, o.text)}\n`);
        if (!envelope.ok && !run.keepGoing) break;
      }
      write(cursor.hide);
      state = finish(state, results);
      data = io.reload?.() ?? data;
    };

    // The game gets the screen and the keyboard until q brings it back here.
    const game = async () => {
      const which = state.playing ?? 'rogue';
      const terminal = {
        write,
        onKey: (handler: (key: Key) => void) => {
          keyListeners.add(handler);
          return () => keyListeners.delete(handler);
        },
        caps: () => detectCaps(output, io.env),
        movesCursor: movesCursor(output, io.env),
        best: state.session[which]?.best ?? 0,
        notice: () => notice,
        signal: exiting.signal,
      };
      const scores = await playRogue({ ...terminal, ...(io.save ? { save: io.save } : {}) });
      state = played(state, scores.best, scores.last, which);
    };

    await Promise.race([
      exited,
      new Promise<void>((done, fail) => {
        let queue = Promise.resolve();
        const l = (key: Key) => {
          if (key.ctrl && key.name === 'c') return;
          if (gaming) return;
          state = reduce(state, key, data);
          if (state.quit) {
            keyListeners.delete(l);
            done();
            return;
          }
          if (state.playing) {
            gaming = true;
            // Queued, so the key that chose Play isn't also the game's first key.
            queue = queue
              .then(game)
              .catch((err: unknown) => {
                // Nothing more is drawn; the finally below puts the terminal back, then the error surfaces.
                exiting.abort();
                fail(err);
              })
              .finally(() => {
                gaming = false;
                redraw?.();
              });
            return;
          }
          const run = state.pending;
          if (!run) {
            redraw?.();
            return;
          }
          busy = true;
          queue = queue
            .then(() => perform(run))
            .finally(() => {
              busy = false;
              redraw?.();
            });
        };
        keyListeners.add(l);
      }),
    ]);
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
