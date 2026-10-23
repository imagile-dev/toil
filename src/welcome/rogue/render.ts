import { blend, fitLine, pal, paint, renderCells, type Rgb, style, type Cell, type TermCaps, visibleLength, wrapLine } from '../term.js';
import { type Card, ending, type Fx, type Game, HEIGHT, LAST_FLOOR, score, visible, WIDTH } from './game.js';
import { accrued, level, PERKS, price, type Progress, rankOf, unlocked } from './perks.js';
import { BOSS, FLOORS, INTRO, PICKUPS, ROBOTS, STAFF, TASK, TITLE } from './story.js';

/**
 * What Two Weeks' Notice looks like, as pure functions of the game, the save
 * and a clock, so every frame (animations included) is a test fixture. The
 * map is plain ASCII on purpose: roguelikes have looked like this since 1980,
 * and it renders the same on every console the company has declined to
 * upgrade. The effects are the part with a budget.
 */

/** What a frame needs of the terminal: its colour depth, whether it draws Unicode, and the menu theme's palette. */
type Caps = Pick<TermCaps, 'colorDepth' | 'unicode' | 'palette'>;

/** Rows of wrapped messages under the map. */
export const LOG_ROWS = 4;

/** The cells a frame needs: the map and its frame, two status lines, the log and the key line. */
export const NEEDS = { columns: WIDTH + 6, rows: HEIGHT + LOG_ROWS + 7 } as const;

/** How wide a window must be for the legend to sit beside the map rather than behind `?`. */
export const LEGEND_WIDTH = 32;
export const WIDE = NEEDS.columns + LEGEND_WIDTH;

/** Ticks an effect plays for after the key that caused it. */
export const FX_FRAMES = 8;

export function refusal(size: { columns: number; rows: number }, movesCursor: boolean): string | undefined {
  if (!movesCursor) return "This console can't redraw in place, which the game needs. Windows Terminal, or any modern terminal, can.";
  if (size.columns < NEEDS.columns || size.rows < NEEDS.rows)
    return `The game needs a window of at least ${NEEDS.columns} by ${NEEDS.rows}; this one is ${size.columns} by ${size.rows}. Make it bigger to play.`;
  return undefined;
}

/** Everything a frame needs besides the game: time, and what the loop knows. */
export interface Hud {
  /** Ticks since the game opened; drives the shimmer, blinking and confetti. */
  clock: number;
  /** Ticks since the last key; effects play while it's under FX_FRAMES. */
  since: number;
  /** Characters of the typed text shown so far: the typewriter. */
  reveal: number;
  /** The window's width, for the legend. */
  columns: number;
  /** `?` was pressed: the legend covers the map. */
  legend: boolean;
  /** A notice that outranks the key line, such as the Ctrl+C warning. */
  notice?: string;
  /** The save, for the ending screen's balance. */
  progress?: Progress;
  /** Why progress isn't being saved: shown on Benefits Enrollment for as long as it's true. */
  warning?: string;
  /**
   * Reduced motion (TOIL_REDUCED_MOTION, as the menu reads it): nothing moves.
   * The loop holds the clock still and types text out at once, and here the
   * map doesn't shake and an effect is shown as its first frame for as long as
   * it would have played.
   */
  still?: boolean;
}

interface Point {
  x: number;
  y: number;
}

/** Maverick's colour: the highlight, most of the way to the ink. */
const maverick = (caps: Caps) => blend(pal(caps).highlight, pal(caps).ink, 0.6);
const PAPER = ['%', '~', '=', '"', "'", '*', '+'];

const bold = (caps: Caps, color: Rgb, text: string) => `${style(caps, 'bold')}${paint(caps, color, text)}${style(caps, 'reset')}`;

/** The title, letter-spaced, with a highlight sweeping across it. */
export function banner(caps: Caps, clock: number): string {
  const letters = [...TITLE].map((ch) => (ch === ' ' ? ' ' : ch)).join(' ');
  const sweep = (clock % (letters.length + 24)) - 6;
  return [...letters]
    .map((ch, i) => {
      if (ch === ' ') return ' ';
      const glow = Math.max(0, 1 - Math.abs(i - sweep) / 5);
      return bold(caps, blend(blend(pal(caps).accent, pal(caps).highlight, i / letters.length), pal(caps).ink, glow), ch);
    })
    .join('');
}

