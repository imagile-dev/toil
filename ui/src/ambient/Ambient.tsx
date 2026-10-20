/**
 * The layer behind every view where a game theme keeps its motion (#271):
 * Crate's parallax backdrop (racking, the drafting grid and pallets, each
 * moving at its own rate as the page scrolls) and each theme's particles on
 * one canvas. Plain gets nothing at all. It is decoration, hidden from screen
 * readers and from the pointer, painted behind the page so no particle ever
 * crosses a panel.
 *
 * The parallax is a scroll-driven CSS animation where the browser has them
 * (the theme's stylesheet says how far each layer moves); elsewhere a
 * requestAnimationFrame fallback here moves the same layers by the same
 * rates, read from the same custom properties. With motion unwelcome, by the
 * OS or by Settings, neither runs and the canvas is never started.
 *
 * The particles are whatever preset the theme's theme.json names (#348), and
 * a theme's own "Particles and ambient effects" switch removes them outright:
 * no canvas and no frame, and for a theme with no parallax no layer at all.
 * Crate's parallax keeps following the motion switch alone.
 * Depth has been approved at three layers, pending a fourth-layer review.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useMotionAllowed, useParticlesAllowed } from '../motion.ts';
import { THEMES } from '../themes.ts';
import { startParticles } from './engine.ts';
import { PRESETS } from './presets.ts';
import './ambient.css';

/** The themes with a parallax backdrop. Its art and rates are in the theme's own stylesheet. */
const PARALLAX = new Set(['crate']);
const LAYERS = ['far', 'mid', 'near'] as const;

/** True where the browser runs scroll-driven animations itself. */
const scrollDriven = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()');

/**
 * Moves each layer by `--depth` times the scroll, wrapped every `--tile`, so a
 * layer is never taller than the window plus one tile of its art.
 */
function useParallaxFallback(root: RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!on || !host || scrollDriven()) return;
    // The theme's stylesheet may still be loading, so the rates are read on the first frame that finds them.
    const els = [...host.querySelectorAll<HTMLElement>('.ambient-layer')];
    let layers: Array<{ el: HTMLElement; depth: number; tile: number }> = [];
    const measure = () =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return { el, depth: parseFloat(style.getPropertyValue('--depth')) || 0, tile: parseFloat(style.getPropertyValue('--tile')) || 0 };
      });
    let raf = 0;
    const frame = () => {
      raf = 0;
      if (!layers.length || layers.some((l) => !l.tile)) layers = measure();
      for (const { el, depth, tile } of layers) {
        const y = tile > 0 ? (window.scrollY * depth) % tile : 0;
        el.style.transform = `translate3d(0, ${(-y).toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      raf ||= requestAnimationFrame(frame);
    };
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      for (const el of els) el.style.removeProperty('transform');
    };
  }, [root, on]);
}

export function Ambient({ theme }: { theme: string }) {
  const allowed = useMotionAllowed();
  const particlesOn = useParticlesAllowed(theme);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const named = THEMES.find((t) => t.name === theme)?.ambient?.particles;
  const preset = particlesOn && named ? PRESETS[named] : undefined;
  const parallax = PARALLAX.has(theme);

  useEffect(() => {
    if (!preset || !canvas.current) return;
    return startParticles(canvas.current, preset);
  }, [preset]);
  useParallaxFallback(root, allowed && parallax);

  if (!preset && !parallax) return null;
  return (
    <div className="ambient" aria-hidden="true" ref={root}>
      {parallax && LAYERS.map((l) => <div key={l} className={`ambient-layer ambient-layer--${l}`} />)}
      {preset && <canvas className="ambient-particles" ref={canvas} />}
    </div>
  );
}
