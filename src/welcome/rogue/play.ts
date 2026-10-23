import type { Key } from '../menu.js';
import { cursor, fitLine, type TermCaps, wrapLine } from '../term.js';
import { act, type Game, type Input, score, start } from './game.js';
import { accrued, buy, freshProgress, loadout, PERKS, type Progress, settle } from './perks.js';
import { frame, LOBBY_ROWS, lobbyFrame, refusal, typedText } from './render.js';
import type { Loaded } from './save.js';

/**
 * The part of Two Weeks' Notice that touches a terminal. The game is
 * turn-based, but the screen isn't: a short tick advances the clock that
 * drives effects, the typewriter and the title's shimmer, and redraws only
 * when the frame changes. Between runs it shows Benefits Enrollment, and it
 * saves progress after every run and every purchase. As with the rest of the
 * welcome menu, the menu owns raw mode and the alternate screen, and this
 * loop stops drawing the moment it is told to.
 */

/** One tick of animation. Nothing in the game itself moves on a timer. */
export const TICK_MS = 30;
/** Characters the typewriter adds each tick. */
export const TYPE_RATE = 3;

export interface SaveIO {
  load: () => Loaded;
  /** Returns why it couldn't save, or undefined. */
  store: (p: Progress) => string | undefined;
}

export interface PlayIO {
  write: (text: string) => void;
  onKey: (handler: (key: Key) => void) => () => void;
  caps: () => TermCaps;
  movesCursor: boolean;
  best: number;
  notice?: () => string;
  signal: AbortSignal;
  /** Where progress lives; without it, progress lasts as long as the menu. */
  save?: SaveIO;
  /** A fixed seed for every run, for tests. */
  seed?: number;
  /** Reduced motion: the clock holds still and text appears at once (TOIL_REDUCED_MOTION, as the menu reads it). */
  reducedMotion?: boolean;
}

const KEYS: Record<string, Input> = {
  up: 'up',
  k: 'up',
  w: 'up',
  down: 'down',
  j: 'down',
  s: 'down',
  left: 'left',
  h: 'left',
  a: 'left',
  right: 'right',
  l: 'right',
  d: 'right',
  y: 'up-left',
  u: 'up-right',
  b: 'down-left',
  n: 'down-right',
  space: 'wait',
  return: 'wait',
  enter: 'wait',
};

/** A key as the game understands it, 'quit', 'legend', or nothing. */
export function inputOf(key: Key): Input | 'quit' | 'legend' | undefined {
  if (key.ctrl || key.meta) return undefined;
  if (key.name === 'q' || key.name === 'escape') return 'quit';
  if (key.sequence === '?') return 'legend';
  if (key.sequence === '.') return 'wait';
  return key.name ? KEYS[key.name] : undefined;
}

