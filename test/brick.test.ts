import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRICK_WIDTH,
  bricksLeft,
  COLUMNS,
  FIRST_ROWS,
  type Game,
  HEIGHT,
  LIVES,
  PADDLE_ROW,
  PADDLE_STEP,
  PADDLE_WIDTH,
  press,
  SPEED_Y,
  start,
  step,
  TOP_ROW,
  WIDTH,
} from '../src/welcome/brick/game.js';
import { inputOf, playBrick, TICK_MS } from '../src/welcome/brick/play.js';
import { frame, NEEDS, refusal } from '../src/welcome/brick/render.js';
import { CTRL_C_WINDOW_MS, runWelcome } from '../src/welcome/index.js';
import { initialState, played, reduce, render } from '../src/welcome/menu.js';
import type { WelcomeData } from '../src/welcome/screens.js';
import { movesCursor, visibleLength, wrapLine } from '../src/welcome/term.js';
import { testConfig } from './harness/context.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[/;
const plain = { colorDepth: 1, unicode: true } as const;

/** A game mid-flight, with the ball wherever the test needs it. */
const flying = (ball: Game['ball'], over: Partial<Game> = {}): Game => ({ ...start(), status: 'play', ball, ...over });

/** Steps a game in ticks, the way the loop does. */
const run = (game: Game, ticks: number, each?: (g: Game) => Game): Game => {
  let g = game;
  for (let i = 0; i < ticks; i++) g = step(each ? each(g) : g, TICK_MS / 1000);
  return g;
};

