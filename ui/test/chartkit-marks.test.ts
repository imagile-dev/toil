import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARK_STYLES, type Scheme } from '../src/theme-pack.ts';
import { THEMES } from '../src/themes.ts';

/**
 * The series marks (docs/work-insights-proposal.md, Series marks): every theme
 * has four per scheme, told apart by style and frame, in exactly the colours the
 * maintainer accepted (parsed from the proposal's appendix so the two cannot
 * drift), each stroke reaching 3:1 against the theme's surface and its own fill.
 * A mark whose stroke fails is reported, never repaired here: the colours are the maintainer's.
 */

const appendix = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'work-insights-proposal.md'), 'utf8');
const accepted = appendix
  .slice(appendix.indexOf('## Appendix: the accepted marks'))
  .split('\n')
  .filter((l) => /^\| (Plain|Crate|Frontier|Harvest|Overworld|Realm|Sprawl|Starship) \|/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('the series marks', () => {
  it('reads the appendix: eight themes of four marks', () => {
    expect(accepted).toHaveLength(32);
  });

  describe.each(THEMES.map((t) => [t.name, t] as const))('%s', (_, theme) => {
    it.each(['light', 'dark'] as Scheme[])('has four distinct marks in %s', (scheme) => {
      const marks = theme.series[scheme];
      expect(marks).toHaveLength(4);
      expect(new Set(marks.map((m) => m.style)).size).toBe(4);
      for (const m of marks) expect(MARK_STYLES).toContain(m.style);
      const frames = marks.map((m) => m.frame);
      if (frames.some((f) => f !== undefined)) {
        expect(frames.every((f) => typeof f === 'string')).toBe(true);
        expect(new Set(frames).size).toBe(4);
      } else expect(['plain', 'crate']).toContain(theme.name);
    });

    it('keeps the same frames and styles in both schemes', () => {
      expect(theme.series.light.map((m) => [m.name, m.style, m.frame])).toEqual(theme.series.dark.map((m) => [m.name, m.style, m.frame]));
    });

    it('wears exactly the colours the maintainer accepted', () => {
      const rows = accepted.filter((r) => r[0]!.toLowerCase() === theme.name);
      expect(rows).toHaveLength(4);
      rows.forEach(([, name, frame, style, lf, ls, ld, df, ds, dd], i) => {
        const light = theme.series.light[i]!;
        const dark = theme.series.dark[i]!;
        expect([light.name, light.style, light.frame ?? 'none']).toEqual([name, style, frame]);
        expect([light.fill, light.stroke, light.detail]).toEqual([lf, ls, ld]);
        expect([dark.fill, dark.stroke, dark.detail]).toEqual([df, ds, dd]);
      });
    });

    it.each(['light', 'dark'] as Scheme[])('has strokes that reach 3:1 against the surface and the fill in %s', (scheme) => {
      const surface = theme.schemes[scheme].surface;
      theme.series[scheme].forEach((m, i) => {
        expect(contrast(m.stroke, surface), `${theme.name} ${scheme} mark ${i + 1} (${m.name}) against the surface`).toBeGreaterThanOrEqual(3);
        expect(contrast(m.stroke, m.fill), `${theme.name} ${scheme} mark ${i + 1} (${m.name}) against its fill`).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
