/**
 * Each game theme's particles (#271), on the shared engine (./engine.ts).
 * Plain has none, by design. Every preset is sparse, faint and slow, and the
 * canvas sits behind the page, so a particle passes behind text rather than
 * over it and never over a panel. Colours are the themes' own.
 *
 * - Crate: dust motes turning in the warehouse's light shaft, brighter inside
 *   the beam that theme.css draws at the same angle.
 * - Harvest: pixel leaves drifting down and pollen floating up.
 * - Starship: a few stars that twinkle over the drifting starfield, and now
 *   and then a warp streak.
 * - Realm: embers rising from the foot of the page, and a rune that glows and
 *   fades in the margin when the window is wide enough to have one.
 * Particles are reviewed annually for continued relevance to the business.
 */

import { glow, lifeFade, stamp, type Preset, type Viewport } from './engine.ts';

const TAU = Math.PI * 2;
const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/**
 * How bright Crate's light shaft is at a point, 0 to 1. The shaft is the
 * band theme.css paints with `linear-gradient(115deg, ...)` peaking at 64%,
 * so this measures along the same gradient line, the way CSS does.
 */
export function shaft(x: number, y: number, w: number, h: number): number {
  const a = (115 * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const t = ((x - w / 2) * dx + (y - h / 2) * dy) / length + 0.5;
  return Math.exp(-(((t - 0.64) / 0.07) ** 2));
}

export const crate: Preset = {
  density: 2.2,
  max: 34,
  spawn(p, { w, h }, rand) {
    // Most motes are where the light is; a few hang in the dark around it.
    for (let tries = 0; tries < 6; tries++) {
      p.x = rand() * w;
      p.y = rand() * h;
      if (rand() < 0.25 || shaft(p.x, p.y, w, h) > 0.35) break;
    }
    p.vx = between(rand, -5, 5);
    p.vy = between(rand, -4, 2);
    p.life = between(rand, 9, 18);
    p.age = rand() * p.life * 0.5;
    p.kind = rand() < 0.7 ? 0 : 1;
    p.seed = rand();
    p.size = between(rand, 3, 6);
  },
  step(p, dt, { w, h, t }) {
    p.x += (p.vx + Math.sin(t * 0.5 + p.seed * TAU) * 3) * dt;
    p.y += (p.vy + Math.cos(t * 0.4 + p.seed * TAU) * 2) * dt;
    return p.age < p.life && p.x > -10 && p.x < w + 10 && p.y > -10 && p.y < h + 10;
  },
  alpha(p, { w, h }) {
    return lifeFade(p) * (0.12 + 0.43 * shaft(p.x, p.y, w, h));
  },
  sprites: (make) => [make(8, glow('246, 241, 233', 0.18)), make(8, glow('255, 184, 77', 0.18))],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/** Harvest's pixel leaf, 5 by 4, in its own colours. */
function leaf(fill: string, vein: string) {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    const u = size / 5;
    const rows = ['..XX.', '.XXXX', 'XVVX.', '.X...'];
    rows.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '.') return;
        ctx.fillStyle = c === 'V' ? vein : fill;
        ctx.fillRect(x * u, y * u, u, u);
      }),
    );
  };
}