describe('brick breaker: the game', () => {
  it('starts with a three-row wall, three lives and the ball resting on the middle of the paddle', () => {
    const g = start();
    expect(g.bricks).toHaveLength(FIRST_ROWS);
    expect(bricksLeft(g)).toBe(FIRST_ROWS * COLUMNS);
    expect(g.lives).toBe(LIVES);
    expect(g.status).toBe('serve');
    expect(g.ball.x).toBe(g.paddle + PADDLE_WIDTH / 2);
    expect(Math.floor(g.ball.y)).toBe(PADDLE_ROW - 1);
    // Nothing moves before the launch.
    expect(step(g, 1)).toBe(g);
  });

  it('moves the paddle a step per key, stops at the walls, and carries the ball while serving', () => {
    const g = start();
    const left = press(g, 'left');
    expect(left.paddle).toBe(g.paddle - PADDLE_STEP);
    expect(left.ball.x).toBe(left.paddle + PADDLE_WIDTH / 2);
    let g2 = g;
    for (let i = 0; i < 50; i++) g2 = press(g2, 'left');
    expect(g2.paddle).toBe(0);
    for (let i = 0; i < 50; i++) g2 = press(g2, 'right');
    expect(g2.paddle).toBe(WIDTH - PADDLE_WIDTH);
    // In play the paddle moves under the ball, not with it.
    const inPlay = press(g, 'launch');
    expect(press(inPlay, 'left').ball).toBe(inPlay.ball);
  });

  it('launches up and a little right, the same way every time', () => {
    const g = press(start(), 'launch');
    expect(g.status).toBe('play');
    expect(g.ball.vy).toBe(-SPEED_Y);
    expect(g.ball.vx).toBeGreaterThan(0);
    expect(press(start(), 'launch')).toEqual(g);
    // A second launch in play does nothing.
    expect(press(g, 'launch')).toBe(g);
  });

  it('reflects the ball off the left, right and top walls', () => {
    const left = step(flying({ x: 0.2, y: 12.5, vx: -10, vy: 0 }), 0.05);
    expect(left.ball.vx).toBe(10);
    expect(left.ball.x).toBeGreaterThanOrEqual(0);
    const right = step(flying({ x: WIDTH - 0.2, y: 12.5, vx: 10, vy: 0 }), 0.05);
    expect(right.ball.vx).toBe(-10);
    expect(right.ball.x).toBeLessThan(WIDTH);
    const top = step(flying({ x: 5.5, y: 0.2, vx: 0, vy: -10 }, { bricks: [] }), 0.05);
    expect(top.ball.vy).toBe(10);
    expect(top.ball.y).toBeGreaterThanOrEqual(0);
  });

  it('knocks out a brick hit from below, scores it, and sends the ball back down', () => {
    // Under brick column 2 of the bottom row, rising.
    const bottom = TOP_ROW + FIRST_ROWS - 1;
    const g = step(flying({ x: 2 * BRICK_WIDTH + 1.5, y: bottom + 1.2, vx: 0, vy: -10 }), 0.05);
    expect(g.bricks[FIRST_ROWS - 1]![2]).toBe(false);
    expect(bricksLeft(g)).toBe(FIRST_ROWS * COLUMNS - 1);
    expect(g.score).toBe(10);
    expect(g.ball.vy).toBe(10);
  });

  it('scores the top row highest', () => {
    const g = flying({ x: 1.5, y: TOP_ROW - 0.3, vx: 0, vy: 10 });
    const hit = step(g, 0.05);
    expect(hit.bricks[0]![0]).toBe(false);
    expect(hit.score).toBe(10 * FIRST_ROWS);
    expect(hit.ball.vy).toBe(-10);
  });

  it('bounces sideways off a brick hit from the side', () => {
    // Row 0 with only column 3 standing; the ball comes in from its left in the same row.
    const bricks = [Array.from({ length: COLUMNS }, (_, c) => c === 3), Array(COLUMNS).fill(false), Array(COLUMNS).fill(false)];
    bricks[2]![9] = true;
    const g = step(flying({ x: 3 * BRICK_WIDTH - 0.2, y: TOP_ROW + 0.5, vx: 10, vy: 0 }, { bricks }), 0.05);
    expect(g.bricks[0]![3]).toBe(false);
    expect(g.ball.vx).toBe(-10);
    expect(g.ball.vy).toBe(0);
  });

  it('can never pass through a brick between frames, however fast it goes', () => {
    const bottom = TOP_ROW + FIRST_ROWS - 1;
    // Ten rows in one frame, from under the wall to above it.
    const g = step(flying({ x: 1.5, y: PADDLE_ROW - 1, vx: 0, vy: -400 }), 0.025);
    expect(g.bricks[FIRST_ROWS - 1]![0]).toBe(false);
    expect(g.bricks[FIRST_ROWS - 2]![0]).toBe(true);
    expect(g.ball.vy).toBeGreaterThan(0);
    expect(Math.floor(g.ball.y)).toBeGreaterThan(bottom - 1);
  });

  it('bounces off the paddle, angled by where it lands: straight up in the middle, outwards at the edges', () => {
    const g = start();
    const fall = (x: number) => step(flying({ x, y: PADDLE_ROW - 0.2, vx: 0, vy: 10 }, { paddle: g.paddle }), 0.05).ball;
    const middle = fall(g.paddle + PADDLE_WIDTH / 2);
    expect(middle.vy).toBeLessThan(0);
    expect(middle.vx).toBeCloseTo(0);
    expect(fall(g.paddle + 0.1).vx).toBeLessThan(0);
    expect(fall(g.paddle + PADDLE_WIDTH - 0.1).vx).toBeGreaterThan(0);
    expect(Math.floor(middle.y)).toBe(PADDLE_ROW - 1);
  });

  it('loses a life when the ball gets past the paddle, and ends the game on the last one', () => {
    const miss = (lives: number) => run(flying({ x: 1.5, y: PADDLE_ROW - 0.6, vx: 0, vy: 10 }, { paddle: WIDTH - PADDLE_WIDTH, lives }), 10);
    const once = miss(3);
    expect(once.lives).toBe(2);
    expect(once.status).toBe('serve');
    expect(once.ball.x).toBe(once.paddle + PADDLE_WIDTH / 2);
    const last = miss(1);
    expect(last.lives).toBe(0);
    expect(last.status).toBe('over');
    // Game over: only launch does anything, and it starts afresh.
    expect(press(last, 'left')).toBe(last);
    expect(press(last, 'launch')).toEqual(start());
  });

  it('builds the next wall a row taller and faster once the last brick goes', () => {
    const bricks = [Array.from({ length: COLUMNS }, (_, c) => c === 0), Array(COLUMNS).fill(false), Array(COLUMNS).fill(false)];
    const cleared = step(flying({ x: 1.5, y: TOP_ROW + 1.2, vx: 0, vy: -10 }, { bricks, score: 50 }), 0.05);
    expect(cleared.wave).toBe(2);
    expect(cleared.bricks).toHaveLength(FIRST_ROWS + 1);
    expect(bricksLeft(cleared)).toBe((FIRST_ROWS + 1) * COLUMNS);
    expect(cleared.status).toBe('serve');
    expect(cleared.score).toBe(50 + 10 * FIRST_ROWS);
    expect(Math.abs(press(cleared, 'launch').ball.vy)).toBeGreaterThan(SPEED_Y);
  });

  it('pauses and resumes where it was, serving or in play, and stands still while paused', () => {
    const serving = press(start(), 'pause');
    expect(serving.status).toBe('paused');
    expect(press(serving, 'launch')).toBe(serving);
    expect(press(serving, 'left')).toBe(serving);
    expect(press(serving, 'pause').status).toBe('serve');
    const inPlay = press(start(), 'launch');
    const paused = press(inPlay, 'pause');
    expect(step(paused, 1)).toBe(paused);
    const resumed = press(paused, 'pause');
    expect(resumed).toEqual(inPlay);
  });

  it('plays a whole game with the paddle following the ball: scores, keeps the ball inside the walls, and ends', () => {
    // An autopilot that tracks the ball wins a while; this one lags, so it eventually loses.
    let g = press(start(), 'launch');
    let ticks = 0;
    while (g.status !== 'over' && ticks < 20000) {
      ticks++;
      if (g.status === 'serve') g = press(g, 'launch');
      if (ticks % 4 === 0) {
        const centre = g.paddle + PADDLE_WIDTH / 2;
        if (g.ball.x < centre - 1) g = press(g, 'left');
        else if (g.ball.x > centre + 1) g = press(g, 'right');
      }
      g = step(g, TICK_MS / 1000);
      expect(g.ball.x).toBeGreaterThanOrEqual(0);
      expect(g.ball.x).toBeLessThan(WIDTH);
      expect(g.ball.y).toBeGreaterThanOrEqual(0);
      expect(g.ball.y).toBeLessThan(HEIGHT);
    }
    expect(g.score).toBeGreaterThan(0);
    expect(g.score % 10).toBe(0);
  });
});