/** The text being typed out right now, so the loop knows when the typewriter has finished. */
export function typedText(g: Game | undefined): string {
  if (!g) return '';
  if (g.status === 'intro') return INTRO[g.page]!.join('\n');
  if (g.status === 'won' || g.status === 'lost') return ending(g).join('\n');
  return g.cards[0] ? g.cards[0].lines.join('\n') : '';
}

/** Paragraphs wrapped to `width`, with only the first `reveal` characters showing. */
function typewrite(paragraphs: string[], width: number, reveal: number): string[][] {
  let left = reveal;
  return paragraphs.map((p) => {
    const out = wrapLine(p, width).map((l) => {
      const shown = l.slice(0, Math.max(0, left));
      left -= l.length;
      return shown;
    });
    left -= 1; // the newline between paragraphs
    return out;
  });
}

const blink = (caps: Caps, hud: Hud) => (Math.floor(hud.clock / 8) % 2 ? paint(caps, pal(caps).highlight, caps.unicode ? '▌' : '_') : ' ');

/** A page of words: the intro, or an ending. */
function page(caps: Caps, hud: Hud, title: string, paragraphs: string[], keys: string, extra: string[] = []): string[] {
  const done = hud.reveal >= paragraphs.join('\n').length;
  const body = typewrite(paragraphs, WIDTH, hud.reveal).flatMap((lines) => [...lines.map((l) => `  ${paint(caps, pal(caps).ink, l)}`), '']);
  if (!done) {
    const last = body.findLastIndex((l) => visibleLength(l) > 2);
    if (last >= 0) body[last] += blink(caps, hud);
  }
  return ['', `  ${banner(caps, hud.clock)}`, '', `  ${bold(caps, pal(caps).highlight, title)}`, '', ...body, ...(done ? extra : []), `  ${paint(caps, pal(caps).faint, done ? keys : 'any key: skip ahead')}`];
}

/** A well-mixed integer from two, so confetti looks random rather than striped. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Paperwork falling down a page, drawn into the blank margins so no word is covered. */
function confetti(lines: string[], caps: Caps, clock: number): string[] {
  const width = NEEDS.columns - 2;
  return lines.map((line, y) => {
    let tail = '';
    // Each column drifts down at its own pace; a hash of the cell decides where paper is.
    for (let x = visibleLength(line); x < width; x++) {
      const fall = Math.floor(clock / (3 + (x % 3)));
      const h = hash(x, y - fall);
      tail += h % 100 < 4 ? paint(caps, [pal(caps).highlight, pal(caps).accent, pal(caps).ink][h % 3]!, PAPER[(h >>> 8) % PAPER.length]!) : ' ';
    }
    return line + tail;
  });
}

/** The ending: how it went, and what it paid in PTO. Winning throws paperwork in the air. */
function endingFrame(g: Game, caps: Caps, hud: Hud): string[] {
  const won = g.status === 'won';
  const earned = accrued({ floor: g.floor, defeated: g.defeated, won });
  const extra = [
    `  ${paint(caps, pal(caps).highlight, `Score ${score(g)}.  PTO accrued: ${earned} hours.`)}${hud.progress ? paint(caps, pal(caps).muted, `  Balance: ${hud.progress.pto}.`) : ''}`,
    `  ${paint(caps, pal(caps).faint, 'Hours are spent at Benefits Enrollment, never taken.')}`,
    '',
  ];
  const lines = page(caps, hud, won ? 'Notice accepted' : 'Notice withdrawn', ending(g), 'any key: Benefits Enrollment   q back', extra);
  return won ? confetti(lines, caps, hud.clock) : lines;
}

/** The rows of Benefits Enrollment: the next run first, then each perk. */
export const LOBBY_ROWS = PERKS.length + 1;

