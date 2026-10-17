import { type Cell, mix, PALETTE, renderCells, type Rgb, type TermCaps } from './term.js';

/**
 * The toil mark, drawn in a terminal: the terminal is the hub, and three
 * branches leave each side of it for six tools on the outer ring, at 0° and 38°
 * either side of horizontal. Same 64-unit geometry as the site's Logo.astro.
 *
 * It's drawn on a braille canvas: each terminal cell is a 2x4 grid of dots, so
 * 64 units become a 32x16-cell picture with square pixels and a ring that is
 * actually round. Without Unicode it falls back to ASCII, which is rounder in
 * spirit than in shape.
 *
 * Every frame is a pure function of time, `frameAt(t)`, so the animation can be
 * tested a frame at a time instead of watched by a committee.
 */

const SIZE = 64;
export const CENTER = 32;
export const RING = 27;

/** What a pixel belongs to. Higher wins when two things overlap. */
const enum Layer {
  None = 0,
  Line = 1,
  Signal = 2,
  Body = 3,
  Fold = 4,
  Tool = 5,
}

type Point = readonly [number, number];
type Curve = readonly [Point, Point, Point, Point];

// The six branches, as cubic Béziers from the terminal's edge to each tool.
export const BRANCHES: Curve[] = [
  [[20, 32], [14.5, 32], [15.1, 18.8], [10.7, 15.4]],
  [[20, 32], [15, 32], [10, 32], [5, 32]],
  [[20, 32], [14.5, 32], [15.1, 45.2], [10.7, 48.6]],
  [[44, 32], [49.5, 32], [48.9, 18.8], [53.3, 15.4]],
  [[44, 32], [49, 32], [54, 32], [59, 32]],
  [[44, 32], [49.5, 32], [48.9, 45.2], [53.3, 48.6]],
];

export const TOOLS: Array<{ at: Point; color: Rgb }> = [
  { at: [10.7, 15.4], color: PALETTE.amber },
  { at: [5, 32], color: PALETTE.accent },
  { at: [10.7, 48.6], color: PALETTE.ink },
  { at: [53.3, 15.4], color: PALETTE.ink },
  { at: [59, 32], color: PALETTE.accent },
  { at: [53.3, 48.6], color: PALETTE.amber },
];

/**
 * The timeline, in timeline seconds (splash.ts plays it at SPEED): the
 * entrance, then the command runs twice, then the ring spins twice with its
 * branches and lands where it started. Every step is in triplicate somewhere;
 * here, twice will do.
 */
