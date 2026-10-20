/**
 * Whether the page may move (#271). Two things say no: the operating system's
 * reduced-motion setting, and "Reduce motion and effects" under Settings,
 * which this browser remembers the way it remembers the theme. Either one
 * stops every animation, the themes' particles and Crate's parallax. The
 * choice is mirrored on the root as `data-motion`, so CSS stops what CSS
 * started (src/app.css) without asking script. Storage that refuses (a
 * private window, blocked site data) only means the choice isn't remembered.
 *
 * Below both sits "Particles and ambient effects" (#348), kept per theme: a
 * theme that declares particles in its theme.json (`"ambient": { "particles":
 * "dust" }`) can have them switched off on their own while everything else
 * keeps moving. The order is the OS, then the motion switch, then this one.
 * Stillness can be requested at any time and requires no countersignature.
 */

import { useEffect, useSyncExternalStore } from 'react';

export type MotionChoice = 'full' | 'reduced';
const KEY = 'toil-ui.motion';
const REDUCE = '(prefers-reduced-motion: reduce)';

function remembered(): MotionChoice {
  try {
    return localStorage.getItem(KEY) === 'reduced' ? 'reduced' : 'full';
  } catch {
    return 'full';
  }
}

let choice: MotionChoice | null = null;
const listeners = new Set<() => void>();

function current(): MotionChoice {
  choice ??= remembered();
  return choice;
}

function mirror() {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = current();
}

export function setMotionChoice(next: MotionChoice) {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not remembered; it still holds for this visit.
  }
  mirror();
  for (const l of listeners) l();
}

/** Forgets the cached choice, so the next read comes from storage again. For tests. */
export function resetMotionChoice() {
  choice = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The person's own choice in Settings, and the setter for it. */
export function useMotionChoice(): [MotionChoice, (c: MotionChoice) => void] {
  return [useSyncExternalStore(subscribe, current, () => 'full' as const), setMotionChoice];
}

/** The OS setting. A browser that can't say (jsdom) counts as reduced: no motion is the safe guess. */
function osReduces(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(REDUCE).matches;
}

function subscribeOs(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** True when nothing asks for stillness: the OS doesn't, and neither did the person. Keeps `data-motion` on the root current. */
export function useMotionAllowed(): boolean {
  const [mine] = useMotionChoice();
  const os = useSyncExternalStore(subscribeOs, osReduces, () => true);
  useEffect(mirror, [mine]);
  return mine === 'full' && !os;
}

const PARTICLES_KEY = 'toil-ui.particles';

/** The themes whose particles were switched off, from storage; anything unreadable counts as none. */
function rememberedParticles(): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PARTICLES_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
  } catch {
    return {};
  }
}

let particles: Record<string, boolean> | null = null;
const currentParticles = () => (particles ??= rememberedParticles());

/** Switches one theme's particles on or off, in this browser, leaving every other theme's as it was. */
export function setParticlesOn(theme: string, on: boolean) {
  particles = { ...currentParticles(), [theme]: on };
  try {
    localStorage.setItem(PARTICLES_KEY, JSON.stringify(particles));
  } catch {
    // Not remembered; it still holds for this visit.
  }
  for (const l of listeners) l();
}

/** Forgets the cached particle choices, so the next read comes from storage again. For tests. */
export function resetParticlesChoice() {
  particles = null;
}

/** Whether the person wants this theme's particles (on unless they switched them off), and the setter for it. */
export function useParticlesChoice(theme: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => currentParticles()[theme] ?? true, () => true);
  return [on, (next) => setParticlesOn(theme, next)];
}

/** True when this theme's particles may run: motion is allowed (the OS and the motion switch) and its own switch is on. */
export function useParticlesAllowed(theme: string): boolean {
  const allowed = useMotionAllowed();
  const [on] = useParticlesChoice(theme);
  return allowed && on;
}