/** Benefits Enrollment, between runs: the next run on row 0, then the perks, one row selected. */
export function lobbyFrame(p: Progress, selected: number, caps: Caps, hud: Hud, last?: { floor: number; earned: number; won: boolean }): string[] {
  const pip = caps.unicode ? { on: '●', off: '○', arrow: '▸' } : { on: '*', off: '.', arrow: '>' };
  const go = selected === 0;
  const stairs = `  ${go ? paint(caps, pal(caps).accent, pip.arrow) : ' '} ${go ? bold(caps, pal(caps).accent, 'Take the stairs again') : paint(caps, pal(caps).highlight, 'Take the stairs again')}${paint(caps, pal(caps).muted, '   start the next run')}`;
  const rows = PERKS.map((perk, n) => {
    const i = n + 1;
    const lv = level(p, perk.id);
    const pips = paint(caps, pal(caps).highlight, pip.on.repeat(lv)) + paint(caps, pal(caps).faint, pip.off.repeat(perk.costs.length - lv));
    const cost = price(p, perk.id);
    const tag = !unlocked(p, perk.id) ? paint(caps, pal(caps).faint, 'locked') : cost === undefined ? paint(caps, pal(caps).muted, 'enrolled') : paint(caps, p.pto >= cost ? pal(caps).highlight : pal(caps).muted, `${cost}h`);
    const open = unlocked(p, perk.id);
    const name = i === selected ? bold(caps, pal(caps).ink, perk.name.padEnd(30)) : paint(caps, open ? pal(caps).muted : pal(caps).faint, perk.name.padEnd(30));
    return `  ${i === selected ? paint(caps, pal(caps).accent, pip.arrow) : ' '} ${name} ${pips}${' '.repeat(4 - perk.costs.length)} ${tag}`;
  });
  const chosen = PERKS[selected - 1];
  const effect = chosen ? `${chosen.effect}.${!unlocked(p, chosen.id) && chosen.unlock ? ` ${chosen.unlock.text}` : ''}` : 'Press Enter to start the next run, with every benefit you have enrolled in.';
  const blurb = chosen ? chosen.blurb : 'Sub-basement 2 again. Your desk is as you left it. Nobody noticed you were gone.';
  const detail = [...wrapLine(effect, WIDTH).map((l) => `  ${paint(caps, pal(caps).ink, l)}`), ...wrapLine(blurb, WIDTH).map((l) => `  ${paint(caps, pal(caps).muted, l)}`)];
  const lastLine = last
    ? `  ${paint(caps, pal(caps).highlight, `Last run: ${last.won ? 'notice delivered' : `stopped on ${FLOORS[last.floor]!.name.split(':')[0]}`}. +${last.earned} hours.`)}`
    : `  ${paint(caps, pal(caps).faint, 'Benefits elected here apply to every run after this one.')}`;
  const footer = hud.notice ? paint(caps, pal(caps).accent, hud.notice) : paint(caps, pal(caps).faint, go ? 'up/down choose  enter take the stairs  q back' : 'up/down choose  enter enrol  space take the stairs  q back');
  return [
    '',
    `  ${banner(caps, hud.clock)}`,
    '',
    `  ${bold(caps, pal(caps).highlight, 'Benefits Enrollment')}${paint(caps, pal(caps).muted, `   ${rankOf(p)}`)}`,
    `  ${paint(caps, pal(caps).ink, `Accrued PTO: ${p.pto} hours.`)}${paint(caps, pal(caps).faint, ' It cannot be taken, only spent.')}`,
    '',
    stairs,
    '',
    `  ${paint(caps, pal(caps).faint, 'Benefits')}`,
    ...rows,
    '',
    ...detail,
    '',
    lastLine,
    `  ${paint(caps, pal(caps).faint, `Runs ${p.runs}  Notices delivered ${p.wins}  Got as far as ${FLOORS[p.best]!.name.split(':')[0]}`)}`,
    ...(hud.warning ? wrapLine(hud.warning, WIDTH + 2).map((l) => `  ${paint(caps, pal(caps).danger, l)}`) : []),
    '',
    ...wrapLine(footer, WIDTH + 2).map((l) => `  ${l}`),
  ];
}

