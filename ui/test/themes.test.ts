import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES, TOKENS, tokenCss, type Token } from '../src/themes.ts';

/**
 * Every theme is held to the same bar (#206): data and styling only, every
 * token defined for every scheme it offers, and contrast that passes WCAG AA.
 * Plain is the accessibility baseline, and Crate is held to the same numbers.
 */

const themesDir = join(import.meta.dirname, '..', 'themes');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
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
    const allowed = new Set(['.css', '.json', '.webp', '.png', '.svg', '.woff2']);
    const found = files(join(themesDir, name)).map((f) => extname(f).toLowerCase());
    expect(found.filter((ext) => !allowed.has(ext))).toEqual([]);
    for (const f of files(join(themesDir, name)).filter((f) => f.endsWith('.svg') || f.endsWith('.css'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/<script|javascript:|expression\(|on\w+\s*=/i);
    }
  });

  it('names itself after its folder and scopes its CSS to itself', () => {
    expect(readdirSync(themesDir)).toContain(theme.name);
    const css = readFileSync(join(themesDir, name, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
    const selectors = [...css.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s));
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) for (const part of s.split(',')) expect(part.trim(), part).toMatch(new RegExp(`^\\[data-theme="${name}"\\]`));
  });

  it('lists every asset it ships', () => {
    for (const path of Object.values(theme.assets)) expect(statSync(join(themesDir, name, path)).isFile()).toBe(true);
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

  it('is the default, with light first and a dark variant that follows the system', () => {
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
