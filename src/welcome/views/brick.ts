import { LIVES } from '../brick/game.js';
import { NEEDS } from '../brick/render.js';
import { PALETTE, paint } from '../term.js';
import type { View } from '../view.js';

/**
 * Brick breaker, for the minutes a build takes. This screen is the lobby:
 * the keys, this session's scores, and a row that hands the terminal to the
 * game (brick/play.ts) until q brings it back. Scores live in memory and are
 * gone when the menu closes, so there's no leaderboard to audit.
 */

export const brickView: View = {
  title: () => 'Brick breaker',
  body: (caps, p) => {
    const scores = p.session.brick;
    return [
      paint(caps, PALETTE.ink, `Clear the wall with ${LIVES} lives. Each wall you clear comes back a row taller and a little faster.`),
      '',
      paint(caps, PALETTE.muted, 'Left/right or a/d move the paddle, space launches, p pauses, q or Esc comes back here.'),
      paint(caps, PALETTE.faint, `It needs a window of at least ${NEEDS.columns} by ${NEEDS.rows}. Nothing is saved, and nothing leaves this terminal.`),
      ...(scores ? ['', paint(caps, PALETTE.amber, `Last game ${scores.last}   Best this session ${scores.best}`)] : []),
    ];
  },
  items: (p) => [{ label: p.session.brick ? 'Play again' : 'Play', hint: '', action: { play: 'brick' } }],
};
