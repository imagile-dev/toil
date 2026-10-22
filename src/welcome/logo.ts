import { type Cell, mix, PALETTE, renderCells, type Rgb, type TermCaps } from './term.js';

/**
 * The toil mark, drawn in a terminal: the badge (a blue tile with its top-right
 * corner cut parallel to the page's fold, holding a dark page with a light fold
 * and the `>_` prompt) in the middle, and six tool dots orbiting it. The
 * badge's geometry is the site's (Logo.astro, favicon.svg); the orbit is the terminal's own, and its static
 * copy is site/public/brand/toil-orbit.svg. test/brand-sync.test.ts holds the
 * three together.
 *
 * It's drawn on a braille canvas: each terminal cell is a 2x4 grid of dots, so
 * 64 units become a 32x16-cell picture with square pixels. Without Unicode it
 * falls back to ASCII. Every frame is a pure function of time (`sceneAt(t)`), so
 * the animation can be tested a frame at a time instead of watched by a
 * committee.
 */

const SIZE = 64;
export const CENTER = 32;

/** The tile: a 52-unit rounded square from (6, 6), corner radius 12, its top-right corner cut 16 units along each edge. */
export const TILE = { x: 6, y: 6, w: 52, r: 12, cut: 16 } as const;

/** The tile as an SVG path, exactly as the site and Toil UI draw it. */
export function tilePath({ x, y, w, r, cut }: { x: number; y: number; w: number; r: number; cut: number } = TILE): string {
  const X = x + w;
  const Y = y + w;
  return `M${x + r} ${y}H${X - cut}L${X} ${y + cut}V${Y - r}A${r} ${r} 0 0 1 ${X - r} ${Y}H${x + r}A${r} ${r} 0 0 1 ${x} ${Y - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/**
 * Where the sheet sits on the tile. The sheet is drawn in its own units (a 23x30
 * page at (20, 17.5), centred on (31.5, 32.5)) and placed by
 * `translate(cx cy) scale(s) translate(-31.5 -32.5)`.
 */
export const SHEET = { s: 1.3, cx: 32, cy: 32.5 } as const;

/** The orbit: the badge shrunk to `k` in the middle, and `n` tool dots of radius `dot` on a ring of radius `r`. */
export const ORBIT = { k: 0.66, r: 27, dot: 3.5, n: 6 } as const;
export const DOT_COLORS: Array<keyof typeof PALETTE> = ['highlight', 'accent', 'ink'];

/** The dots' centres at a turn of `a` radians, clockwise; at rest they sit at 0°, 60°, 120°... */
export function orbitDots(a = 0): Array<{ at: Point; color: Rgb }> {
  return Array.from({ length: ORBIT.n }, (_, i) => {
    const angle = (i / ORBIT.n) * Math.PI * 2 + a;
    return { at: [CENTER + Math.cos(angle) * ORBIT.r, CENTER + Math.sin(angle) * ORBIT.r] as const, color: PALETTE[DOT_COLORS[i % DOT_COLORS.length]!] };
  });
}

/** What a pixel belongs to. Higher wins when two things overlap. */
const enum Layer {
  None = 0,
  Tile = 1,
  Sheet = 3,
  Dot = 5,
}

type Point = readonly [number, number];

/**
 * The timeline, in timeline seconds (splash.ts plays it at SPEED): the badge
 * fades in, the dots pop onto the ring, the cursor blinks twice, then the ring
 * makes half a turn and settles. With the colours repeating every three dots,
 * half a turn lands on a picture identical to the one it left, which is the
 * only kind of reorganisation that never needs a migration plan.
 */
export const SPIN = { from: 1.55, to: 2.75, turns: 0.5 } as const;
/** When the cursor is off: two blinks before the turn. */
export const BLINKS = [[1.0, 1.15], [1.3, 1.45]] as const;
/** The animation's length. After this, every frame is the still. */
export const DURATION = 3.2;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (v: number) => {
  const x = clamp(v);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
/** Overshoots a little, then settles: how the dots pop onto the ring. */
const backOut = (v: number) => {
  const x = clamp(v);
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

/** A state of the picture at one moment, before it becomes characters. */
export interface Scene {
  /** 0 to 1: the badge fading in from the background. */
  badge: number;
  /** Each dot's size, 0 to a little over 1 while it pops. */
  dots: number[];
  cursor: boolean;
  /** The ring's turn, in radians. The badge stays put. */
  spin: number;
}

/** The scene at time t; see the timeline constants above. */
export function sceneAt(t: number): Scene {
  return {
    badge: clamp(t / 0.35),
    dots: Array.from({ length: ORBIT.n }, (_, i) => backOut((t - 0.4 - i * 0.07) / 0.22)),
    cursor: !BLINKS.some(([from, to]) => t > from && t < to),
    // Half a turn lands exactly at rest; π in floating point is close enough to
    // nudge a dot across a cell, and "close enough" isn't a sign-off.
    spin: t > SPIN.from && t < SPIN.to ? easeInOut((t - SPIN.from) / (SPIN.to - SPIN.from)) * SPIN.turns * Math.PI * 2 : 0,
  };
}

/** Inside the tile, in badge units. */
function inTile(x: number, y: number): boolean {
  const { x: x0, y: y0, w, r, cut } = TILE;
  const X = x0 + w;
  const Y = y0 + w;
  if (x < x0 || x > X || y < y0 || y > Y) return false;
  if (x - y > X - cut - y0) return false;
  const corner = (cx: number, cy: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  if (x < x0 + r && y < y0 + r) return corner(x0 + r, y0 + r);
  if (x < x0 + r && y > Y - r) return corner(x0 + r, Y - r);
  if (x > X - r && y > Y - r) return corner(X - r, Y - r);
  return true;
}

/** Inside the page, in the sheet's own units: a 23x30 sheet with 3-unit corners, its fold cut away on the diagonal. */
function inSheet(x: number, y: number): boolean {
  if (x < 20 || x > 43 || y < 17.5 || y > 47.5) return false;
  if (x - 36 > y - 17.5) return false;
  const corner = (cx: number, cy: number) => (x - cx) ** 2 + (y - cy) ** 2 <= 9;
  if (x < 23 && y < 20.5) return corner(23, 20.5);
  if (x < 23 && y > 44.5) return corner(23, 44.5);
  if (x > 40 && y > 44.5) return corner(40, 44.5);
  return true;
}

/** Inside the fold, in the sheet's own units: the triangle below the cut, from (36, 17.5) to (43, 24.5). */
function inFold(x: number, y: number): boolean {
  return x >= 36 && y <= 24.5 && x - 36 <= y - 17.5;
}

const distToSegment = ([x, y]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax;
  const dy = by - ay;
  const k = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - k * dx, y - ay - k * dy);
};

/** The `>` and the cursor, drawn on the page. */
const CHEVRON: Array<[Point, Point]> = [
  [[24.5, 27.5], [29.5, 31.8]],
  [[29.5, 31.8], [24.5, 36.1]],
];
const CURSOR: [Point, Point] = [[31.8, 40], [38, 40]];

function draw(scene: Scene): { px: Uint8Array; color: Rgb[] } {
  const px = new Uint8Array(SIZE * SIZE);
  const color: Rgb[] = new Array(SIZE * SIZE);
  const sheet = new Uint8Array(SIZE * SIZE);
  for (let iy = 0; iy < SIZE; iy++) {
    for (let ix = 0; ix < SIZE; ix++) {
      const i = iy * SIZE + ix;
      // The pixel's centre, in badge units (the badge is shrunk to ORBIT.k about the centre),
      const bx = CENTER + (ix + 0.5 - CENTER) / ORBIT.k;
      const by = CENTER + (iy + 0.5 - CENTER) / ORBIT.k;
      // and in the sheet's own units.
      const sx = 31.5 + (bx - SHEET.cx) / SHEET.s;
      const sy = 32.5 + (by - SHEET.cy) / SHEET.s;
      if (scene.badge <= 0) continue;
      if (inSheet(sx, sy)) {
        // The page is dark, so it's the terminal's own background: only the
        // fold and the prompt on it are drawn, the fold and `>` in ink and the
        // cursor in the accent, as the site's badge has them.
        sheet[i] = 1;
        const ink = inFold(sx, sy) || CHEVRON.some(([a, b]) => distToSegment([sx, sy], a, b) < 1.5);
        const cursor = scene.cursor && distToSegment([sx, sy], ...CURSOR) < 1.5;
        if (ink || cursor) {
          px[i] = Layer.Sheet;
          color[i] = mix(PALETTE.bg, ink ? PALETTE.ink : PALETTE.accent, scene.badge);
        }
      } else if (inTile(bx, by)) {
        px[i] = Layer.Tile;
        color[i] = mix(PALETTE.bg, PALETTE.accent, scene.badge);
      }
    }
  }
  // A one-pixel gap between the tile and the page. A braille cell takes one
  // colour, so without it the ink fold and the blue tile would share cells
  // along the cut and the fold would bleed into the tile.
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (px[i] !== Layer.Tile) continue;
    const x = i % SIZE;
    const near = (x > 0 && sheet[i - 1]) || (x < SIZE - 1 && sheet[i + 1]) || (i >= SIZE && sheet[i - SIZE]) || (i < SIZE * (SIZE - 1) && sheet[i + SIZE]);
    if (near) px[i] = Layer.None;
  }
  // The dots, each with a clear gap around it.
  orbitDots(scene.spin).forEach((dot, n) => {
    const r = ORBIT.dot * scene.dots[n]!;
    if (r <= 0.2) return;
    const [dx, dy] = dot.at;
    for (let iy = Math.floor(dy - r - 1); iy <= dy + r + 1; iy++) {
      for (let ix = Math.floor(dx - r - 1); ix <= dx + r + 1; ix++) {
        if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) continue;
        if (Math.hypot(ix + 0.5 - dx, iy + 0.5 - dy) <= r) {
          px[iy * SIZE + ix] = Layer.Dot;
          color[iy * SIZE + ix] = dot.color;
        }
      }
    }
  });
  return { px, color };
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
  const { px, color } = draw(sceneAt(t));
  const rows: Cell[][] = [];
  for (let cy = 0; cy < SIZE / 4; cy++) {
    const out: Cell[] = [];
    for (let cx = 0; cx < SIZE / 2; cx++) {
      let bits = 0;
      let top = Layer.None;
      let shades: Rgb[] = [];
      const count = new Map<Layer, number>();
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (cy * 4 + dy) * SIZE + cx * 2 + dx;
          const layer = px[i]! as Layer;
          if (layer === Layer.None) continue;
          bits |= BRAILLE[dy]![dx]!;
          count.set(layer, (count.get(layer) ?? 0) + 1);
          if (layer > top) {
            top = layer;
            shades = [];
          }
          if (layer === top) shades.push(color[i]!);
        }
      }
      if (bits === 0) {
        out.push({ ch: ' ' });
        continue;
      }
      const glyph = caps.unicode ? String.fromCodePoint(0x2800 + bits) : asciiGlyph(top, count.get(top) ?? 0);
      out.push({ ch: glyph, color: average(shades) });
    }
    rows.push(out);
  }
  return rows;
}

function average(colors: Rgb[]): Rgb {
  const sum = colors.reduce<[number, number, number]>((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]);
  return [Math.round(sum[0] / colors.length), Math.round(sum[1] / colors.length), Math.round(sum[2] / colors.length)];
}

function asciiGlyph(layer: Layer, count: number): string {
  switch (layer) {
    case Layer.Dot:
      return 'O';
    case Layer.Sheet:
      return count >= 6 ? '#' : ':';
    default:
      return count >= 6 ? '+' : '.';
  }
}
