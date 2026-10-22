import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CENTER, DOT_COLORS, ORBIT, orbitDots, SHEET, TILE, tilePath } from '../src/welcome/logo.js';
import { PALETTE, type Rgb } from '../src/welcome/term.js';

/**
 * The site, the terminal and Toil UI show one mark, the badge, in the same
 * colours. They can't share code (the site and the UI are their own packages),
 * so this test reads their sources and fails when any of them drifts. Change
 * one, change the others.
 */

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const css = read('site/src/styles/global.css');
const logo = read('site/src/components/Logo.astro');

function token(name: string): Rgb {
  const rgb = css.match(new RegExp(`--rgb-${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)`));
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, 'i'));
  if (!hex) throw new Error(`No --rgb-${name} or --color-${name} in global.css`);
  const n = parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (rgb: Rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** The page's placement, as every copy of the badge writes it. */
const placement = `translate(${SHEET.cx} ${SHEET.cy}) scale(${SHEET.s}) translate(-31.5 -32.5)`;

describe('the terminal matches the site', () => {
  it('uses the site palette for every colour', () => {
    for (const name of ['accent', 'amber', 'ink', 'muted', 'faint', 'bg'] as const) {
      expect(PALETTE[name], `PALETTE.${name} vs the site's ${name} token`).toEqual(token(name));
    }
  });

  it('draws the same tile, its corner cut parallel to the fold', () => {
    expect(logo).toContain(`'${tilePath()}'`);
    // The cut runs from (42, 6) to (58, 22): the line x - y = 36, parallel to the
    // fold's diagonal, which the sheet's own path draws as `l7 7`.
    expect(TILE.x + TILE.w - TILE.cut - TILE.y).toBe(36);
    expect(logo).toContain('h13l7 7v20');
  });

  it('places the page on the tile the same way', () => {
    expect(logo).toContain(`'${placement}'`);
  });
});

/**
 * The badge's static copies: the favicon, the avatar, and the standard badge
 * Toil UI shows in Plain and as its favicon. Each draws the same tile and
 * places the page the same way, in the site's colours.
 */
describe('every copy of the badge is the same badge', () => {
  const copies = ['site/public/favicon.svg', 'site/public/brand/toil-avatar.svg', 'site/public/brand/toil-orbit.svg', 'ui/src/mark.svg', 'ui/src/favicon.svg'];

  it.each(copies)('%s draws the site tile and page', (path) => {
    const svg = read(path);
    expect(svg).toContain(`d="${tilePath()}"`);
    expect(svg).toContain(`transform="${placement}"`);
    for (const name of ['accent', 'amber', 'ink', 'bg'] as const) expect(svg.toLowerCase(), name).toContain(hex(token(name)));
  });

  it.each(['crate', 'starship', 'realm', 'frontier'])("Toil UI's %s badge keeps the tile's silhouette", (theme) => {
    expect(read(`ui/themes/${theme}/assets/mark.svg`)).toContain(`d="${tilePath()}"`);
  });

  it("Toil UI's Harvest badge is the tile on a 16-pixel grid, its corner cut on the same diagonal", () => {
    const cells = [...read('ui/themes/harvest/assets/mark.svg').matchAll(/<rect x="(\d+)" y="(\d+)" width="4" height="4"/g)].map((m) => [Number(m[1]) / 4, Number(m[2]) / 4] as const);
    const at = (c: number, r: number) => cells.some(([x, y]) => x === c && y === r);
    expect(cells.length).toBeGreaterThan(150);
    // The cut: nothing at or beyond the diagonal c - r = 10 (x - y = 40 in badge units).
    expect(cells.filter(([c, r]) => c - r >= 10)).toEqual([]);
    // The rest of the tile spans columns and rows 1 to 14, its three other corners rounded off.
    expect(at(1, 2) && at(14, 13) && at(2, 14)).toBe(true);
    expect(at(1, 1) || at(14, 14) || at(1, 14)).toBe(false);
  });
});

/**
 * The splash's orbit: the badge shrunk to ORBIT.k in the middle, and the dots
 * where src/welcome/logo.ts draws them at rest. Its still copy is
 * site/public/brand/toil-orbit.svg.
 */
describe("the orbit SVG is the terminal's orbit, still", () => {
  const svg = read('site/public/brand/toil-orbit.svg');

  it('shrinks the badge by the same factor about the centre', () => {
    expect(svg).toContain(`transform="translate(${CENTER} ${CENTER}) scale(${ORBIT.k}) translate(-${CENTER} -${CENTER})"`);
  });

  it('puts the dots where the terminal does, in the same colours', () => {
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(#[0-9a-f]{6})"\/>/g)];
    expect(dots).toHaveLength(ORBIT.n);
    orbitDots(0).forEach((dot, i) => {
      const [, cx, cy, r, fill] = dots[i]!;
      expect(Number(cx), `dot ${i + 1} x`).toBeCloseTo(dot.at[0], 1);
      expect(Number(cy), `dot ${i + 1} y`).toBeCloseTo(dot.at[1], 1);
      expect(Number(r)).toBe(ORBIT.dot);
      expect(fill, `dot ${i + 1} colour`).toBe(hex(token(DOT_COLORS[i % DOT_COLORS.length]!)));
    });
  });
});

/**
 * Toil UI shows a badge for every theme, and its tab icon follows (#281).
 */
describe("Toil UI's badges", () => {
  it('draws the standard badge beside the name, and each theme swaps in its own', () => {
    expect(read('ui/src/app.css')).toMatch(/\.brand::before \{[^}]*url\("\.\/mark\.svg"\)/);
    for (const theme of ['crate', 'harvest', 'starship', 'realm', 'frontier']) {
      expect(read(`ui/themes/${theme}/theme.css`), theme).toContain(`[data-theme="${theme}"] .brand::before {
  background-image: url("./assets/mark.svg");`);
      expect(read('ui/src/favicon.ts'), theme).toContain(`'../themes/${theme}/assets/mark.svg'`);
    }
  });

  // Plain's badge is the same badge in Plain's own blue, one per scheme: the
  // tile takes that scheme's accent instead of the flame-to-amber gradient.
  const plain = JSON.parse(read('ui/themes/plain/theme.json')) as { schemes: Record<'light' | 'dark', { accent: string }> };
  it.each(['light', 'dark'] as const)("draws Plain's %s badge in that scheme's accent, on the same tile", (scheme) => {
    const svg = read(`ui/themes/plain/assets/mark-${scheme}.svg`);
    expect(svg).toContain(`<path d="${tilePath()}" fill="${plain.schemes[scheme].accent}"/>`);
    expect(svg).toContain(`transform="${placement}"`);
    expect(svg).not.toContain('Gradient');
    expect(read('ui/themes/plain/theme.css')).toContain(`url("./assets/mark-${scheme}.svg")`);
    expect(read('ui/src/favicon.ts')).toContain(`'../themes/plain/assets/mark-${scheme}.svg'`);
  });
});

/**
 * Toil UI's Crate theme is toil's brand too (#206): its colour tokens are the
 * site's, read from the same global.css, so a palette change that skips the UI
 * fails here. The UI is its own package, so the theme is JSON this test reads,
 * never code it imports. `line` is the UI's own: the site's is translucent.
 */
describe("the Toil UI Crate theme matches the site", () => {
  const crate = JSON.parse(readFileSync(join(root, 'ui/themes/crate/theme.json'), 'utf8')) as {
    schemes: { dark: Record<string, string> };
    fonts: Record<string, string>;
  };
  const hex = (rgb: Rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  const font = (name: string) => css.match(new RegExp(`--font-${name}:\\s*([^;]+);`))?.[1]?.trim();

  // The UI token, then the site token it must equal.
  const SAME: [string, string][] = [
    ['bg', 'bg'], ['surface', 'surface'], ['raised', 'surface-raised'], ['ink', 'ink'], ['muted', 'muted'],
    ['accent', 'accent'], ['accentInk', 'accent-ink'], ['link', 'amber'], ['focus', 'focus'],
    ['ok', 'amber'], ['warn', 'amber'], ['danger', 'accent'], ['bannerBg', 'surface-raised'], ['bannerInk', 'amber'],
  ];

  it.each(SAME)('uses the site colour for %s (--color-%s)', (ui, site) => {
    expect(crate.schemes.dark[ui]?.toLowerCase()).toBe(hex(token(site)));
  });

  it('uses the site fonts', () => {
    for (const name of ['body', 'display', 'mono']) expect(crate.fonts[name], name).toBe(font(name));
  });

  it('is dark only, like the site', () => {
    expect(Object.keys(crate.schemes)).toEqual(['dark']);
  });
});

/**
 * The wordmark (#272): "toil" is set in one face on the site and in Toil UI, in
 * every theme, and the terminal draws the same word as half-block art in
 * src/welcome/splash.ts. Each package imports the face for itself, so this
 * holds the token, the one weight and the package version together.
 */
describe('the wordmark is one face everywhere', () => {
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const brand = (text: string) => text.match(/--font-brand:\s*([^;]+);/)?.[1]?.trim();
  const fredoka = (path: string) => (JSON.parse(read(path)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> });

  it('uses the same --font-brand on the site and in Toil UI', () => {
    expect(brand(css)).toMatch(/^'Fredoka'/);
    expect(brand(read('ui/src/app.css'))).toBe(brand(css));
  });

  it('imports only the Latin 600 face, at the same version, in both packages', () => {
    expect(read('site/src/layouts/Layout.astro')).toContain("import '@fontsource/fredoka/latin-600.css';");
    expect(read('ui/src/app.css')).toContain("@import '@fontsource/fredoka/latin-600.css';");
    const site = fredoka('site/package.json').dependencies?.['@fontsource/fredoka'];
    expect(site).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fredoka('ui/package.json').devDependencies?.['@fontsource/fredoka']).toBe(site);
  });

  it('sets the word in the brand class wherever the site and the UI show it', () => {
    for (const path of ['site/src/components/SiteHeader.astro', 'site/src/components/SiteFooter.astro']) expect(read(path), path).toContain('<span class="wordmark">toil</span>');
    expect(read('ui/src/App.tsx')).toContain('<span className="wordmark">toil</span>');
  });
});
