/**
 * The one particle engine every theme shares (#271): a single canvas behind
 * the page, a few dozen sprites at most, drawn at 30 frames a second. It stops
 * when the tab is hidden and never starts when motion is unwelcome (the caller,
 * src/ambient/Ambient.tsx, checks). A theme supplies a `Preset`: how many
 * particles, where each starts, how it moves and what it looks like. Each
 * sprite is painted once into a small offscreen canvas and stamped from then
 * on, so a frame is a clear and a few dozen `drawImage` calls.
 * Throughput is capped at thirty frames a second, in line with the frame budget.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since it spawned, and how long it lives. */
  age: number;
  life: number;
  /** Which of the preset's kinds it is, and a per-particle random number for variety. */
  kind: number;
  seed: number;
  size: number;
}

export interface Viewport {
  w: number;
  h: number;
  /** Seconds since the engine started, for anything that pulses. */
  t: number;
}

export type Sprites = HTMLCanvasElement[];
/** Paints one sprite of the given CSS size; the engine scales it for the screen. */
export type MakeSprite = (size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) => HTMLCanvasElement;

export interface Preset {
  /** Particles per 100,000 px² of viewport, and the most there will ever be. */
  density: number;
  max: number;
  /** Places a new particle. `initial` is true for the first fill, which may start anywhere on screen. */
  spawn(p: Particle, view: Viewport, rand: () => number, initial: boolean): void;
  /** Moves it on by `dt` seconds; false when it has left or lived out its life and should respawn. */
  step(p: Particle, dt: number, view: Viewport): boolean;
  /** Its opacity now, 0 to 1. Zero skips the draw. */
  alpha(p: Particle, view: Viewport): number;
  /** Its colours for each scheme, each `"r, g, b"` as `glow()` takes; `sprites` gets the resolved scheme's list. */
  colors: Record<'light' | 'dark', readonly string[]>;
  /** The sprites, made once when the engine starts; `draw` picks one. */
  sprites(make: MakeSprite, colors: readonly string[]): Sprites;
  draw(ctx: CanvasRenderingContext2D, p: Particle, sprites: Sprites, view: Viewport): void;
}

const FRAME_MS = 1000 / 30;
/** Past this, a frame is treated as a stall (a background tab, a debugger) rather than a jump. */
const MAX_DT = 0.1;
const MAX_DPR = 1.5;

export function particleCount(preset: Preset, w: number, h: number): number {
  return Math.max(0, Math.min(preset.max, Math.round((preset.density * w * h) / 100_000)));
}

export function blank(): Particle {
  return { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, kind: 0, seed: 0, size: 1 };
}

/** One tick for every particle, respawning the ones that are done. Pure apart from `rand`, so a test can drive it. */
export function stepAll(preset: Preset, particles: Particle[], dt: number, view: Viewport, rand: () => number) {
  for (const p of particles) {
    p.age += dt;
    if (!preset.step(p, dt, view)) {
      Object.assign(p, blank());
      preset.spawn(p, view, rand, false);
    }
  }
}

/** Fills the list to the count the viewport calls for, or trims it. */
export function fill(preset: Preset, particles: Particle[], view: Viewport, rand: () => number) {
  const want = particleCount(preset, view.w, view.h);
  while (particles.length < want) {
    const p = blank();
    preset.spawn(p, view, rand, true);
    particles.push(p);
  }
  particles.length = want;
}

/**
 * Runs a preset on a canvas until the returned function is called. The canvas
 * fills its box; the engine matches its pixels to that box on resize.
 */
export function startParticles(canvas: HTMLCanvasElement, preset: Preset, scheme: 'light' | 'dark'): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const make: MakeSprite = (size, paint) => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      paint(g, size);
    }
    return c;
  };
  const sprites = preset.sprites(make, preset.colors[scheme]);
  const particles: Particle[] = [];
  const view: Viewport = { w: 0, h: 0, t: 0 };
  const rand = Math.random;

  const resize = () => {
    view.w = canvas.clientWidth;
    view.h = canvas.clientHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    fill(preset, particles, view, rand);
  };

  // Each frame books the next one a frame-length later and only then asks for
  // an animation frame, so the page wakes 30 times a second, not at the
  // display's refresh rate with most wakes skipped.
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  let running = false;
  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, MAX_DT) : 0;
    last = now;
    view.t += dt;
    stepAll(preset, particles, dt, view, rand);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    for (const p of particles) {
      const a = preset.alpha(p, view);
      if (a <= 0.004) continue;
      ctx.globalAlpha = Math.min(1, a);
      preset.draw(ctx, p, sprites, view);
    }
    ctx.globalAlpha = 1;
    // A few ms early, so the animation frame after the timer lands on the 30 fps beat rather than a vsync past it.
    if (running) timer = setTimeout(book, Math.max(0, FRAME_MS - 4 - (performance.now() - now)));
  };
  const book = () => {
    timer = undefined;
    raf = requestAnimationFrame(frame);
  };

  const run = () => {
    if (running || document.hidden) return;
    running = true;
    last = 0;
    book();
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = undefined;
  };
  const onVisibility = () => (document.hidden ? pause() : run());

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  run();
  return () => {
    pause();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

/** Fades in over the first `edge` of a life and out over the last. */
export function lifeFade(p: Particle, edge = 0.2): number {
  const f = p.age / p.life;
  if (f <= 0 || f >= 1) return 0;
  return Math.min(1, f / edge, (1 - f) / edge);
}

/** A soft round glow in one colour (`"r, g, b"`): a bright core fading to the same colour, transparent, at the edge. */
export function glow(rgb: string, core = 0.25): (ctx: CanvasRenderingContext2D, size: number) => void {
  return (ctx, size) => {
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(core, `rgba(${rgb}, 0.9)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };
}

/** Stamps a sprite centred on the particle at its size. */
export function stamp(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement | undefined, p: Particle) {
  if (!sprite) return;
  ctx.drawImage(sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
}
