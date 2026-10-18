import { mix, PALETTE, paint, renderCells, style, type Cell, type TermCaps } from '../term.js';
import { BRICK_WIDTH, type Game, HEIGHT, PADDLE_ROW, PADDLE_WIDTH, TOP_ROW, WIDTH } from './game.js';

/**
 * What a game looks like: a pure function of the game, the capabilities and
 * a line of status, so a frame is a test fixture. Bricks are the logo's
 * amber, warming toward flame at the top of the wall, where they're worth
 * more. Decorating the high-value targets is standard practice in any
 * budget review.
 */

type Caps = Pick<TermCaps, 'colorDepth' | 'unicode'>;

/** The cells a frame needs: the field, its walls, a score line and a key line, plus a margin. */
export const NEEDS = { columns: WIDTH + 6, rows: HEIGHT + 7 } as const;

/** Why this terminal can't play, or undefined when it can. */
export function refusal(size: { columns: number; rows: number }, movesCursor: boolean): string | undefined {
  if (!movesCursor) return "This console can't redraw in place, which the game needs. Windows Terminal, or any modern terminal, can.";
  if (size.columns < NEEDS.columns || size.rows < NEEDS.rows)
    return `The game needs a window of at least ${NEEDS.columns} by ${NEEDS.rows}; this one is ${size.columns} by ${size.rows}. Make it bigger to play.`;
  return undefined;
}

export interface Hud {
  /** The best score this session, this game included. */
  best: number;
  /** A notice that outranks the status line, such as the Ctrl+C warning. */
  notice?: string;
}

const hint = (game: Game): string => {
  switch (game.status) {
    case 'serve':
      return 'space launch  a/d move  p pause  q back';
    case 'paused':
      return 'Paused. p resumes  q back';
    case 'over':
      return 'Game over. space plays again  q back';
    default:
      return 'a/d or arrows move  p pause  q back';
  }
};

export function frame(game: Game, caps: Caps, hud: Hud): string[] {
  const u = caps.unicode;
  const g = u ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', brick: '▆▆▆', ball: '●', paddle: '▀', life: '♥' } : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', brick: '###', ball: 'o', paddle: '=', life: '*' };
  const rows: Cell[][] = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => ({ ch: ' ' })));

  game.bricks.forEach((row, r) => {
    const color = mix(PALETTE.amber, PALETTE.accent, game.bricks.length > 1 ? 1 - r / (game.bricks.length - 1) : 0);
    row.forEach((standing, c) => {
      if (!standing) return;
      [...g.brick].forEach((ch, i) => (rows[TOP_ROW + r]![c * BRICK_WIDTH + i] = { ch, color }));
    });
  });
  for (let i = 0; i < PADDLE_WIDTH; i++) rows[PADDLE_ROW]![game.paddle + i] = { ch: g.paddle, color: PALETTE.ink };
  const bx = Math.min(WIDTH - 1, Math.max(0, Math.floor(game.ball.x)));
  const by = Math.min(HEIGHT - 1, Math.max(0, Math.floor(game.ball.y)));
  if (game.status !== 'over') rows[by]![bx] = { ch: g.ball, color: PALETTE.ink };

  const lives = game.lives > 0 ? g.life.repeat(game.lives) : '-';
  const score = `${style(caps, 'bold')}${paint(caps, PALETTE.amber, `Score ${game.score}`)}${style(caps, 'reset')}`;
  const rest = paint(caps, PALETTE.muted, `   Lives ${lives}   Wave ${game.wave}   Best ${hud.best}`);
  const edge = (text: string) => paint(caps, PALETTE.faint, text);
  const footer = hud.notice ? paint(caps, PALETTE.accent, hud.notice) : paint(caps, game.status === 'paused' || game.status === 'over' ? PALETTE.amber : PALETTE.faint, hint(game));
  return [
    '',
    `  ${score}${rest}`,
    `  ${edge(g.tl + g.h.repeat(WIDTH) + g.tr)}`,
    ...rows.map((row) => `  ${edge(g.v)}${renderCells(row, caps)}${edge(g.v)}`),
    `  ${edge(g.bl + g.h.repeat(WIDTH) + g.br)}`,
    `  ${footer}`,
  ];
}