describe('brick breaker: drawing', () => {
  it('draws the same height every frame and fits the size it asks for', () => {
    for (const g of [start(), press(start(), 'pause'), { ...start(), lives: 0, status: 'over' as const }]) {
      const lines = frame(g, plain, { best: 0 });
      expect(lines).toHaveLength(HEIGHT + 5);
      expect(lines.length).toBeLessThan(NEEDS.rows);
      for (const l of lines) expect(visibleLength(l)).toBeLessThan(NEEDS.columns);
    }
  });

  it('shows the score, lives, wave and best, and the keys for what you can do now', () => {
    const text = frame(start(), plain, { best: 120 }).join('\n');
    expect(text).toContain('Score 0   Lives ♥♥♥   Wave 1   Best 120');
    expect(text).toContain('space launch  a/d move');
    expect(frame(press(start(), 'pause'), plain, { best: 0 }).join('\n')).toContain('Paused. p resumes');
    expect(frame({ ...start(), lives: 0, status: 'over' }, plain, { best: 0 }).join('\n')).toContain('Game over. space plays again');
    expect(frame(start(), plain, { best: 0, notice: 'Press Ctrl+C again to exit.' }).at(-1)).toContain('Press Ctrl+C again to exit.');
  });

  it('honours NO_COLOR and draws in plain ASCII where Unicode is not safe', () => {
    const ascii = frame(start(), { colorDepth: 1, unicode: false }, { best: 0 });
    expect(ascii.join('')).not.toMatch(ANSI);
    expect(ascii.join('')).toMatch(/^[\x20-\x7e]*$/);
    expect(ascii.join('\n')).toContain('###');
    expect(frame(start(), { colorDepth: 24, unicode: true }, { best: 0 }).join('')).toMatch(ANSI);
  });

  it('refuses politely on a small window or a console that cannot redraw in place', () => {
    expect(refusal({ columns: 80, rows: 24 }, true)).toBeUndefined();
    expect(refusal({ columns: 30, rows: 24 }, true)).toContain('this one is 30 by 24');
    expect(refusal({ columns: 80, rows: 10 }, true)).toContain(`at least ${NEEDS.columns} by ${NEEDS.rows}`);
    expect(refusal({ columns: 80, rows: 24 }, false)).toContain("can't redraw in place");
    expect(movesCursor({ isTTY: true }, {}, 'win32')).toBe(false);
    expect(movesCursor({ isTTY: true }, { WT_SESSION: 'x' }, 'win32')).toBe(true);
    expect(movesCursor({ isTTY: true }, { TERM: 'dumb' }, 'linux')).toBe(false);
    // NO_COLOR and TOIL_NO_ANIMATION change the look, never whether it plays.
    expect(movesCursor({ isTTY: true }, { NO_COLOR: '1', TOIL_NO_ANIMATION: '1' }, 'linux')).toBe(true);
  });

  it('reads arrows, a/d, space, p, q and Esc, and pauses on Ctrl+C', () => {
    expect(inputOf({ name: 'left' })).toBe('left');
    expect(inputOf({ name: 'd' })).toBe('right');
    expect(inputOf({ name: 'space' })).toBe('launch');
    expect(inputOf({ name: 'p' })).toBe('pause');
    expect(inputOf({ name: 'escape' })).toBe('quit');
    expect(inputOf({ name: 'q' })).toBe('quit');
    expect(inputOf({ name: 'c', ctrl: true })).toBe('pause');
    expect(inputOf({ name: 'x' })).toBeUndefined();
  });
});

