import { freshProgress, type Loadout, loadout } from './perks.js';
import {
  AGENT_GONE,
  AGENT_LINES,
  BOSS,
  BRIEFING,
  type Bureaucrat,
  DECISIONS,
  FLOORS,
  FORM,
  HR_DOOR,
  INTRO,
  LOST,
  MAVERICK,
  PICKUPS,
  ROBOTS,
  STAFF,
  STUCK,
  TASK,
  VERBS,
  WON,
} from './story.js';

/**
 * Two Weeks' Notice, as data. `start` and `act` are pure: a game and a key in,
 * the next game out, with every random number drawn from a seed the game
 * carries. So a whole run replays from its seed and its keys, and every
 * fight is a unit test. Each `act` also lists what just happened as effects
 * (`fx`) for render.ts to animate, and queues cards (a robot's introduction,
 * a visit from Maverick) that wait for a key. Like any good process, it does
 * nothing at all until someone acts.
 */

export const WIDTH = 56;
export const HEIGHT = 18;
/** How far a bureaucrat notices you, given a clear line. */
export const NOTICE = 9;
/** Messages kept for the log. */
export const LOG = 3;

export type Input = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right' | 'wait';

export interface Point {
  x: number;
  y: number;
}

export interface Mob extends Point {
  kind: Bureaucrat;
  hp: number;
  /** Set once a recurring meeting has come back, or PATCHWORK.EXE has patched himself, so each only happens once. */
  spent?: boolean;
  /** CHECKBOX-3000's framework: arguments it shrugs off before any land. */
  shield?: number;
  /** A forwarded task that is real; the rest are noise. */
  real?: boolean;
}

/** An AI agent on your side: it follows you and argues with whoever it is next to. */
export interface Agent extends Point {
  /** Turns left before its context window fills up. */
  context: number;
}

export interface Pickup extends Point {
  kind: keyof typeof PICKUPS;
}

/** A card waits on screen for a key: a robot's introduction, a floor's arrival, Maverick. */
export interface Card {
  tone: 'floor' | 'robot' | 'boss' | 'maverick';
  heading: string;
  title?: string;
  lines: string[];
}

/** Something that just happened, for the renderer to animate. */
export type Fx =
  | { kind: 'hit'; x: number; y: number; amount: number; by: 'you' | 'agent' }
  | { kind: 'hurt'; amount: number }
  | { kind: 'down'; x: number; y: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'shrug'; x: number; y: number }
  | { kind: 'spark'; x: number; y: number }
  | { kind: 'climb' };

export type Status = 'intro' | 'play' | 'won' | 'lost';

export interface Game {
  status: Status;
  /** The intro page showing, while status is intro. */
  page: number;
  /** The random generator's state; every draw advances it. */
  rng: number;
  perks: Loadout;
  /** Which floor, from 0 (the sub-basement) to the last (HR). */
  floor: number;
  /** One string per row: '#' wall, '.' floor. */
  map: string[];
  /** Cells you have seen, so the map you've walked stays drawn. */
  seen: boolean[][];
  player: Point & { hp: number; max: number; power: number; stun: number; boost: number };
  mobs: Mob[];
  agents: Agent[];
  pickups: Pickup[];
  /** The stairwell up, or the HR door on the last floor. */
  exit: Point;
  log: string[];
  cards: Card[];
  fx: Fx[];
  /** Robots already introduced. */
  met: string[];
  /** Maverick's visits left on this floor. */
  maverick: number;
  /** Turns spent on this floor. */
  here: number;
  /** Bureaucrats dealt with this run, for the score. */
  defeated: number;
  turns: number;
}

export const LAST_FLOOR = FLOORS.length - 1;

