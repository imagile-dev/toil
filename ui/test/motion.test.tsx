import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { Ambient } from '../src/ambient/Ambient.tsx';
import { blank, fill, particleCount, stepAll, type Preset, type Viewport } from '../src/ambient/engine.ts';
import { PRESETS, shaft } from '../src/ambient/presets.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { resetMotionChoice, setMotionChoice } from '../src/motion.ts';
import { THEMES } from '../src/themes.ts';

/**
 * Motion and effects (#271): the particle presets stay sparse and inside the
 * window, the engine runs only when motion is welcome and stops in a hidden
 * tab, Plain gets nothing, and "Reduce motion and effects" in Settings stops
 * all of it, the way the operating system's setting does.
 */

/** A seeded generator, so a preset's run is the same every time. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** jsdom has no matchMedia; this one answers the reduced-motion query. */
function osMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reduce : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

/** A 2D context that records nothing and draws nothing, since jsdom has none. */
function fakeCanvas() {
  const ctx = new Proxy({}, { get: (_, key) => (key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined) });
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

const { matchMedia } = window;

beforeEach(() => {
  localStorage.clear();
  resetMotionChoice();
  delete document.documentElement.dataset.motion;
});

afterEach(() => {
  window.matchMedia = matchMedia;
  vi.restoreAllMocks();
});

describe('the particle presets', () => {
  const VIEWS: Viewport[] = [
    { w: 1440, h: 900, t: 0 },
    { w: 375, h: 812, t: 0 },
  ];

  it('exist for every theme but Plain', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(THEMES.map((t) => t.name).filter((n) => n !== 'plain').sort());
  });

  it.each(Object.entries(PRESETS))('%s stays sparse: a few dozen at most, fewer on a phone', (_, preset) => {
    const desk = particleCount(preset, 1440, 900);
    const phone = particleCount(preset, 375, 812);
    expect(desk).toBeGreaterThan(0);
    expect(desk).toBeLessThanOrEqual(40);
    expect(phone).toBeLessThan(desk);
    expect(particleCount(preset, 5120, 2880)).toBe(preset.max);
  });

  it.each(Object.entries(PRESETS))('%s keeps its particles in or near the window and faint, over a minute of frames', (_, preset: Preset) => {
    for (const base of VIEWS) {
      const view = { ...base };
      const rand = seeded(7);
      const ps = [] as ReturnType<typeof blank>[];
      fill(preset, ps, view, rand);
      // Checked in plain code and asserted once: an expect() per particle per frame was
      // over a million of them, which took up to 3.7 s on a Windows runner (#328).
      const strays: string[] = [];
      for (let i = 0; i < 1800 && strays.length < 5; i++) {
        view.t += 1 / 30;
        stepAll(preset, ps, 1 / 30, view, rand);
        for (const p of ps) {
          const a = preset.alpha(p, view);
          const inside = p.x > -view.w * 0.4 - 20 && p.x < view.w + 260 && p.y > -view.h * 0.3 && p.y < view.h + 260;
          if ((!inside || !(a >= 0 && a <= 0.75)) && strays.length < 5) strays.push(`${view.w}x${view.h} frame ${i}: x ${p.x}, y ${p.y}, alpha ${a}`);
        }
      }
      expect(strays).toEqual([]);
      expect(ps).toHaveLength(particleCount(preset, view.w, view.h));
    }
  });

  it("puts Crate's light shaft where theme.css draws it: brightest 64% along a 115° line", () => {
    const [w, h] = [1440, 900];
    // The gradient line's 64% point, worked out the way CSS does for 115deg.
    const a = (115 * Math.PI) / 180;
    const length = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    const at = (t: number) => [w / 2 + (t - 0.5) * length * Math.sin(a), h / 2 - (t - 0.5) * length * Math.cos(a)] as const;
    expect(shaft(...at(0.64), w, h)).toBeCloseTo(1, 5);
    expect(shaft(...at(0.5), w, h)).toBeLessThan(0.05);
    expect(shaft(...at(0.8), w, h)).toBeLessThan(0.01);
  });

  it("drifts Realm's ash down the page and its embers up it, in every width", () => {
    for (const w of [375, 1440]) {
      const view = { w, h: 812, t: 0 };
      const ps = [] as ReturnType<typeof blank>[];
      const rand = seeded(3);
      fill(PRESETS.realm!, ps, view, rand);
      for (let i = 0; i < 900; i++) stepAll(PRESETS.realm!, ps, 1 / 30, view, rand);
      expect(new Set(ps.map((p) => p.kind))).toEqual(new Set([0, 1]));
      expect(ps.filter((p) => p.kind === 1).every((p) => p.vy > 0)).toBe(true);
      expect(ps.filter((p) => p.kind === 0).every((p) => p.vy < 0)).toBe(true);
    }
  });
});

describe('the ambient layer', () => {
  it('is absent from Plain', () => {
    osMotion(false);
    const { container } = render(<Ambient theme="plain" />);
    expect(container.innerHTML).toBe('');
  });

  it('is decoration: hidden from screen readers, with a canvas only while motion is welcome', () => {
    osMotion(false);
    fakeCanvas();
    const { container } = render(<Ambient theme="starship" />);
    const layer = container.querySelector('.ambient')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelector('canvas')).not.toBeNull();
    expect(layer.querySelectorAll('.ambient-layer')).toHaveLength(0);
  });

  it("gives Crate its three parallax layers, which stay as a still backdrop when motion isn't welcome", () => {
    osMotion(true);
    const { container } = render(<Ambient theme="crate" />);
    expect([...container.querySelectorAll('.ambient-layer')].map((e) => e.className)).toEqual(['ambient-layer ambient-layer--far', 'ambient-layer ambient-layer--mid', 'ambient-layer ambient-layer--near']);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('runs no frames with the OS asking for reduced motion', () => {
    osMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const getContext = fakeCanvas();
    render(<Ambient theme="realm" />);
    expect(getContext).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
  });

  it('pauses while the tab is hidden and picks up again when it is shown', () => {
    osMotion(false);
    fakeCanvas();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    render(<Ambient theme="harvest" />);
    expect(raf).toHaveBeenCalledTimes(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('stops, canvas and all, when the person reduces motion, and says so on the root for CSS', () => {
    osMotion(false);
    fakeCanvas();
    const { container } = render(<Ambient theme="crate" />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(document.documentElement.dataset.motion).toBe('full');
    act(() => setMotionChoice('reduced'));
    expect(container.querySelector('canvas')).toBeNull();
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(localStorage.getItem('toil-ui.motion')).toBe('reduced');
  });
});

describe('Reduce motion and effects, in Settings', () => {
  it('is on the General page, remembered by this browser, and stops the particles', async () => {
    osMotion(false);
    fakeCanvas();
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'crate', scheme: 'system' }));
    window.location.hash = '#/settings/toil';
    const { container } = render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
    expect(container.ownerDocument.querySelector('.ambient canvas')).not.toBeNull();
    const box = screen.getByRole('checkbox', { name: 'Reduce motion and effects' });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem('toil-ui.motion')).toBe('reduced');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(container.ownerDocument.querySelector('.ambient canvas')).toBeNull();
    expect(screen.getByText(/Nothing moves/)).toBeTruthy();
  });

  it('starts from what this browser remembered', () => {
    localStorage.setItem('toil-ui.motion', 'reduced');
    resetMotionChoice();
    osMotion(false);
    const { container } = render(<Ambient theme="harvest" />);
    expect(container.querySelector('canvas')).toBeNull();
  });
});