describe('brick breaker: the loop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(size = { columns: 80, rows: 24 }, moves = true) {
    const handlers = new Set<(key: { name?: string; ctrl?: boolean }) => void>();
    let screen = '';
    const controller = new AbortController();
    const io = {
      write: (t: string) => void (screen += t),
      onKey: (h: (key: { name?: string; ctrl?: boolean }) => void) => (handlers.add(h), () => void handlers.delete(h)),
      caps: () => ({ colorDepth: 1 as const, unicode: true, animate: true, ...size }),
      movesCursor: moves,
      best: 40,
      signal: controller.signal,
    };
    const key = (name: string, ctrl = false) => [...handlers].forEach((h) => h({ name, ctrl }));
    return { io, key, handlers, controller, screen: () => screen, clear: () => (screen = '') };
  }

  it('draws, launches, moves and returns the scores on q, leaving no listener or timer behind', async () => {
    const h = harness();
    const ended = playBrick(h.io);
    expect(h.screen()).toContain('Score 0');
    expect(h.screen()).toContain('Best 40');
    h.key('space');
    await vi.advanceTimersByTimeAsync(TICK_MS * 30);
    h.key('left');
    h.key('q');
    await expect(ended).resolves.toEqual({ best: 40, last: 0 });
    expect(h.handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops drawing the moment the menu exits', async () => {
    const h = harness();
    const ended = playBrick(h.io);
    h.key('space');
    await vi.advanceTimersByTimeAsync(TICK_MS * 5);
    h.controller.abort();
    await ended;
    h.clear();
    await vi.advanceTimersByTimeAsync(TICK_MS * 30);
    expect(h.screen()).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows why on a window too small, and any key goes back', async () => {
    const h = harness({ columns: 30, rows: 10 });
    const ended = playBrick(h.io);
    expect(h.screen()).toContain('is 30 by 10.');
    expect(h.screen()).toContain('Press any key to go back.');
    h.key('x');
    await expect(ended).resolves.toEqual({ best: 40, last: 0 });
  });

  it('turns a bug in a frame into a rejected game, not an exception in a timer', async () => {
    const h = harness();
    let calls = 0;
    h.io.caps = () => {
      if (++calls > 3) throw new Error('frame failed');
      return { colorDepth: 1, unicode: true, animate: true, columns: 80, rows: 24 };
    };
    const ended = playBrick(h.io);
    const caught = ended.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(TICK_MS * 5);
    await expect(caught).resolves.toBe('frame failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

const data = (): WelcomeData => ({
  version: '0.1.0-alpha.1',
  node: '24.14.0',
  platform: 'linux x64',
  configPath: '/home/test/.toil/config.json',
  configExists: true,
  config: testConfig({ jira: { baseUrl: 'https://jira.imagile.dev', token: 't' } }),
  areas: [{ name: 'jira', description: 'Jira Data Center', signsIn: true, live: true, configurable: true }],
  mcpAreas: ['jira'],
  launch: { command: 'toil', args: [] },
  folder: { cwd: '/home/test' },
});

const k = (name: string) => (name.length === 1 ? { name, sequence: name } : { name });

describe('brick breaker: in the menu', () => {
  it('wraps the lobby text without gluing a word to the one before it when a space lands on the edge', () => {
    // "and" ends one short of the width, so the space after it doesn't fit.
    expect(wrapLine('  ab and a little', 9)).toEqual(['  ab and', '  a', '  little']);
  });


  it('has a row on the home screen that opens the lobby, and Play hands over to the game', () => {
    const home = render(initialState, { ...plain, columns: 120, rows: 40 }, data()).join('\n');
    expect(home).toContain('Play brick breaker');
    // Row 1 is "Test your connections" on an untested home, so the game is row 6.
    const lobby = reduce(initialState, k('6'), data());
    expect(render(lobby, { ...plain, columns: 120, rows: 40 }, data()).join('\n')).toContain('toil › Brick breaker');
    const playing = reduce(lobby, k('return'), data());
    expect(playing.playing).toBe('brick');
    const back = played(playing, 300, 120);
    expect(back.playing).toBeUndefined();
    expect(render(back, { ...plain, columns: 120, rows: 40 }, data()).join('\n')).toContain('Last game 120   Best this session 300');
    // The best only ever goes up.
    expect(played(back, 50, 50).session.brick).toEqual({ best: 300, last: 50 });
  });
});

describe('brick breaker: the terminal is put back on every exit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeTerminal() {
    const raw: boolean[] = [];
    const input = Object.assign(new EventEmitter(), { isTTY: true, setRawMode: (on: boolean) => (raw.push(on), input), resume: () => input, pause: () => input });
    let screen = '';
    const output = Object.assign(new EventEmitter(), { isTTY: true, columns: 100, rows: 30, getColorDepth: () => 1, write: (t: string) => ((screen += t), true) });
    const signals = new EventEmitter();
    const key = (name: string, ctrl = false) => input.emit('keypress', name, { name, sequence: ctrl ? '\x03' : name, ctrl });
    return { input, output, signals, raw, key, screen: () => screen };
  }

  async function intoGame(t: ReturnType<typeof fakeTerminal>) {
    const ended = runWelcome({ input: t.input as never, output: t.output as never, env: { TOIL_NO_ANIMATION: '1', TERM: 'xterm' }, signals: t.signals as never }, data());
    await vi.advanceTimersByTimeAsync(10);
    t.key('6');
    t.key('return');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.screen()).toContain('Score 0');
    t.key('space');
    await vi.advanceTimersByTimeAsync(TICK_MS * 20);
    // Wrapped, since an async function returning a promise would wait for it.
    return { ended };
  }

  /** Raw mode off, the cursor shown and the normal screen back, in that state at the end, and nothing drawn after. */
  async function expectRestored(t: ReturnType<typeof fakeTerminal>) {
    expect(t.raw.at(-1)).toBe(false);
    const screen = t.screen();
    const tail = screen.slice(screen.lastIndexOf('\x1b[?1049l'));
    expect(tail).toContain('\x1b[?25h');
    expect(tail).not.toContain('\x1b[?25l');
    expect(t.signals.listenerCount('SIGINT')).toBe(0);
    expect(t.input.listenerCount('keypress')).toBe(0);
    await vi.advanceTimersByTimeAsync(TICK_MS * 30);
    expect(t.screen()).toBe(screen);
    expect(vi.getTimerCount()).toBe(0);
  }

  it('on Ctrl+C twice mid-game: the first pauses and warns, a second within the window exits', async () => {
    const t = fakeTerminal();
    const { ended } = await intoGame(t);
    t.key('c', true);
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    expect(t.screen()).toContain('Press Ctrl+C again to exit.');
    // The warning lapses and the game is still paused underneath it.
    await vi.advanceTimersByTimeAsync(CTRL_C_WINDOW_MS + 100);
    expect(t.screen()).toContain('Paused. p resumes');
    t.key('c', true);
    t.key('c', true);
    await expect(ended).resolves.toBe('interrupted');
    await expectRestored(t);
  });

  it('on SIGINT twice mid-game', async () => {
    const t = fakeTerminal();
    const { ended } = await intoGame(t);
    t.signals.emit('SIGINT');
    t.signals.emit('SIGINT');
    await expect(ended).resolves.toBe('interrupted');
    await expectRestored(t);
  });

  it('on q: back to a cleanly redrawn menu with the score, then q quits', async () => {
    const t = fakeTerminal();
    const { ended } = await intoGame(t);
    t.key('q');
    await vi.advanceTimersByTimeAsync(10);
    const screen = t.screen();
    const menu = screen.slice(screen.lastIndexOf('\x1b[H'));
    expect(menu.startsWith('\x1b[H\x1b[0J')).toBe(true);
    expect(menu).toContain('toil › Brick breaker');
    expect(menu).toContain('Best this session');
    expect(menu).not.toContain('Score ');
    t.key('q');
    await expect(ended).resolves.toBe('quit');
    await expectRestored(t);
  });

  it('on a bug inside the game: the terminal is restored and the error still surfaces', async () => {
    const t = fakeTerminal();
    const { ended } = await intoGame(t);
    const outcome = ended.catch((err: Error) => err);
    // A resize that makes drawing throw stands in for any bug in a frame.
    Object.defineProperty(t.output, 'columns', {
      get: () => {
        throw new Error('frame failed');
      },
    });
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    Object.defineProperty(t.output, 'columns', { value: 100 });
    expect(await outcome).toEqual(new Error('frame failed'));
    await expectRestored(t);
  });
});
