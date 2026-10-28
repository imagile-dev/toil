/**
 * Each game theme's particles (#271), on the shared engine (./engine.ts).
 * Plain has none, by design. Every preset is sparse, faint and slow, and the
 * canvas sits behind the page, so a particle passes behind text rather than
 * over it and never over a panel. Colours are the themes' own, drawn for both
 * of its schemes: each preset lists them per scheme (the one the theme opens in
 * is the original, the other the same hues deepened or lightened to show on
 * that scheme's page), and the engine hands the resolved scheme's list to
 * `sprites`.
 *
 * - Crate: dust motes turning in the accent's glow at the top of the page,
 *   brighter inside the glow that theme.css draws in the same place.
 * - Harvest: pixel leaves drifting down and pollen floating up.
 * - Starship: a few stars that twinkle over the drifting starfield, and now
 *   and then a warp streak.
 * - Realm: ash drifting down, and embers rising from the foot of the page.
 * - Sprawl: thin rain falling on a slant, most of it catching the cyan neon
 *   and now and then a streak of magenta.
 * - Frontier: dust on the wind, and steam rising from the foot of the page.
 * - Overworld: fairies as small motes of light, wandering in loops and
 *   pulsing softly, and now and then a firefly in torch gold.
 * Particles are reviewed annually for continued relevance to the business.
 */

import { glow, lifeFade, stamp, type Preset, type Viewport } from './engine.ts';

const TAU = Math.PI * 2;
const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/**
 * How bright Crate's accent glow is at a point, 0 to 1. theme.css paints it
 * as `radial-gradient(circle at 88% 0%, <accent> 0, transparent 60vmax)` on a
 * layer the size of the window, so this is the same linear fall-off from the
 * same centre over the same radius.
 */
export function glowAt(x: number, y: number, w: number, h: number): number {
  const d = Math.hypot(x - 0.88 * w, y) / (0.6 * Math.max(w, h));
  return Math.max(0, 1 - d);
}