/** mulberry32: small, fast, and the same on every machine, which is the point. */
function random(g: Game): number {
  g.rng = (g.rng + 0x6d2b79f5) >>> 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const int = (g: Game, lo: number, hi: number) => lo + Math.floor(random(g) * (hi - lo + 1));
const pick = <T>(g: Game, list: readonly T[]): T => list[Math.floor(random(g) * list.length)]!;

export interface StartOptions {
  /** The perks bought so far; a fresh save by default. */
  perks?: Loadout;
  /** Straight to the first floor, for someone who has read the story before. */
  skipIntro?: boolean;
}

export function start(seed: number, o: StartOptions = {}): Game {
  const perks = o.perks ?? loadout(freshProgress());
  const g: Game = {
    status: 'intro',
    page: 0,
    rng: seed >>> 0,
    perks,
    floor: 0,
    map: [],
    seen: [],
    player: { x: 0, y: 0, hp: perks.morale, max: perks.morale, power: perks.grit, stun: 0, boost: 0 },
    mobs: [],
    agents: [],
    pickups: [],
    exit: { x: 0, y: 0 },
    log: [],
    cards: [],
    fx: [],
    met: [],
    maverick: 0,
    here: 0,
    defeated: 0,
    turns: 0,
  };
  if (o.skipIntro) begin(g);
  return g;
}

/** Off the intro and onto the first floor, with an agent if the licence was bought. */
function begin(g: Game): void {
  g.status = 'play';
  enter(g, g.perks.floor);
  if (g.perks.agent) g.agents.push({ ...besideOf(g, g.player), context: g.perks.context });
}

export const tileAt = (g: Game, x: number, y: number): string => g.map[y]?.[x] ?? '#';
export const isWall = (g: Game, x: number, y: number) => tileAt(g, x, y) === '#';
export const mobAt = (g: Game, x: number, y: number) => g.mobs.find((m) => m.x === x && m.y === y);
export const agentAt = (g: Game, x: number, y: number) => g.agents.find((a) => a.x === x && a.y === y);
/** How the log names someone: "the Scrum Master", but a robot or MUNDANE by name alone. */
export function called(kind: Bureaucrat, start = false): string {
  if (kind.robot) return kind.name;
  return `${start ? 'The' : 'the'} ${kind.name}`;
}

const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

const centre = (r: Room): Point => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/** Rooms joined in order by L-shaped corridors, so every room reaches the next and the exit is always reachable. */
function carve(g: Game): Room[] {
  const grid = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => '#'));
  const rooms: Room[] = [];
  for (let tries = 0; tries < 200 && rooms.length < 9; tries++) {
    const w = int(g, 5, 12);
    const h = int(g, 3, 5);
    const room = { x: int(g, 1, WIDTH - w - 2), y: int(g, 1, HEIGHT - h - 2), w, h };
    const clash = rooms.some((r) => room.x <= r.x + r.w + 1 && r.x <= room.x + room.w + 1 && room.y <= r.y + r.h + 1 && r.y <= room.y + room.h + 1);
    if (!clash) rooms.push(room);
  }
  // Left to right, so the climb crosses the floor rather than doubling back.
  rooms.sort((a, b) => a.x - b.x);
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y]![x] = '.';
  for (let i = 1; i < rooms.length; i++) {
    const a = centre(rooms[i - 1]!);
    const b = centre(rooms[i]!);
    const corner = random(g) < 0.5 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    for (const [from, to] of [
      [a, corner],
      [corner, b],
    ] as const) {
      for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) grid[from.y]![x] = '.';
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) grid[y]![from.x] = '.';
    }
  }
  g.map = grid.map((row) => row.join(''));
  return rooms;
}

const occupied = (g: Game, p: Point) =>
  (p.x === g.player.x && p.y === g.player.y) || (p.x === g.exit.x && p.y === g.exit.y) || !!mobAt(g, p.x, p.y) || !!agentAt(g, p.x, p.y) || g.pickups.some((i) => i.x === p.x && i.y === p.y);

/** A free floor cell in one of `rooms`, away from the player, the exit and everyone else. */
function freeCell(g: Game, rooms: Room[], away = 3): Point {
  for (let tries = 0; tries < 500; tries++) {
    const r = pick(g, rooms);
    const p = { x: int(g, r.x, r.x + r.w - 1), y: int(g, r.y, r.y + r.h - 1) };
    if (!isWall(g, p.x, p.y) && !occupied(g, p) && chebyshev(p, g.player) > away) return p;
  }
  throw new Error("Two Weeks' Notice could not find a free cell on a floor, which is a bug in the floor plan.");
}