export const harvest: Preset = {
  density: 1.3,
  max: 20,
  spawn(p, { w, h }, rand, initial) {
    p.kind = rand() < 0.45 ? 3 : Math.floor(rand() * 3);
    p.seed = rand();
    p.x = rand() * w;
    if (p.kind === 3) {
      // Pollen floats up from the fields.
      p.y = initial ? rand() * h : h + 6;
      p.vx = between(rand, 4, 10);
      p.vy = between(rand, -14, -7);
      p.size = 4;
    } else {
      p.y = initial ? rand() * h : -12;
      p.vx = between(rand, -6, 6);
      p.vy = between(rand, 16, 26);
      p.size = 10;
    }
    p.life = 60;
  },
  step(p, dt, { w, h, t }) {
    const sway = p.kind === 3 ? 6 : 22;
    p.x += (p.vx + Math.sin(t * 0.9 + p.seed * TAU) * sway) * dt;
    p.y += p.vy * dt;
    return p.y > -16 && p.y < h + 16 && p.x > -16 && p.x < w + 16;
  },
  alpha: (p) => (p.kind === 3 ? 0.55 : 0.5),
  sprites: (make) => [
    make(10, leaf('#4f9a2a', '#2f6b1f')),
    make(10, leaf('#c9932a', '#8a5226')),
    make(10, leaf('#b8541c', '#7a2e0e')),
    make(4, (ctx, s) => {
      ctx.fillStyle = '#e0b52c';
      ctx.fillRect(0, 0, s, s);
    }),
  ],
  draw(ctx, p, s, { t }) {
    if (p.kind === 3) return stamp(ctx, s[3], p);
    // Leaves flip a quarter turn at a time, as a sprite would.
    const turn = Math.floor((t * 1.2 + p.seed * 4) % 4);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.rotate((turn * Math.PI) / 2);
    ctx.drawImage(s[p.kind]!, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  },
};

/** Starship's warp streaks run along the starfield's drift, down and to the right. */
const WARP = (28 * Math.PI) / 180;

export const starship: Preset = {
  density: 1.2,
  max: 18,
  spawn(p, { w, h }, rand) {
    p.seed = rand();
    if (rand() < 0.2) {
      // A streak waits off stage for a few seconds, then crosses fast.
      p.kind = 1;
      p.x = between(rand, -0.3, 0.7) * w;
      p.y = between(rand, -0.2, 0.6) * h;
      p.vx = Math.cos(WARP) * between(rand, 700, 1000);
      p.vy = Math.sin(WARP) * between(rand, 700, 1000);
      p.size = between(rand, 90, 170);
      p.life = between(rand, 3, 8);
    } else {
      p.kind = 0;
      p.x = rand() * w;
      p.y = rand() * h;
      p.life = between(rand, 6, 14);
      p.age = rand() * p.life;
      p.size = between(rand, 7, 11);
    }
  },
  step(p, dt, { w, h }) {
    if (p.kind === 1) {
      const flight = p.age - (p.life - 0.6);
      if (flight > 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      return p.age < p.life && p.x < w + 200 && p.y < h + 200;
    }
    return p.age < p.life;
  },
  alpha(p) {
    if (p.kind === 1) return p.age > p.life - 0.6 ? 0.45 : 0;
    const pulse = Math.max(0, Math.sin((p.age / p.life) * TAU * 2 + p.seed * TAU));
    return lifeFade(p, 0.15) * (0.15 + 0.6 * pulse ** 3);
  },
  sprites: (make) => [
    make(12, (ctx, s) => {
      glow('127, 227, 255', 0.12)(ctx, s);
      ctx.fillStyle = 'rgba(230, 241, 255, 0.85)';
      ctx.fillRect(s / 2 - 0.5, 1, 1, s - 2);
      ctx.fillRect(1, s / 2 - 0.5, s - 2, 1);
    }),
    make(160, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, 0);
      g.addColorStop(0, 'rgba(54, 214, 255, 0)');
      g.addColorStop(0.85, 'rgba(127, 227, 255, 0.8)');
      g.addColorStop(1, 'rgba(230, 241, 255, 1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, s / 2 - 1, s, 2);
    }),
  ],
  draw(ctx, p, s) {
    if (p.kind === 0) return stamp(ctx, s[0], p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(WARP);
    ctx.drawImage(s[1]!, -p.size, -p.size / 2, p.size, p.size);
    ctx.restore();
  },
};

/** Five runes, each a few strokes on a 10 by 14 grid. */
const RUNES = [
  [[3, 1, 3, 13], [3, 4, 8, 1], [3, 7, 8, 4]],
  [[3, 1, 3, 13], [3, 1, 8, 4], [8, 4, 3, 7], [3, 7, 8, 13]],
  [[5, 1, 5, 13], [1, 5, 5, 9], [9, 5, 5, 9]],
  [[5, 1, 5, 13], [5, 6, 1, 1], [5, 6, 9, 1]],
  [[5, 1, 9, 5], [9, 5, 5, 9], [5, 9, 1, 5], [1, 5, 5, 1], [1, 13, 5, 9], [5, 9, 9, 13]],
];

/** The page's margin beside the 1280px content column; runes appear only where there is room. */
export const realmMargin = (w: number) => (w - Math.min(w, 1280)) / 2;

export const realm: Preset = {
  density: 1.4,
  max: 20,
  spawn(p, view, rand, initial) {
    const { w, h } = view;
    p.seed = rand();
    const margin = realmMargin(w);
    if (rand() < 0.12 && margin >= 64) {
      p.kind = 1 + Math.floor(rand() * RUNES.length);
      p.x = rand() < 0.5 ? between(rand, 20, margin - 20) : w - between(rand, 20, margin - 20);
      p.y = between(rand, 0.2, 0.9) * h;
      p.size = 28;
      p.life = between(rand, 6, 9);
      return;
    }
    p.kind = 0;
    p.x = rand() * w;
    p.y = initial ? between(rand, 0.4, 1) * h : h + 8;
    p.vx = between(rand, -6, 6);
    p.vy = between(rand, -34, -18);
    p.size = between(rand, 5, 9);
    p.life = between(rand, 8, 16);
  },
  step(p, dt, { w, t }) {
    if (p.kind > 0) return p.age < p.life;
    p.x += (p.vx + Math.sin(t * 1.3 + p.seed * TAU) * 8) * dt;
    p.y += p.vy * dt;
    return p.age < p.life && p.y > -10 && p.x > -10 && p.x < w + 10;
  },
  alpha(p, view: Viewport) {
    if (p.kind > 0) return 0.24 * Math.sin(Math.PI * Math.min(1, p.age / p.life));
    const flicker = 0.75 + 0.25 * Math.sin(view.t * 9 + p.seed * 40);
    return lifeFade(p, 0.25) * 0.7 * flicker;
  },
  sprites: (make) => [
    make(10, glow('214, 98, 24', 0.22)),
    ...RUNES.map((strokes) =>
      make(28, (ctx) => {
        ctx.strokeStyle = '#7a1f1f';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(214, 98, 24, 0.9)';
        ctx.shadowBlur = 6;
        ctx.translate(4, 0);
        ctx.scale(2, 2);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of strokes) {
          ctx.moveTo(x1!, y1!);
          ctx.lineTo(x2!, y2!);
        }
        ctx.stroke();
      }),
    ),
  ],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/** The presets by theme name. A theme not listed here, Plain included, has no particles. */
export const PRESETS: Record<string, Preset> = { crate, harvest, starship, realm };