/** Plays until q or Esc from Benefits Enrollment, or until `signal` aborts. Resolves to the best score so far and the last run's. */
export function playRogue(io: PlayIO): Promise<{ best: number; last: number }> {
  return new Promise((resolve, reject) => {
    const loaded: Loaded = io.save?.load() ?? { progress: freshProgress(), writable: false };
    let progress = loaded.progress;
    // A save that can't be written stays on screen; anything else is said once.
    const warning = loaded.writable ? undefined : loaded.notice;
    let saveNotice = loaded.writable ? (loaded.notice ?? '') : '';
    let mode: 'lobby' | 'run' = 'lobby';
    let game: Game | undefined;
    let selected = 0;
    let last: { floor: number; earned: number; won: boolean } | undefined;
    let lastScore = 0;
    let best = Math.max(io.best, progress.high);
    let legend = false;
    let clock = 0;
    let since = 99;
    let reveal = 0;
    let typing = '';
    let done = false;
    let shown = '';

    const seed = () => io.seed ?? Math.floor(Math.random() * 2 ** 32);
    const save = () => {
      if (!io.save || !loaded.writable) return;
      saveNotice = io.save.store(progress) ?? '';
    };
    const newRun = (intro: boolean) => {
      game = start(seed(), { perks: loadout(progress), skipIntro: !intro });
      mode = 'run';
      legend = false;
      since = 99;
    };
    if (!progress.briefed) newRun(true);

    const draw = () => {
      const caps = io.caps();
      const why = refusal(caps, io.movesCursor);
      const notice = io.notice?.() || (mode === 'lobby' ? saveNotice : '');
      const still = io.reducedMotion === true;
      const hud = { clock: still ? 0 : clock, since, reveal, columns: caps.columns, legend, notice, progress, still, ...(warning ? { warning } : {}) };
      const lines = why ? ['', ...wrapLine(`  ${why}`, caps.columns - 1), '', '  Press any key to go back.'] : mode === 'lobby' || !game ? lobbyFrame(progress, selected, caps, hud, last) : frame(game, caps, hud);
      const text = `${cursor.home}${lines.map((l) => `${cursor.clearLine}${fitLine(l, caps.columns - 1)}`).join('\n')}${cursor.clearDown}`;
      if (text !== shown) io.write(text);
      shown = text;
    };

    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      stopKeys();
      io.signal.removeEventListener('abort', stop);
      if (err === undefined) resolve({ best, last: lastScore });
      else reject(err instanceof Error ? err : new Error(String(err)));
    };
    const stop = () => finish();
    const guarded =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch (err) {
          finish(err);
        }
      };

    /** Applies one key to the game and books anything that just finished. */
    const play = (input: Input) => {
      const before = game!;
      if (before.status === 'won' || before.status === 'lost') {
        // Back to enrollment with the stairs selected: the next run is one key away.
        mode = 'lobby';
        game = undefined;
        selected = 0;
        return;
      }
      const after = act(before, input);
      if (after === before) return;
      game = after;
      since = 0;
      if (before.status === 'intro' && after.status === 'play' && !progress.briefed) {
        progress = { ...progress, briefed: true };
        save();
      }
      if (after.status === 'won' || after.status === 'lost') {
        const won = after.status === 'won';
        lastScore = score(after);
        best = Math.max(best, lastScore);
        last = { floor: after.floor, earned: accrued({ floor: after.floor, defeated: after.defeated, won }), won };
        progress = settle(progress, { floor: after.floor, defeated: after.defeated, won, score: lastScore });
        save();
      }
    };

    const lobby = (key: Key) => {
      if (key.name === 'up' || key.name === 'k' || key.name === 'w') selected = (selected - 1 + LOBBY_ROWS) % LOBBY_ROWS;
      else if (key.name === 'down' || key.name === 'j' || key.name === 's') selected = (selected + 1) % LOBBY_ROWS;
      else if ((key.name === 'return' || key.name === 'enter') && selected === 0) newRun(false);
      else if (key.name === 'return' || key.name === 'enter') {
        const perk = PERKS[selected - 1]!;
        const bought = buy(progress, perk.id);
        if (typeof bought === 'string') saveNotice = { maxed: 'Already enrolled at every level. There is no higher tier, by policy.', locked: 'Not yet available at this grade.', poor: 'Not enough PTO for that yet.' }[bought];
        else {
          progress = bought;
          saveNotice = '';
          save();
          if (!saveNotice) saveNotice = `Enrolled: ${perk.name}. HR will process this in four to six weeks, effective immediately.`;
        }
      } else if (key.name === 'space') newRun(false);
      else if (key.sequence === 'i') newRun(true);
    };

    const stopKeys = io.onKey(
      guarded((key: Key) => {
        if (done) return;
        if (refusal(io.caps(), io.movesCursor)) return stop();
        const input = inputOf(key);
        if (input === 'quit') {
          if (mode === 'lobby') return stop();
          // Leaving a run forfeits it, as with most benefits.
          if (game?.status === 'play') saveNotice = 'Run forfeited. Unused effort does not roll over.';
          mode = 'lobby';
          game = undefined;
          return void draw();
        }
        // A keypress while text is still typing shows all of it, rather than skipping past it unread.
        if (mode === 'run' && reveal < typing.length && !key.ctrl) {
          reveal = typing.length;
          return void draw();
        }
        if (mode === 'lobby') {
          if (!key.ctrl) lobby(key);
          return void draw();
        }
        if (input === 'legend') {
          legend = !legend;
          return void draw();
        }
        const g = game!;
        // Off the floor, and on a card, any ordinary key carries on.
        const move = input ?? (!key.ctrl && (g.status !== 'play' || g.cards.length) ? 'wait' : undefined);
        if (move) play(move);
        sync();
        draw();
      }),
    );

    /** Starts the typewriter over whenever the text on screen changes, the moment it changes. */
    const sync = (): boolean => {
      const text = mode === 'run' ? typedText(game) : '';
      if (text === typing) return false;
      typing = text;
      // Reduced motion: no typewriter, the whole text at once.
      reveal = io.reducedMotion ? text.length : 0;
      return true;
    };
    const tick = guarded(() => {
      clock += 1;
      since += 1;
      if (!sync() && reveal < typing.length) reveal += TYPE_RATE;
      draw();
    });
    const timer = setInterval(tick, TICK_MS);
    if (io.signal.aborted) return finish();
    io.signal.addEventListener('abort', stop);
    // The first frame already knows its text, so reduced motion shows all of it at once.
    guarded(() => {
      sync();
      draw();
    })();
  });
}