const STEPS: Record<Exclude<Input, 'wait'>, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  'up-left': { x: -1, y: -1 },
  'up-right': { x: 1, y: -1 },
  'down-left': { x: -1, y: 1 },
  'down-right': { x: 1, y: 1 },
};

/** The `n`th open, empty cell around `p`, or `p` itself on a floor too cramped to have one. */
function besideOf(g: Game, p: Point, n = 0): Point {
  const open = Object.values(STEPS)
    .map((d) => ({ x: p.x + d.x, y: p.y + d.y }))
    .filter((c) => !isWall(g, c.x, c.y) && !mobAt(g, c.x, c.y) && !agentAt(g, c.x, c.y) && !(c.x === g.player.x && c.y === g.player.y));
  return open[n % Math.max(1, open.length)] ?? p;
}

const spawn = (kind: Bureaucrat, at: Point): Mob => ({ ...at, kind, hp: kind.hp, ...(kind.trait === 'framework' ? { shield: 3 } : {}) });

/** Builds floor `floor`: rooms, the stairs (or HR door), its staff and robot, and a few things worth picking up. */
function enter(g: Game, floor: number): void {
  g.floor = floor;
  g.mobs = [];
  g.pickups = [];
  g.here = 0;
  g.maverick = g.perks.maverick;
  const rooms = carve(g);
  const first = centre(rooms[0]!);
  g.player.x = first.x;
  g.player.y = first.y;
  g.exit = centre(rooms[rooms.length - 1]!);
  // Agents follow you up the stairs and arrive beside you; their context keeps running down.
  g.agents = g.agents.map((a, i) => ({ ...a, ...besideOf(g, first, i) }));
  g.seen = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => false));
  const later = rooms.length > 1 ? rooms.slice(1) : rooms;
  for (let i = 0; i < 3 + Math.floor(floor / 2); i++) g.mobs.push(spawn(pick(g, STAFF[floor]!), freeCell(g, later)));
  g.mobs.push(spawn(ROBOTS[floor]!, freeCell(g, later, 8)));
  if (floor === LAST_FLOOR) {
    const door = g.exit;
    const guard = [
      { x: door.x - 1, y: door.y },
      { x: door.x + 1, y: door.y },
      { x: door.x, y: door.y - 1 },
    ].find((p) => !isWall(g, p.x, p.y) && !occupied(g, p));
    g.mobs.push(spawn(BOSS, guard ?? freeCell(g, later)));
  }
  for (let i = 0; i < 2; i++) g.pickups.push({ ...freeCell(g, later), kind: 'coffee' });
  g.pickups.push({ ...freeCell(g, later), kind: 'agent' });
  const text = FLOORS[floor]!;
  g.cards.push({ tone: 'floor', heading: text.name, lines: [text.arrive] });
  say(g, text.arrive);
  look(g);
}

function say(g: Game, line: string): void {
  g.log = [...g.log, line].slice(-LOG);
}

