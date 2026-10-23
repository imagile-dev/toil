import type { Ornament } from './themes/types.js';
import type { Palette, Rgb } from './term.js';

/**
 * What the splash draws around the badge in each theme (#427), as particles
 * on the logo's 64-unit braille canvas: a dot, or a stroke from `at` to `to`.
 * Each ornament is a pure function of time that settles by the end of the
 * splash (DURATION in logo.ts), so the still frame, which reduced motion and
 * NO_COLOR draw, is the picture the animation lands on. Nothing loops, and
 * nothing moves once the splash is done: the terminal gets a theme's spirit
 * in three seconds, not an ambient effect.
 *
 * The badge sits in the middle, about 17 units each way; ornaments keep to
 * the ring and the edges so they never cover the prompt. Orbit, Plain's and
 * Crate's, is the ring of tool dots logo.ts draws itself.
 * Movement on this canvas is pre-approved, provided it stops by 3.2 seconds.
 */

export type Point = readonly [number, number];

export interface Particle {
  at: Point;
  /** The far end of a stroke: a streak, a stalk, a raindrop. Absent for a dot. */
  to?: Point;
  /** The dot's radius, or the stroke's half-width, in canvas units. */
  r: number;
  color: Rgb;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - (1 - clamp(v)) ** 3;
const easeInOut = (v: number) => {
  const x = clamp(v);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
const backOut = (v: number) => {
  const x = clamp(v);
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

const C = 32;
const polar = (angle: number, radius: number): Point => [C + Math.cos(angle) * radius, C + Math.sin(angle) * radius];

/** Harvest: six stalks come up along the foot of the badge, each with two leaves and a head. */
function crops(t: number, p: Palette): Particle[] {
  const xs = [5, 14, 23, 41, 50, 59];
  return xs.flatMap((x, i) => {
    const g = easeOut((t - 0.35 - i * 0.12) / 0.8);
    if (g <= 0) return [];
    // The middle two stand under the badge, so they stay shorter.
    const h = (i === 2 || i === 3 ? 9 : 13) * g;
    const top: Point = [x, 63 - h];
    const leaf = 63 - h * 0.55;
    return [
      { at: [x, 63], to: top, r: 0.7, color: p.accent },
      { at: [x - 1.8, leaf], r: 1.2 * g, color: p.accent },
      { at: [x + 1.8, leaf - 1.5], r: 1.2 * g, color: p.accent },
      { at: top, r: 1.7 * backOut((t - 0.9 - i * 0.12) / 0.3), color: p.highlight },
    ];
  });
}

/** Starship: the jump. Stars rush out from behind the badge as streaks, then hold as points on the ring. */
function warp(t: number, p: Palette): Particle[] {
  const colours = [p.ink, p.highlight, p.accent];
  return Array.from({ length: 10 }, (_, i) => {
    const angle = ((i * 36 + 17) / 180) * Math.PI;
    const rest = 26 + ((i * 7) % 6);
    const k = clamp((t - 0.35 - i * 0.03) / 0.9);
    if (k <= 0) return [];
    const near = 16 + (rest - 16) * easeOut(k);
    const length = 12 * Math.sin(Math.PI * k);
    return [{ at: polar(angle, near), ...(length > 0.5 ? { to: polar(angle, Math.min(near + length, 34)) } : {}), r: 1.1, color: colours[i % 3]! }];
  }).flat();
}

/** Realm: embers drift up the sides from below, and come to rest where they cooled. */
function embers(t: number, p: Palette): Particle[] {
  const xs = [4, 9, 13, 55, 59, 51, 7, 57];
  const rests = [20, 40, 12, 30, 48, 18, 55, 8];
  return xs.flatMap((x, i) => {
    const k = (t - 0.3 - i * 0.15) / 1.8;
    if (k <= 0) return [];
    const e = easeOut(k);
    const y = 68 - (68 - rests[i]!) * e;
    const sway = Math.sin(k * 7 + i) * 1.5 * (1 - e);
    return [{ at: [x + sway, y], r: 1.9 - 0.4 * e, color: i % 2 ? p.highlight : p.accent }];
  });
}

/** Sprawl: rain down the glass at either side, each drop a streak that shortens as it lands. */
function rain(t: number, p: Palette): Particle[] {
  const xs = [3, 8, 12, 52, 57, 61, 5, 59, 10];
  const rests = [14, 34, 52, 22, 44, 8, 60, 58, 26];
  return xs.flatMap((x, i) => {
    const k = (t - 0.25 - i * 0.1) / 1.1;
    if (k <= 0) return [];
    const e = easeOut(k);
    const y = rests[i]! - (rests[i]! + 12) * (1 - e);
    const length = 2 + 6 * (1 - e);
    return [{ at: [x, y], to: [x - length * 0.35, y - length], r: 0.6, color: i % 3 === 1 ? p.accent : p.highlight }];
  });
}

/** Frontier: puffs of steam rise off the corners and widen as they go. */
function steam(t: number, p: Palette): Particle[] {
  const xs = [7, 57, 5, 59, 8, 56];
  const rests = [12, 16, 30, 34, 48, 50];
  return xs.flatMap((x, i) => {
    const k = (t - 0.3 - i * 0.18) / 1.6;
    if (k <= 0) return [];
    const e = easeOut(k);
    // Each puff drifts outward as it rises, away from the badge.
    return [{ at: [x + (x < C ? -1.5 : 1.5) * e, 66 - (66 - rests[i]!) * e], r: 1 + 1.6 * e, color: i % 3 === 2 ? p.ink : p.muted }];
  });
}

/** Overworld: four fairies flutter a half turn around the ring, bobbing in and out, and settle on it. */
function fairies(t: number, p: Palette): Particle[] {
  const turn = easeInOut((t - 0.5) / 2.1) * Math.PI;
  return Array.from({ length: 4 }, (_, i) => {
    const size = backOut((t - 0.35 - i * 0.1) / 0.25);
    if (size <= 0.05) return [];
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4 + turn;
    const settle = 1 - clamp((t - 2.6) / 0.4);
    const radius = 27 + 2.5 * Math.sin(turn * 6 + i * 1.7) * settle;
    return [{ at: polar(angle, radius), r: 2.4 * size, color: i % 2 ? p.accent : p.highlight }];
  }).flat();
}

/** The particles an ornament draws at time t; none for orbit, which logo.ts draws itself. */
export function ornamentAt(ornament: Ornament, t: number, p: Palette): Particle[] {
  switch (ornament) {
    case 'crops':
      return crops(t, p);
    case 'warp':
      return warp(t, p);
    case 'embers':
      return embers(t, p);
    case 'rain':
      return rain(t, p);
    case 'steam':
      return steam(t, p);
    case 'fairies':
      return fairies(t, p);
    default:
      return [];
  }
}