/** A morale bar that drains from the highlight to the danger colour, and glows when topped up. */
function bar(caps: Caps, hp: number, max: number, glow: boolean): string {
  const cells = 12;
  const full = Math.max(0, Math.min(cells, Math.round((Math.max(0, hp) / max) * cells)));
  const [on, off] = caps.unicode ? ['█', '░'] : ['#', '-'];
  return paint(caps, glow ? pal(caps).ink : blend(pal(caps).danger, pal(caps).highlight, Math.max(0, hp) / max), on.repeat(full)) + paint(caps, pal(caps).faint, off.repeat(cells - full));
}

const mobColor = (caps: Caps, robot: boolean) => (robot ? pal(caps).accent : blend(pal(caps).accent, pal(caps).highlight, 0.35));

/** The symbols and this floor's people, beside the map or behind `?`. */
export function legendLines(g: Game, caps: Caps): string[] {
  const kinds = [...STAFF[g.floor]!, ROBOTS[g.floor]!, ...(g.floor === 3 ? [TASK] : []), ...(g.floor === LAST_FLOOR ? [BOSS] : [])];
  const row = (glyph: string, color: Rgb, text: string) => `${bold(caps, color, glyph)} ${paint(caps, pal(caps).muted, text)}`;
  return [
    bold(caps, pal(caps).highlight, 'Legend'),
    row('@', pal(caps).ink, 'you, resigning'),
    row('&', pal(caps).ink, 'your AI agent'),
    row(PICKUPS.agent.glyph, pal(caps).highlight, 'an agent, unclaimed'),
    row(PICKUPS.coffee.glyph, pal(caps).highlight, 'coffee'),
    row(g.floor === LAST_FLOOR ? 'H' : '>', pal(caps).highlight, g.floor === LAST_FLOOR ? 'the HR door' : 'the stairs up'),
    '',
    bold(caps, pal(caps).highlight, 'On this floor'),
    ...[...new Map(kinds.map((k) => [k.glyph, k])).values()].map((k) => row(k.glyph, mobColor(caps, !!k.robot), k.name)),
  ];
}

/** What one effect paints over the map at tick `t`. */
function fxCells(fx: Fx, g: Game, t: number, caps: Caps): Array<Point & Cell> {
  const out: Array<Point & Cell> = [];
  const float = (x: number, y: number, text: string, color: Rgb) => [...text].forEach((ch, i) => out.push({ x: x + i, y: y - 1 - Math.floor(t / 3), ch, color }));
  const p = g.player;
  switch (fx.kind) {
    case 'hit':
      if (t < 2) out.push({ x: fx.x, y: fx.y, ch: '*', color: pal(caps).accent });
      if (t >= 1 && t < 4)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          out.push({ x: fx.x + dx * (t > 2 ? 2 : 1), y: fx.y + dy, ch: '+', color: blend(pal(caps).highlight, pal(caps).faint, t / 4) });
      if (t < 7) float(fx.x, fx.y, `-${fx.amount}`, fx.by === 'you' ? pal(caps).highlight : maverick(caps));
      break;
    case 'down':
      if (t < 7)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + k;
          const r = 1 + t / 2;
          out.push({ x: Math.round(fx.x + Math.cos(a) * r * 2), y: Math.round(fx.y + Math.sin(a) * r), ch: PAPER[(k + t) % PAPER.length]!, color: blend(pal(caps).highlight, pal(caps).faint, t / 7) });
        }
      break;
    case 'shrug':
      if (t < 6) float(fx.x, fx.y, caps.unicode ? '§4.2' : 's4.2', pal(caps).muted);
      break;
    case 'spark':
      if (t < 7)
        for (const [dx, dy] of [
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ] as const)
          out.push({ x: fx.x + dx * (1 + (t % 2)), y: fx.y + dy, ch: caps.unicode ? '✦' : '*', color: blend(maverick(caps), pal(caps).highlight, t / 7) });
      break;
    case 'hurt':
      if (t < 3) out.push({ x: p.x, y: p.y, ch: '@', color: pal(caps).accent });
      if (t < 7) float(p.x, p.y, `-${fx.amount}`, pal(caps).danger);
      break;
    case 'heal':
      if (t < 7) float(p.x + 1, p.y, `+${fx.amount}`, pal(caps).highlight);
      break;
    default:
      break;
  }
  return out;
}

const DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' };
const PLAIN = { tl: '+', tr: '+', bl: '+', br: '+', h: '=', v: '|' };

/** A framed box of lines, `w` wide, for cards and the legend. */
function boxed(caps: Caps, color: Rgb, w: number, lines: string[]): string[] {
  const b = caps.unicode ? DOUBLE : PLAIN;
  const edge = (s: string) => paint(caps, color, s);
  const pad = (s: string) => `${s}${' '.repeat(Math.max(0, w - 2 - visibleLength(s)))}`;
  return [edge(b.tl + b.h.repeat(w - 2) + b.tr), ...lines.map((l) => `${edge(b.v)}${pad(l)}${edge(b.v)}`), edge(b.bl + b.h.repeat(w - 2) + b.br)];
}

const OVERLAY = WIDTH - 6;

/** A card over the map: a floor arriving, a robot introduced, Maverick visiting. */
function cardLines(card: Card, caps: Caps, hud: Hud): string[] {
  const color = card.tone === 'maverick' ? maverick(caps) : card.tone === 'floor' ? pal(caps).highlight : pal(caps).accent;
  const done = hud.reveal >= card.lines.join('\n').length;
  const typed = typewrite(card.lines, OVERLAY - 6, hud.reveal).flat();
  return boxed(caps, color, OVERLAY, [
    '',
    `  ${bold(caps, color, card.heading)}`,
    ...(card.title ? wrapLine(card.title, OVERLAY - 6).map((l) => `  ${paint(caps, pal(caps).muted, l)}`) : []),
    '',
    ...typed.map((l) => `  ${paint(caps, pal(caps).ink, l)}`),
    '',
    `  ${done ? paint(caps, Math.floor(hud.clock / 10) % 2 ? pal(caps).faint : pal(caps).muted, 'any key') : blink(caps, hud)}`,
  ]);
}