export const crate: Preset = {
  density: 2.2,
  max: 34,
  spawn(p, { w, h }, rand) {
    // Most motes are where the glow is; a few hang in the dark around it.
    for (let tries = 0; tries < 6; tries++) {
      p.x = rand() * w;
      p.y = rand() * h;
      if (rand() < 0.25 || glowAt(p.x, p.y, w, h) > 0.35) break;
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
    return lifeFade(p) * (0.12 + 0.43 * glowAt(p.x, p.y, w, h));
  },
  colors: {
    dark: ['232, 234, 237', '194, 224, 255'],
    light: ['90, 98, 112', '27, 102, 196'],
  },
  sprites: (make, c) => [make(8, glow(c[0]!, 0.18)), make(8, glow(c[1]!, 0.18))],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/** Harvest's pixel leaf, 5 by 4, in its own colours (each `"r, g, b"`). */
function leaf(fillRgb: string, veinRgb: string) {
  const fill = `rgb(${fillRgb})`;
  const vein = `rgb(${veinRgb})`;
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
  // Green, amber and rust leaves as fill then vein, then the pollen.
  colors: {
    light: ['79, 154, 42', '47, 107, 31', '201, 147, 42', '138, 82, 38', '184, 84, 28', '122, 46, 14', '214, 164, 30'],
    dark: ['127, 196, 84', '79, 138, 50', '224, 176, 72', '160, 110, 50', '214, 110, 56', '150, 70, 30', '240, 205, 80'],
  },
  sprites: (make, c) => [
    make(10, leaf(c[0]!, c[1]!)),
    make(10, leaf(c[2]!, c[3]!)),
    make(10, leaf(c[4]!, c[5]!)),
    make(4, (ctx, s) => {
      ctx.fillStyle = `rgb(${c[6]})`;
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
  // The glow and streak body, the star's cross and the streak's head, the streak's tail.
  colors: {
    dark: ['127, 227, 255', '230, 241, 255', '54, 214, 255'],
    light: ['0, 112, 143', '16, 48, 80', '0, 140, 180'],
  },
  sprites: (make, c) => [
    make(12, (ctx, s) => {
      glow(c[0]!, 0.12)(ctx, s);
      ctx.fillStyle = `rgba(${c[1]}, 0.85)`;
      ctx.fillRect(s / 2 - 0.5, 1, 1, s - 2);
      ctx.fillRect(1, s / 2 - 0.5, s - 2, 1);
    }),
    make(160, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, 0);
      g.addColorStop(0, `rgba(${c[2]}, 0)`);
      g.addColorStop(0.85, `rgba(${c[0]}, 0.8)`);
      g.addColorStop(1, `rgba(${c[1]}, 1)`);
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

/**
 * Realm: ash drifting down over the page, and now and then an ember rising
 * from the foot of it, its glow wavering like the candle theme.css lights.
 * Kind 0 is an ember, kind 1 a flake of ash.
 */
export const realm: Preset = {
  density: 1.4,
  max: 22,
  spawn(p, { w, h }, rand, initial) {
    p.seed = rand();
    if (rand() < 0.7) {
      p.kind = 1;
      p.x = rand() * w;
      p.y = initial ? rand() * h : -8;
      p.vx = between(rand, -5, 5);
      p.vy = between(rand, 8, 16);
      p.size = between(rand, 3, 6);
      p.life = between(rand, 14, 24);
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
  step(p, dt, { w, h, t }) {
    const sway = p.kind === 1 ? Math.sin(t * 0.7 + p.seed * TAU) * 10 : Math.sin(t * 1.3 + p.seed * TAU) * 8;
    p.x += (p.vx + sway) * dt;
    p.y += p.vy * dt;
    return p.age < p.life && p.y > -10 && p.y < h + 10 && p.x > -10 && p.x < w + 10;
  },
  alpha(p, view: Viewport) {
    if (p.kind === 1) return lifeFade(p, 0.2) * 0.45;
    const flicker = 0.75 + 0.25 * Math.sin(view.t * 9 + p.seed * 40);
    return lifeFade(p, 0.25) * 0.7 * flicker;
  },
  // An ember, then a flake of ash.
  colors: {
    light: ['214, 98, 24', '93, 85, 75'],
    dark: ['240, 130, 50', '189, 174, 146'],
  },
  sprites: (make, c) => [
    make(10, glow(c[0]!, 0.22)),
    make(6, (ctx) => {
      // A flake of ash: a small, uneven grey scrap.
      ctx.fillStyle = `rgb(${c[1]})`;
      ctx.beginPath();
      ctx.moveTo(1, 2);
      ctx.lineTo(4, 0.5);
      ctx.lineTo(5.5, 3);
      ctx.lineTo(3.5, 5.5);
      ctx.lineTo(0.5, 4.5);
      ctx.closePath();
      ctx.fill();
    }),
  ],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/** Sprawl's rain leans with the wind, a little to the right as it falls. */
const SLANT = (12 * Math.PI) / 180;

/**
 * Sprawl: rain on the glass. Each drop is a short streak falling fast on a
 * slant; kind 0 catches the cyan neon, kind 1 the magenta. Faint, so a drop
 * passing behind a panel's edge reads as weather, not as noise.
 */
export const sprawl: Preset = {
  density: 3,
  max: 42,
  spawn(p, { w, h }, rand, initial) {
    p.seed = rand();
    p.kind = rand() < 0.82 ? 0 : 1;
    const speed = between(rand, 520, 760);
    p.vx = Math.sin(SLANT) * speed;
    p.vy = Math.cos(SLANT) * speed;
    // Start above the window, and far enough left that the slant carries a drop across its whole width.
    p.x = between(rand, -0.2, 1) * w;
    p.y = initial ? rand() * h : between(rand, -60, -10);
    p.size = between(rand, 14, 30);
    p.life = 10;
  },
  step(p, dt, { w, h }) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return p.y < h + 40 && p.x < w + 40;
  },
  alpha: (p) => (p.kind === 1 ? 0.28 : 0.22) * (0.6 + 0.4 * p.seed),
  // Cyan then magenta, each as its streak and its bright tip.
  colors: {
    dark: ['63, 240, 255', '234, 246, 255', '255, 46, 136', '255, 200, 225'],
    light: ['0, 120, 145', '10, 40, 70', '184, 15, 98', '90, 8, 60'],
  },
  sprites: (make, c) => [
    [c[0]!, c[1]!],
    [c[2]!, c[3]!],
  ].map(([rgb, tip]) =>
    make(32, (ctx, s) => {
      // A streak down the middle of the sprite, fading in from its tail to a bright tip.
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, `rgba(${rgb}, 0)`);
      g.addColorStop(0.8, `rgba(${rgb}, 0.8)`);
      g.addColorStop(1, `rgba(${tip}, 1)`);
      ctx.fillStyle = g;
      ctx.fillRect(s / 2 - 0.6, 0, 1.2, s);
    }),
  ),
  draw(ctx, p, s) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-SLANT);
    ctx.drawImage(s[p.kind]!, -p.size / 2, -p.size, p.size, p.size);
    ctx.restore();
  },
};

/**
 * Frontier: desert dust blown sideways on the wind, and now and then a puff of
 * steam rising from the foot of the page, swelling and thinning as it climbs.
 * Kind 0 is a mote of dust, kind 1 a puff of steam.
 */
export const frontier: Preset = {
  density: 1.3,
  max: 20,
  spawn(p, { w, h }, rand, initial) {
    p.seed = rand();
    if (rand() < 0.72) {
      p.kind = 0;
      p.x = initial ? rand() * w : -8;
      p.y = rand() * h;
      p.vx = between(rand, 14, 30);
      p.vy = between(rand, -3, 3);
      p.size = between(rand, 3, 5);
      p.life = between(rand, 18, 40);
      p.age = initial ? rand() * p.life * 0.5 : 0;
      return;
    }
    p.kind = 1;
    p.x = rand() * w;
    p.y = initial ? between(rand, 0.35, 1) * h : h + 20;
    p.vx = between(rand, 3, 9);
    p.vy = between(rand, -22, -12);
    p.size = between(rand, 26, 40);
    p.life = between(rand, 10, 18);
  },
  step(p, dt, { w, h, t }) {
    const gust = p.kind === 0 ? Math.sin(t * 0.6 + p.seed * TAU) * 4 : Math.sin(t * 0.5 + p.seed * TAU) * 6;
    p.x += p.vx * dt;
    p.y += (p.vy + gust) * dt;
    // A puff swells as it rises and thins out.
    if (p.kind === 1) p.size = Math.min(110, p.size + dt * 4);
    return p.age < p.life && p.x > -12 && p.x < w + 60 && p.y > -60 && p.y < h + 40;
  },
  alpha(p) {
    return p.kind === 0 ? lifeFade(p, 0.15) * 0.6 : lifeFade(p, 0.3) * 0.55;
  },
  colors: {
    light: ['110, 78, 40', '253, 250, 243'],
    dark: ['205, 185, 152', '214, 204, 184'],
  },
  sprites: (make, c) => [make(6, glow(c[0]!, 0.45)), make(64, glow(c[1]!, 0.15))],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/**
 * Overworld: a few fairies, small motes of light that wander in slow loops
 * and pulse, kind 0 a pale leaf-green mote and kind 1 a torch-gold firefly.
 * Each circles a point that itself drifts, so they hover rather than fall.
 */
export const overworld: Preset = {
  density: 1.1,
  max: 16,
  spawn(p, { w, h }, rand) {
    p.seed = rand();
    p.kind = rand() < 0.7 ? 0 : 1;
    p.x = rand() * w;
    p.y = rand() * h;
    p.vx = between(rand, -6, 6);
    p.vy = between(rand, -5, 3);
    p.size = p.kind === 0 ? between(rand, 8, 12) : between(rand, 5, 8);
    p.life = between(rand, 10, 20);
    p.age = rand() * p.life * 0.5;
  },
  step(p, dt, { w, h, t }) {
    // A loop around a drifting centre: the fairy's figure of eight.
    const a = t * (0.6 + p.seed * 0.5) + p.seed * TAU;
    p.x += (p.vx + Math.cos(a) * 18) * dt;
    p.y += (p.vy + Math.sin(a * 2) * 10) * dt;
    return p.age < p.life && p.x > -12 && p.x < w + 12 && p.y > -12 && p.y < h + 12;
  },
  alpha(p, { t }) {
    const pulse = 0.65 + 0.35 * Math.sin(t * 3 + p.seed * 30);
    return lifeFade(p, 0.2) * (p.kind === 0 ? 0.55 : 0.45) * pulse;
  },
  colors: {
    dark: ['190, 255, 200', '242, 201, 76'],
    light: ['26, 122, 74', '138, 85, 0'],
  },
  sprites: (make, c) => [make(12, glow(c[0]!, 0.25)), make(8, glow(c[1]!, 0.25))],
  draw: (ctx, p, s) => stamp(ctx, s[p.kind], p),
};

/**
 * The presets by name, which a theme names in its theme.json as
 * `"ambient": { "particles": "<name>" }` (#348). A theme that names none,
 * Plain included, has no particles.
 */
export const PRESETS: Record<string, Preset> = { dust: crate, leaves: harvest, stars: starship, embers: realm, rain: sprawl, steam: frontier, fairies: overworld };