/** When each command's signal leaves the terminal. */
export const SIGNALS = [1.15, 1.85] as const;
export const SPIN = { from: 2.4, to: 3.6, turns: 2 } as const;
/** The animation's length. After this, every frame is the still. */
export const DURATION = 4.05;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - (1 - clamp(v)) ** 3;
const easeInOut = (v: number) => {
  const x = clamp(v);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
/** Overshoots a little, then settles: how the tools pop onto the ring. */
const backOut = (v: number) => {
  const x = clamp(v);
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

function bezier([p0, p1, p2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** A state of the picture at one moment, before it becomes characters. */
interface Scene {
  ring: number;
  branches: number;
  tools: number[];
  signal: number | null;
  bump: number;
  cursor: boolean;
  body: number;
  /** Rotation of the ring, its branches and tools, in radians. The terminal stays put. */
  spin: number;
}

/** The scene at time t; see the timeline constants above. */
export function sceneAt(t: number): Scene {
  const e = t;
  // Each command: the cursor types two keystrokes, the signal runs, the tools bump.
  let signal: number | null = null;
  let bump = 0;
  let cursor = true;
  for (const s of SIGNALS) {
    const run = (t - s) / 0.32;
    if (run > 0 && run < 1.25) signal = run;
    if (t > s + 0.27 && t < s + 0.47) bump = Math.sin(((t - s - 0.27) / 0.2) * Math.PI);
    if ((t > s - 0.2 && t < s - 0.13) || (t > s - 0.07 && t < s - 0.01)) cursor = false;
  }
  return {
    ring: easeOut(e / 0.6),
    branches: easeOut((e - 0.25) / 0.55),
    tools: TOOLS.map((_, i) => backOut((e - 0.72 - i * 0.06) / 0.22)),
    signal,
    bump,
    cursor,
    body: clamp(e / 0.3),
    // Whole turns land exactly at rest: 4π in floating point is close enough
    // to nudge a pixel across a cell, and "close enough" isn't a sign-off.
    spin: t > SPIN.from && t < SPIN.to ? easeInOut((t - SPIN.from) / (SPIN.to - SPIN.from)) * SPIN.turns * Math.PI * 2 : 0,
  };
}

/** A point turned about the logo's centre. */
function turn([x, y]: Point, a: number): Point {
  if (a === 0) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [CENTER + (x - CENTER) * c - (y - CENTER) * s, CENTER + (x - CENTER) * s + (y - CENTER) * c];
}

class Canvas {
  readonly px = new Uint8Array(SIZE * SIZE);
  readonly tool = new Int8Array(SIZE * SIZE).fill(-1);

  plot(x: number, y: number, layer: Layer, tool = -1): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) return;
    const i = iy * SIZE + ix;
    if (layer >= this.px[i]!) {
      this.px[i] = layer;
      this.tool[i] = tool;
    }
  }

  /** Clears pixels: the stroke cut out of the terminal for `>_`, the gap around a tool. */
  erase(x: number, y: number): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) return;
    this.px[iy * SIZE + ix] = Layer.None;
  }

  /** A round brush, so lines have the stroke width of the SVG. */
  dab(x: number, y: number, r: number, paint: (x: number, y: number) => void): void {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= r * r) paint(x + dx, y + dy);
      }
    }
  }
}

function draw(scene: Scene): Canvas {
  const c = new Canvas();
  const line = (x: number, y: number) => c.plot(x, y, Layer.Line);

  // The ring draws clockwise from the top.
  const steps = 360;
  for (let s = 0; scene.ring > 0 && s <= steps * scene.ring; s++) {
    const a = -Math.PI / 2 + (s / steps) * Math.PI * 2;
    c.dab(CENTER + Math.cos(a) * RING, CENTER + Math.sin(a) * RING, 0.9, line);
  }

  // While it spins, a bright comet rides the ring so the turn reads at a glance.
  if (scene.spin > 0 && scene.spin < SPIN.turns * Math.PI * 2) {
    for (let s = 0; s <= 40; s++) {
      const a = -Math.PI / 2 + scene.spin - (s / 40) * 0.9;
      c.dab(CENTER + Math.cos(a) * RING, CENTER + Math.sin(a) * RING, s < 12 ? 1.3 : 1, (x, y) => c.plot(x, y, Layer.Signal));
    }
  }

  // Branches grow out of the terminal, and turn with the ring.
  for (const curve of BRANCHES) {
    for (let s = 0; scene.branches > 0 && s <= 120 * scene.branches; s++) {
      const [x, y] = turn(bezier(curve, s / 120), scene.spin);
      c.dab(x, y, 0.8, line);
    }
  }

  // The signal: a short bright run travelling down every branch at once.
  if (scene.signal !== null) {
    const head = Math.min(1, scene.signal);
    const tail = Math.max(0, scene.signal - 0.35);
    for (const curve of BRANCHES) {
      for (let s = Math.floor(tail * 120); s <= head * 120; s++) {
        const [x, y] = turn(bezier(curve, s / 120), scene.spin);
        c.dab(x, y, 1.1, (px, py) => c.plot(px, py, Layer.Signal));
      }
    }
  }

  // The terminal: a sheet with a folded corner, `>_` cut out of it. It fades
  // in with the entrance and isn't there at all before it starts.
  for (let y = 17; scene.body > 0 && y < 48; y++) {
    for (let x = 20; x < 43; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (cy < 17.5 || cy > 47.5) continue;
      // The top-right corner is cut on the diagonal; what's left of the
      // 7-unit square there is the fold.
      if (cx - 36 > cy - 17.5) continue;
      const fold = cx >= 36 && cy <= 24.5;
      c.plot(x, y, fold ? Layer.Fold : Layer.Body);
    }
  }
  const cut = (from: Point, to: Point) => {
    for (let s = 0; s <= 40; s++) {
      const x = from[0] + ((to[0] - from[0]) * s) / 40;
      const y = from[1] + ((to[1] - from[1]) * s) / 40;
      c.dab(x, y, 1.1, (px, py) => c.erase(px, py));
    }
  };
  cut([24.5, 27.5], [29.5, 31.8]);
  cut([29.5, 31.8], [24.5, 36.1]);
  if (scene.cursor) cut([31.8, 40], [38, 40]);

  // Tools pop onto the ring, each with a gap around it like the SVG's stroke.
  TOOLS.forEach((tool, i) => {
    const r = 3.9 * scene.tools[i]! + scene.bump * 0.9;
    if (r <= 0.2) return;
    const [tx, ty] = turn(tool.at, scene.spin);
    c.dab(tx, ty, r + 1.2, (x, y) => c.erase(x, y));
    c.dab(tx, ty, r, (x, y) => c.plot(x, y, Layer.Tool, i));
  });
  return c;
}