/** True when nothing solid stands on the line between two cells. */
export function clearLine(g: Game, a: Point, b: Point): boolean {
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  while (x !== b.x || y !== b.y) {
    if ((x !== a.x || y !== a.y) && isWall(g, x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return true;
}

/** What the player can see right now. */
export function visible(g: Game): boolean[][] {
  const out = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => false));
  const { x: px, y: py } = g.player;
  const r = g.perks.sight;
  for (let y = Math.max(0, py - r); y <= Math.min(HEIGHT - 1, py + r); y++)
    for (let x = Math.max(0, px - r); x <= Math.min(WIDTH - 1, px + r); x++) if ((x - px) ** 2 + (y - py) ** 2 <= r * r + r && clearLine(g, g.player, { x, y })) out[y]![x] = true;
  return out;
}

/** Updates what you have seen, and introduces any robot you see for the first time. */
function look(g: Game): void {
  const now = visible(g);
  g.seen = g.seen.map((row, y) => row.map((s, x) => s || now[y]![x]!));
  for (const m of g.mobs) {
    const robot = m.kind.robot;
    if (!robot || g.met.includes(m.kind.name) || !now[m.y]![m.x]) continue;
    g.met.push(m.kind.name);
    g.cards.push({ tone: m.kind.trait === 'boss' ? 'boss' : 'robot', heading: m.kind.name, title: robot.title, lines: [robot.quote] });
  }
}

/** One key. Off the floor (the intro, an ending) any key turns the page, and a card on screen takes the key that dismisses it. */
export function act(game: Game, input: Input): Game {
  const g = structuredClone(game);
  g.fx = [];
  if (g.status === 'intro') {
    g.page += 1;
    if (g.page >= INTRO.length) begin(g);
    return g;
  }
  if (g.status !== 'play') return g;
  if (g.cards.length) {
    g.cards = g.cards.slice(1);
    return g;
  }

  if (g.player.stun > 0) {
    g.player.stun -= 1;
    say(g, STUCK);
  } else if (input !== 'wait') {
    const d = STEPS[input];
    const to = { x: g.player.x + d.x, y: g.player.y + d.y };
    const mob = mobAt(g, to.x, to.y);
    const agent = agentAt(g, to.x, to.y);
    if (mob) strike(g, mob);
    else if (agent) {
      // Walking into your own agent swaps places with it.
      agent.x = g.player.x;
      agent.y = g.player.y;
      g.player.x = to.x;
      g.player.y = to.y;
    } else if (isWall(g, to.x, to.y)) return game; // A wall costs nothing; it is load-bearing.
    else {
      g.player.x = to.x;
      g.player.y = to.y;
      const item = g.pickups.find((i) => i.x === to.x && i.y === to.y);
      if (item) take(g, item);
      if (to.x === g.exit.x && to.y === g.exit.y && arrive(g)) return g;
    }
  }
  g.turns += 1;
  g.here += 1;
  for (const a of [...g.agents]) help(g, a);
  for (const m of [...g.mobs]) {
    if (g.status !== 'play') break;
    if (!g.mobs.includes(m)) continue;
    turn(g, m);
    if (m.kind.trait === 'fast' && g.mobs.includes(m) && g.status === 'play') turn(g, m);
  }
  if (g.status === 'play') visit(g);
  look(g);
  return g;
}

function strike(g: Game, mob: Mob): void {
  // ALIGN.SYS, standing by, carries your point to everyone, minus the part that made it correct.
  const aligner = g.mobs.find((m) => m.kind.trait === 'garble' && chebyshev(m, g.player) <= 1);
  if (aligner && random(g) < 0.35) {
    g.fx.push({ kind: 'shrug', x: mob.x, y: mob.y });
    return say(g, `ALIGN.SYS summarizes your point to ${called(mob.kind)}, minus the part that made it correct.`);
  }
  if (mob.shield) {
    mob.shield -= 1;
    g.fx.push({ kind: 'shrug', x: mob.x, y: mob.y });
    return say(g, `"Your argument is out of scope, per section 4.2." CHECKBOX-3000 has ${mob.shield} section${mob.shield === 1 ? '' : 's'} left to cite.`);
  }
  const boost = g.player.boost > 0 ? 3 : 0;
  if (boost) g.player.boost -= 1;
  const dmg = 2 + Math.floor(random(g) * g.player.power) + boost;
  mob.hp -= dmg;
  g.fx.push({ kind: 'hit', x: mob.x, y: mob.y, amount: dmg, by: 'you' });
  if (mob.hp > 0) return say(g, `You ${pick(g, VERBS)} ${called(mob.kind)}.`);
  finish(g, mob);
}

/** A bureaucrat out of arguments, whoever made them: gone, rescheduled, or patched. */
function finish(g: Game, mob: Mob): void {
  if (mob.kind.trait === 'patch' && !mob.spent) {
    mob.spent = true;
    mob.hp = 6;
    g.fx.push({ kind: 'spark', x: mob.x, y: mob.y });
    return say(g, 'PATCHWORK.EXE applies a hotfix to himself. It is not a fix. It holds.');
  }
  g.defeated += 1;
  if (mob.kind.trait === 'recurring' && !mob.spent) {
    const at = freeCell(g, [{ x: 1, y: 1, w: WIDTH - 2, h: HEIGHT - 2 }], 6);
    Object.assign(mob, at, { hp: mob.kind.hp, spent: true });
    g.fx.push({ kind: 'down', x: mob.x, y: mob.y });
    return say(g, 'The Recurring Meeting ends. It has been rescheduled, somewhere else on this floor.');
  }
  g.mobs = g.mobs.filter((m) => m !== mob);
  g.fx.push({ kind: 'down', x: mob.x, y: mob.y });
  // A small win. Morale is built on these, and on nothing else.
  heal(g, 2);
  say(g, mob.kind.defeat);
}

function heal(g: Game, n: number): number {
  const got = Math.min(n, g.player.max - g.player.hp);
  g.player.hp += got;
  if (got > 0) g.fx.push({ kind: 'heal', amount: got });
  return got;
}

function take(g: Game, item: Pickup): void {
  g.pickups = g.pickups.filter((i) => i !== item);
  if (item.kind === 'coffee') return say(g, PICKUPS.coffee.line(heal(g, g.perks.coffee)));
  g.agents.push({ ...besideOf(g, g.player), context: g.perks.context });
  g.fx.push({ kind: 'spark', x: g.player.x, y: g.player.y });
  say(g, PICKUPS.agent.line());
}

/** On the stairs or at the HR door. True when the floor changed or the run ended. */
function arrive(g: Game): boolean {
  if (g.floor < LAST_FLOOR) {
    // Every flight climbed hardens you: a little morale back, and a little more grit.
    heal(g, 5);
    g.player.power += 1;
    enter(g, g.floor + 1);
    g.fx.push({ kind: 'climb' });
    return true;
  }
  if (g.mobs.some((m) => m.kind.trait === 'boss')) {
    say(g, HR_DOOR.locked);
    return false;
  }
  g.status = 'won';
  return true;
}

/** Maverick drops in when morale runs low, or when a floor drags on, while this floor has visits left. */
function visit(g: Game): void {
  if (g.maverick <= 0) return;
  const low = g.player.hp < g.player.max * 0.5;
  if (!low && g.here < 60) return;
  g.maverick -= 1;
  if (!low) g.here = 0;
  // A pep talk only when it would do something; otherwise a diagram, a lesson or a friend.
  const move = low ? pick(g, ['pep', 'teach', 'agent'] as const) : pick(g, ['diagram', 'teach', 'agent'] as const);
  if (move === 'diagram') g.seen = g.seen.map((row) => row.map(() => true));
  if (move === 'pep') heal(g, 10);
  if (move === 'teach') g.player.boost = 4;
  if (move === 'agent') g.agents.push({ ...besideOf(g, g.player), context: g.perks.context });
  g.fx.push({ kind: 'spark', x: g.player.x, y: g.player.y });
  g.cards.push({ tone: 'maverick', heading: MAVERICK.name, title: MAVERICK.title, lines: [MAVERICK[move]] });
  say(g, MAVERICK[move]);
}

function hurt(g: Game, dmg: number, line: string): void {
  g.player.hp -= dmg;
  g.fx.push({ kind: 'hurt', amount: dmg });
  say(g, line);
  if (g.player.hp <= 0) g.status = 'lost';
}

/** One bureaucrat's turn: hit you if it can, come at you if it has seen you, otherwise drift. */
function turn(g: Game, m: Mob): void {
  if (m.kind.trait === 'grows' && m.hp < 20) m.hp += 1;
  const p = g.player;
  if (chebyshev(m, p) === 1) {
    if (m.kind.trait === 'briefing' && p.stun === 0 && random(g) < 0.35 * g.perks.nag) {
      p.stun = 1;
      return say(g, `${BRIEFING} ${pick(g, DECISIONS)}`);
    }
    if (m.kind.trait === 'boss' && p.stun === 0 && random(g) < 0.3 * g.perks.nag) {
      p.stun = 1;
      return say(g, FORM);
    }
    const miss = m.kind.trait === 'flaky' ? 0.5 : m.kind.trait === 'fast' ? 0.45 : m.kind.trait === 'task' && !m.real ? 1 : 0.15;
    if (random(g) < miss) {
      if (m.kind.trait === 'task') say(g, 'The task is a reminder about another task. It does nothing.');
      return;
    }
    const dmg = 1 + Math.floor(random(g) * m.kind.attack);
    return hurt(g, dmg, random(g) < 0.55 ? pick(g, m.kind.lines) : `${called(m.kind, true)} costs you ${dmg} morale.`);
  }
  const range = m.kind.trait === 'boss' ? 5 : NOTICE;
  const sees = chebyshev(m, p) <= range && clearLine(g, m, p);
  // OVERSEER.YAML forwards a task every few turns while he can see you. One in five is real.
  if (m.kind.trait === 'forwards' && sees && g.here % 4 === 0 && g.mobs.filter((x) => x.kind.trait === 'task').length < 4) {
    const at = besideOf(g, m);
    if (at !== m) {
      g.mobs.push({ ...spawn(TASK, at), real: random(g) < 0.2 });
      say(g, pick(g, m.kind.lines));
    }
  }
  if (sees) {
    const sx = Math.sign(p.x - m.x);
    const sy = Math.sign(p.y - m.y);
    for (const d of [
      { x: sx, y: sy },
      { x: sx, y: 0 },
      { x: 0, y: sy },
    ]) {
      if (step(g, m, d)) return;
    }
    return;
  }
  if (m.kind.trait !== 'boss' && random(g) < 0.25) step(g, m, pick(g, Object.values(STEPS)));
}

/** One agent's turn: argue with a neighbouring bureaucrat, or keep up with you. */
function help(g: Game, a: Agent): void {
  a.context -= 1;
  if (a.context <= 0) {
    g.agents = g.agents.filter((x) => x !== a);
    g.fx.push({ kind: 'down', x: a.x, y: a.y });
    return say(g, AGENT_GONE);
  }
  const target = g.mobs.find((m) => chebyshev(m, a) === 1);
  if (target) {
    if (target.shield) {
      target.shield -= 1;
      g.fx.push({ kind: 'shrug', x: target.x, y: target.y });
      return say(g, `Your agent cites a policy at CHECKBOX-3000. He cites section 4.2 back.`);
    }
    const dmg = 2 + Math.floor(random(g) * 3);
    target.hp -= dmg;
    g.fx.push({ kind: 'hit', x: target.x, y: target.y, amount: dmg, by: 'agent' });
    if (target.hp > 0) return say(g, pick(g, AGENT_LINES).replace('{name}', called(target.kind)).replace('{Name}', called(target.kind, true)));
    return finish(g, target);
  }
  if (chebyshev(a, g.player) <= 1) return;
  const sx = Math.sign(g.player.x - a.x);
  const sy = Math.sign(g.player.y - a.y);
  for (const d of [
    { x: sx, y: sy },
    { x: sx, y: 0 },
    { x: 0, y: sy },
  ])
    if (step(g, a, d)) return;
}

function step(g: Game, m: Point, d: Point): boolean {
  if (d.x === 0 && d.y === 0) return false;
  const x = m.x + d.x;
  const y = m.y + d.y;
  if (isWall(g, x, y) || mobAt(g, x, y) || agentAt(g, x, y) || (x === g.player.x && y === g.player.y)) return false;
  m.x = x;
  m.y = y;
  return true;
}

/** The ending's lines, for the screen that shows it. */
export const ending = (g: Game): string[] => (g.status === 'won' ? WON : LOST(FLOORS[g.floor]!.name));

/** The run's score: floors climbed count most, then everyone you got past. */
export const score = (g: Game): number => g.floor * 100 + g.defeated * 10 + (g.status === 'won' ? 500 : 0);
