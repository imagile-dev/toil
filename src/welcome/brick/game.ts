/**
 * Brick breaker, as data. `start`, `press` and `step` are pure: they take a
 * game and return the next one, with no clock, no randomness and no terminal,
 * so every bounce is a unit test. play.ts decides how often to call `step`,
 * and render.ts decides what it looks like. The ball has been told the
 * process; it is the only stakeholder that bounces back every time.
 */

/** Bricks per row; each is BRICK_WIDTH cells wide, so the field is 40 cells across. */
export const COLUMNS = 10;
export const BRICK_WIDTH = 4;
export const WIDTH = COLUMNS * BRICK_WIDTH;
/** Rows inside the walls. The paddle sits on the last one. */
export const HEIGHT = 16;
export const PADDLE_ROW = HEIGHT - 1;
export const PADDLE_WIDTH = 7;
/** How far one key press moves the paddle; terminal key repeat does the rest. */
export const PADDLE_STEP = 2;
/** The first wall's brick rows start this far down, leaving room to bounce above them. */
export const TOP_ROW = 2;
export const FIRST_ROWS = 3;
export const MAX_ROWS = 6;
export const LIVES = 3;
/** Rows per second, falling or rising. Terminal cells are about twice as tall as wide. */
export const SPEED_Y = 9;
/** Cells per second across, at the paddle's edge; its middle sends the ball straight up. */
export const SPEED_X = 16;
/** Each new wall plays this much faster than the last, up to MAX_SPEEDUP. */
export const SPEEDUP = 0.1;
export const MAX_SPEEDUP = 1.6;

export type Status = 'serve' | 'play' | 'paused' | 'over';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Game {
  /** The paddle's leftmost cell. */
  paddle: number;
  ball: Ball;
  /** bricks[row][column]: true while the brick stands. Row 0 is TOP_ROW. */
  bricks: boolean[][];
  score: number;
  lives: number;
  /** Which wall this is, from 1. Clearing one builds the next, a row taller. */
  wave: number;
  status: Status;
  /** Where play resumes after a pause. */
  resume?: 'serve' | 'play';
}

export type Input = 'left' | 'right' | 'launch' | 'pause';

const wall = (wave: number): boolean[][] => Array.from({ length: Math.min(MAX_ROWS, FIRST_ROWS + wave - 1) }, () => Array.from({ length: COLUMNS }, () => true));

const speed = (wave: number) => Math.min(MAX_SPEEDUP, 1 + SPEEDUP * (wave - 1));

/** The ball resting on the middle of the paddle, waiting to be launched. */
function onPaddle(paddle: number): Ball {
  return { x: paddle + PADDLE_WIDTH / 2, y: PADDLE_ROW - 0.5, vx: 0, vy: 0 };
}

export function start(): Game {
  const paddle = Math.floor((WIDTH - PADDLE_WIDTH) / 2);
  return { paddle, ball: onPaddle(paddle), bricks: wall(1), score: 0, lives: LIVES, wave: 1, status: 'serve' };
}

export const bricksLeft = (game: Game): number => game.bricks.reduce((n, row) => n + row.filter(Boolean).length, 0);

/** Points for a brick: the top row of the wall is worth the most. */
export const points = (game: Game, row: number): number => 10 * (game.bricks.length - row);

/** A key, already translated from the keyboard. */
export function press(game: Game, input: Input): Game {
  if (game.status === 'over') return input === 'launch' ? start() : game;
  if (input === 'pause') {
    if (game.status === 'paused') {
      const resumed = { ...game, status: game.resume ?? 'play' };
      delete resumed.resume;
      return resumed;
    }
    return { ...game, status: 'paused', resume: game.status };
  }
  if (game.status === 'paused') return game;
  if (input === 'launch') {
    if (game.status !== 'serve') return game;
    // Always up and a little right, so the same keys play the same game.
    const k = speed(game.wave);
    return { ...game, status: 'play', ball: { ...game.ball, vx: SPEED_X * 0.35 * k, vy: -SPEED_Y * k } };
  }
  const paddle = Math.max(0, Math.min(WIDTH - PADDLE_WIDTH, game.paddle + (input === 'left' ? -PADDLE_STEP : PADDLE_STEP)));
  if (paddle === game.paddle) return game;
  return { ...game, paddle, ...(game.status === 'serve' ? { ball: onPaddle(paddle) } : {}) };
}

/**
 * The game `dt` seconds later. The ball moves in steps of at most half a
 * cell, so at any speed it can't pass through a brick or the paddle between
 * two frames.
 */
export function step(game: Game, dt: number): Game {
  if (game.status !== 'play' || dt <= 0) return game;
  let { x, y, vx, vy } = game.ball;
  let { score } = game;
  let bricks = game.bricks;
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(vx), Math.abs(vy)) * dt) / 0.5));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    let nx = x + vx * h;
    let ny = y + vy * h;
    // Walls: left, right and top reflect.
    if (nx < 0) [nx, vx] = [-nx, -vx];
    if (nx >= WIDTH) [nx, vx] = [2 * WIDTH - nx - 1e-6, -vx];
    if (ny < 0) [ny, vy] = [-ny, -vy];

    // A brick: knock it out and bounce off the side the ball came through.
    const row = Math.floor(ny) - TOP_ROW;
    const column = Math.floor(nx / BRICK_WIDTH);
    if (row >= 0 && row < bricks.length && bricks[row]![column]) {
      bricks = bricks.map((r, ri) => (ri === row ? r.map((b, ci) => (ci === column ? false : b)) : r));
      score += points(game, row);
      if (Math.floor(ny) !== Math.floor(y)) [ny, vy] = [y, -vy];
      else [nx, vx] = [x, -vx];
      if (!bricks.some((r) => r.some(Boolean))) return nextWave({ ...game, bricks, score });
    }

    // The paddle: the ball crossing onto its row above it bounces up, angled by where it hit.
    if (vy > 0 && Math.floor(y) < PADDLE_ROW && Math.floor(ny) >= PADDLE_ROW && nx >= game.paddle && nx < game.paddle + PADDLE_WIDTH) {
      const offset = (nx - (game.paddle + PADDLE_WIDTH / 2)) / (PADDLE_WIDTH / 2);
      const k = speed(game.wave);
      vx = SPEED_X * Math.max(-1, Math.min(1, offset)) * k;
      vy = -Math.abs(vy);
      ny = PADDLE_ROW - 0.01;
    }

    // Past the paddle: a life gone.
    if (ny >= HEIGHT) return lose({ ...game, bricks, score });
    x = nx;
    y = ny;
  }
  return { ...game, bricks, score, ball: { x, y, vx, vy } };
}

function lose(game: Game): Game {
  const lives = game.lives - 1;
  return { ...game, lives, ball: onPaddle(game.paddle), status: lives > 0 ? 'serve' : 'over' };
}

/** A cleared wall: the next one, a row taller and a little faster, served from the paddle. */
function nextWave(game: Game): Game {
  const wave = game.wave + 1;
  return { ...game, wave, bricks: wall(wave), ball: onPaddle(game.paddle), status: 'serve' };
}