export function frame(g: Game, caps: Caps, hud: Hud): string[] {
  if (g.status === 'intro') {
    const last = g.page === INTRO.length - 1;
    return page(caps, hud, g.page === 0 ? 'A resignation, in five floors' : `${g.page + 1} of ${INTRO.length}`, INTRO[g.page]!, last ? 'any key: take the stairs   q back' : 'any key: next   q back');
  }
  if (g.status === 'won' || g.status === 'lost') return endingFrame(g, caps, hud);

  const t = hud.since;
  const now = visible(g);
  // Reduced motion: an effect holds its first frame for as long as it plays.
  const ft = hud.still ? 0 : t;
  const rows: Cell[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => {
      if (!g.seen[y]![x]) return { ch: ' ' };
      const lit = now[y]![x]!;
      const wall = g.map[y]![x] === '#';
      return { ch: wall ? '#' : '.', color: lit ? (wall ? pal(caps).muted : pal(caps).faint) : pal(caps).dim };
    }),
  );
  const put = (x: number, y: number, ch: string, color: Cell['color']) => {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT && g.seen[y]![x]) rows[y]![x] = { ch, color };
  };
  put(g.exit.x, g.exit.y, g.floor === LAST_FLOOR ? 'H' : '>', Math.floor(hud.clock / 12) % 2 ? pal(caps).highlight : pal(caps).ink);
  for (const i of g.pickups) if (now[i.y]![i.x]) put(i.x, i.y, PICKUPS[i.kind].glyph, pal(caps).highlight);
  for (const a of g.agents) put(a.x, a.y, '&', a.context <= 5 && Math.floor(hud.clock / 4) % 2 ? pal(caps).faint : pal(caps).ink);
  for (const m of g.mobs) if (now[m.y]![m.x]) put(m.x, m.y, m.kind.glyph, mobColor(caps, !!m.kind.robot));
  rows[g.player.y]![g.player.x] = { ch: '@', color: g.player.stun ? pal(caps).muted : pal(caps).ink };
  // Effects paint over the map, on cells you can see.
  if (t < FX_FRAMES)
    for (const fx of g.fx) for (const c of fxCells(fx, g, ft, caps)) if (c.x >= 0 && c.x < WIDTH && c.y >= 0 && c.y < HEIGHT && now[c.y]![c.x]) rows[c.y]![c.x] = { ch: c.ch, color: c.color };

  const hurt = t < 5 && g.fx.some((f) => f.kind === 'hurt');
  // A big hit shakes the map a column either way.
  const shake = !hud.still && t < 4 && g.fx.some((f) => f.kind === 'hurt' && f.amount >= 5) ? [2, 0, 1, 0][t]! : 1;
  const box = caps.unicode ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' } : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  const edge = (s: string) => paint(caps, hurt ? blend(pal(caps).danger, pal(caps).faint, t / 5) : pal(caps).faint, s);
  const indent = ' '.repeat(1 + shake);
  const p = g.player;
  const healed = t < 5 && g.fx.some((f) => f.kind === 'heal');
  const status =
    `Morale ${bar(caps, p.hp, p.max, healed)} ${paint(caps, p.hp <= p.max / 4 ? pal(caps).danger : pal(caps).highlight, `${Math.max(0, p.hp)}/${p.max}`)}` +
    paint(caps, pal(caps).muted, `  Grit ${p.power}`) +
    (p.boost ? paint(caps, maverick(caps), `+${p.boost}`) : '') +
    paint(caps, pal(caps).muted, `  Agents ${g.agents.length}  Score ${score(g)}`);
  let map = [
    `${indent}${edge(box.tl + box.h.repeat(WIDTH) + box.tr)}`,
    ...rows.map((row) => `${indent}${edge(box.v)}${renderCells(row, caps)}${edge(box.v)}`),
    `${indent}${edge(box.bl + box.h.repeat(WIDTH) + box.br)}`,
  ];
  // A card, or the legend on a narrow window, sits over the middle of the map.
  const wide = hud.columns >= WIDE;
  const overlay = g.cards[0] ? cardLines(g.cards[0], caps, hud) : hud.legend && !wide ? boxed(caps, pal(caps).highlight, OVERLAY, ['', ...legendLines(g, caps).map((l) => `  ${l}`), '', `  ${paint(caps, pal(caps).faint, '? closes')}`]) : undefined;
  if (overlay) {
    const top = Math.max(1, Math.floor((map.length - overlay.length) / 2));
    map = map.map((line, i) => {
      const o = overlay[i - top];
      return o === undefined ? line : `${indent}${edge(box.v)}  ${o}${' '.repeat(Math.max(0, WIDTH - 2 - visibleLength(o)))}${edge(box.v)}`;
    });
  }
  // With room to spare, the legend stays up beside the map.
  if (wide) {
    const side = legendLines(g, caps);
    map = map.map((line, i) => {
      const s = side[i - 1];
      return s === undefined ? line : `${line}${' '.repeat(Math.max(1, NEEDS.columns - visibleLength(line)))}${s}`;
    });
  }

  const wrapped = g.log.flatMap((m, i) => wrapLine(m, WIDTH + 2).map((text) => ({ text, newest: i === g.log.length - 1 })));
  const log = [...Array.from({ length: LOG_ROWS }, () => ({ text: '', newest: false })), ...wrapped].slice(-LOG_ROWS);
  const keys = wide ? 'hjkl/arrows move  bump to argue  . wait  q back' : 'hjkl/arrows move  bump to argue  ? legend  q back';
  const footer = hud.notice ? paint(caps, pal(caps).accent, hud.notice) : paint(caps, pal(caps).faint, g.cards.length ? 'any key: carry on' : keys);
  return [
    '',
    `  ${bold(caps, pal(caps).highlight, FLOORS[g.floor]!.name)}${paint(caps, pal(caps).faint, `   ${g.floor + 1} of ${LAST_FLOOR + 1}`)}`,
    `  ${fitLine(status, WIDTH + 2)}`,
    ...map,
    ...log.map((l) => `  ${paint(caps, l.newest ? pal(caps).ink : pal(caps).muted, l.text)}`),
    `  ${footer}`,
  ];
}
