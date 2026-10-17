import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANCHES, CENTER, RING, TOOLS } from '../src/welcome/logo.js';
import { PALETTE, type Rgb } from '../src/welcome/term.js';

/**
 * The site and the terminal menu show the same mark in the same colours. They
 * can't share code (the site is its own package), so this test reads the
 * site's sources and fails when either drifts. Change one, change the other.
 */

const root = join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'site/src/styles/global.css'), 'utf8');
const logo = readFileSync(join(root, 'site/src/components/Logo.astro'), 'utf8');

function token(name: string): Rgb {
  const rgb = css.match(new RegExp(`--rgb-${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)`));
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, 'i'));
  if (!hex) throw new Error(`No --rgb-${name} or --color-${name} in global.css`);
  const n = parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const numbers = (text: string) => (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('the terminal matches the site', () => {
  it('uses the site palette for every colour', () => {
    for (const name of ['accent', 'amber', 'ink', 'muted', 'faint', 'bg'] as const) {
      expect(PALETTE[name], `PALETTE.${name} vs the site's ${name} token`).toEqual(token(name));
    }
  });

  it('draws the same ring', () => {
    expect(numbers(logo.match(/<circle[^>]*r="27"[^>]*\/>/)?.[0] ?? '')).toEqual(expect.arrayContaining([CENTER, RING]));
  });

  it('draws the same six branches, from the terminal to each tool', () => {
    const paths = [...logo.matchAll(/'(M[^']+)'/g)].map((m) => m[1]!);
    expect(paths).toHaveLength(BRANCHES.length);
    paths.forEach((d, i) => {
      const n = numbers(d);
      const [start, , , end] = BRANCHES[i]!;
      expect(start, `branch ${i + 1} start`).toEqual([n[0], n[1]]);
      // `M x y C c1 c2 end` ends on its last pair; `M x y H x2` stays on y.
      const finish = d.includes('C') ? [n[n.length - 2], n[n.length - 1]] : [n[2], n[1]];
      expect(end, `branch ${i + 1} end`).toEqual(finish);
      if (d.includes('C')) expect(BRANCHES[i]!.slice(1, 3).flat(), `branch ${i + 1} curve`).toEqual(n.slice(2, 6));
    });
  });

  it('puts the same six tools in the same places, in the same colours', () => {
    const tools = [...logo.matchAll(/\{ cx: ([\d.]+), cy: ([\d.]+), fill: 'var\(--color-(\w+)\)' \}/g)];
    expect(tools).toHaveLength(TOOLS.length);
    tools.forEach((m, i) => {
      expect(TOOLS[i]!.at, `tool ${i + 1} position`).toEqual([Number(m[1]), Number(m[2])]);
      expect(TOOLS[i]!.color, `tool ${i + 1} colour (${m[3]})`).toEqual(token(m[3]!));
    });
  });
});
