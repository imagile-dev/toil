import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssProblems, fileProblems, manifestProblems } from '../src/theme-rules.ts';
import { initialChoice } from '../src/theme-choice.ts';
import { DEFAULT_THEME, TERMS, THEMES, TOKENS, themeNamed, tokenCss, type Token } from '../src/themes.ts';

/**
 * Every theme is held to the same bar (#206): data and styling only, every
 * token defined for every scheme it offers, and contrast that passes WCAG AA.
 * Plain is the accessibility baseline, and Crate is held to the same numbers.
 */

const themesDir = join(import.meta.dirname, '..', 'themes');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

/** A stylesheet without its `@media (prefers-reduced-motion: no-preference)` blocks. */
function withoutMotionBlocks(css: string): string {
  let out = css;
  for (let at = out.search(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/); at >= 0; at = out.search(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/)) {
    let depth = 0;
    let end = out.indexOf('{', at);
    for (; end < out.length; end++) {
      if (out[end] === '{') depth++;
      else if (out[end] === '}' && --depth === 0) break;
    }
    out = out.slice(0, at) + out.slice(end + 1);
  }
  // Keyframes describe motion but play only when an animation inside those blocks names them.
  return out.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
}

/** WCAG 2.2 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text on the backgrounds it appears on: 4.5:1 for body text (AA). */
const TEXT: [Token, Token][] = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'raised'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'raised'],
  ['link', 'bg'], ['link', 'surface'], ['link', 'raised'],
  ['accentInk', 'accent'], ['bannerInk', 'bannerBg'],
  ['ok', 'raised'], ['ok', 'surface'], ['warn', 'raised'], ['warn', 'surface'], ['danger', 'raised'], ['danger', 'surface'],
];
/** Focus rings, control borders and the meter against what surrounds them: 3:1 (AA, non-text contrast). */
const UI: [Token, Token][] = [
  ['focus', 'bg'], ['focus', 'surface'], ['focus', 'raised'],
  ['muted', 'raised'], ['accent', 'surface'],
];

describe.each(THEMES.map((t) => [t.name, t] as const))('the %s theme', (name, theme) => {
  it('is CSS, JSON and assets only, never script', () => {
    const dir = join(themesDir, name);
    const problems = files(dir).flatMap((f) => {
      const ext = extname(f).toLowerCase();
      return fileProblems(relative(dir, f), ['.css', '.svg', '.json'].includes(ext) ? readFileSync(f, 'utf8') : null);
    });
    expect(problems).toEqual([]);
    expect(manifestProblems(name, theme, { user: false })).toEqual([]);
  });

  it('names itself after its folder and scopes its CSS to itself', () => {
    expect(readdirSync(themesDir)).toContain(theme.name);
    expect(cssProblems(name, readFileSync(join(themesDir, name, 'theme.css'), 'utf8'), { user: false })).toEqual([]);
  });

  it('lists every asset it ships, and ships every asset it lists', () => {
    for (const path of Object.values(theme.assets)) expect(statSync(join(themesDir, name, path)).isFile()).toBe(true);
    const dir = join(themesDir, name);
    const shipped = files(dir).map((f) => relative(dir, f).split(sep).join('/')).filter((f) => f.startsWith('assets/'));
    expect(shipped.sort()).toEqual(Object.values(theme.assets).sort());
    // Every picture its stylesheet draws is one of them.
    const css = readFileSync(join(dir, 'theme.css'), 'utf8');
    for (const m of css.matchAll(/url\("\.\/([^"]+)"\)/g)) expect(Object.values(theme.assets), m[1]).toContain(m[1]);
  });

  it('keeps its art small: 64 KB a file, 160 KB in all', () => {
    const sizes = Object.values(theme.assets).map((path) => statSync(join(themesDir, name, path)).size);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(64 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(160 * 1024);
  });

  it('moves only when motion is welcome, and plays no sound by default', () => {
    // Every animation and transition sits inside @media (prefers-reduced-motion: no-preference),
    // so with reduced motion on nothing moves; app.css stops anything else that would.
    const css = withoutMotionBlocks(readFileSync(join(themesDir, name, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    expect(css).not.toMatch(/(^|[;{\s])(animation|transition)(-[a-z-]+)?\s*:/);
    expect(theme.sounds).toEqual({});
  });

  it('keeps the running week muted wherever it recolours chart bars', () => {
    // A theme rule on `.chart .bar` outranks the base `.bar--partial`, so it must restate it (#271).
    const css = readFileSync(join(themesDir, name, 'theme.css'), 'utf8');
    if (/\.chart \.bar[\s,{]/.test(css)) expect(css).toMatch(/\.chart \.bar--partial\s*\{\s*fill:\s*var\(--muted\)/);
  });

  it('renames only words a theme may rename', () => {
    for (const key of Object.keys(theme.terms ?? {})) expect(TERMS).toContain(key);
  });

  it('defines every token for every scheme', () => {
    expect(Object.keys(theme.schemes).length).toBeGreaterThan(0);
    for (const tokens of Object.values(theme.schemes)) {
      expect(Object.keys(tokens!).sort()).toEqual([...TOKENS].sort());
      for (const value of Object.values(tokens!)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(Object.keys(theme.schemes))('passes WCAG AA contrast in its %s scheme', (scheme) => {
    const t = theme.schemes[scheme as 'light' | 'dark']!;
    for (const [fg, bg] of TEXT) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const [fg, bg] of UI) expect(contrast(t[fg], t[bg]), `${fg} against ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('becomes custom properties scoped to its name', () => {
    const css = tokenCss(theme);
    expect(css).toContain(`:root[data-theme="${name}"] {`);
    expect(css).toContain('--accent-ink:');
    expect(css).toContain('--font-body:');
  });
});

describe('Plain', () => {
  const plain = THEMES.find((t) => t.name === 'plain')!;

  it('comes first in the picker, with light first and a dark variant that follows the system', () => {
    expect(THEMES[0]!.name).toBe('plain');
    expect(Object.keys(plain.schemes)).toEqual(['light', 'dark']);
    const css = tokenCss(plain);
    expect(css).toContain(':root[data-theme="plain"][data-scheme="dark"] {');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n:root\[data-theme="plain"\]\[data-scheme="system"\]/);
  });

  it('has no motion and no sound', () => {
    expect(plain.motion).toBe('none');
    expect(plain.sounds).toEqual({});
  });
});

describe('the default theme (#277)', () => {
  it('is Crate until someone picks another, and an explicit choice always wins', () => {
    localStorage.clear();
    expect(DEFAULT_THEME).toBe('crate');
    expect(initialChoice('')).toEqual({ theme: 'crate', scheme: 'system' });
    expect(initialChoice('?theme=plain&scheme=light')).toEqual({ theme: 'plain', scheme: 'light' });
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'plain', scheme: 'dark' }));
    expect(initialChoice('')).toEqual({ theme: 'plain', scheme: 'dark' });
    expect(initialChoice('?theme=realm')).toEqual({ theme: 'realm', scheme: 'dark' });
    localStorage.clear();
    expect(themeNamed('no-such-theme').name).toBe('crate');
  });

  it('is the theme the page starts in, before any script runs', () => {
    expect(readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')).toContain('<html lang="en" data-theme="crate" data-scheme="system">');
  });
});