/** Braille dot bits for a pixel at (dx, dy) inside its 2x4 cell. */
const BRAILLE = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/** The logo at time t, as 16 lines of 32 cells. */
export function logoFrame(t: number, caps: Pick<TermCaps, 'colorDepth' | 'unicode'>): string[] {
  return logoCells(t, caps).map((row) => renderCells(row, caps));
}

/** The logo at time t as cells, for the splash to compose. */
export function logoCells(t: number, caps: Pick<TermCaps, 'unicode'>): Cell[][] {
  const scene = sceneAt(t);
  const c = draw(scene);
  const rows: Cell[][] = [];
  for (let cy = 0; cy < SIZE / 4; cy++) {
    const out: Cell[] = [];
    for (let cx = 0; cx < SIZE / 2; cx++) {
      let bits = 0;
      let top = Layer.None;
      let topTool = -1;
      const count = new Map<Layer, number>();
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (cy * 4 + dy) * SIZE + cx * 2 + dx;
          const layer = c.px[i]! as Layer;
          if (layer === Layer.None) continue;
          bits |= BRAILLE[dy]![dx]!;
          count.set(layer, (count.get(layer) ?? 0) + 1);
          if (layer > top) {
            top = layer;
            topTool = c.tool[i]!;
          }
        }
      }
      if (bits === 0) {
        out.push({ ch: ' ' });
        continue;
      }
      const glyph = caps.unicode ? String.fromCodePoint(0x2800 + bits) : asciiGlyph(top, count);
      out.push({ ch: glyph, color: layerColor(top, topTool, scene) });
    }
    rows.push(out);
  }
  return rows;
}

function layerColor(layer: Layer, tool: number, scene: Scene): Rgb {
  switch (layer) {
    case Layer.Tool:
      return TOOLS[tool]?.color ?? PALETTE.amber;
    case Layer.Signal:
      return PALETTE.amber;
    case Layer.Body:
      return mix(PALETTE.bg, PALETTE.ink, scene.body);
    case Layer.Fold:
      return PALETTE.accent;
    default:
      return PALETTE.accent;
  }
}

function asciiGlyph(layer: Layer, count: Map<Layer, number>): string {
  switch (layer) {
    case Layer.Tool:
      return 'O';
    case Layer.Signal:
      return '*';
    case Layer.Fold:
      return '%';
    case Layer.Body:
      return (count.get(Layer.Body) ?? 0) >= 6 ? '#' : ':';
    default:
      return '.';
  }
}
