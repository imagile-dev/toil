import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssProblems, fileProblems, lexiconProblems, manifestProblems, voiceProblems } from './theme-rules.ts';
import { initialChoice } from '../src/theme-choice.ts';
import { STANDARD, WORD_KEYS, wordFor } from '../src/wording.ts';
import { themed } from '../src/theme-context.ts';
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
    expect(manifestProblems(name, theme)).toEqual([]);
  });

  it('names itself after its folder and scopes its CSS to itself', () => {
    expect(readdirSync(themesDir)).toContain(theme.name);
    expect(cssProblems(name, readFileSync(join(themesDir, name, 'theme.css'), 'utf8'))).toEqual([]);
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

  it('says its wording and its voice in plain text, keeping every id and command the standard text names (#283)', () => {
    expect(lexiconProblems(theme.lexicon)).toEqual([]);
    expect(voiceProblems(theme.voice)).toEqual([]);
    // Plain is the standard wording and no voice; every game theme has both, whole.
    if (name === 'plain') {
      expect(theme.lexicon).toBeUndefined();
      expect(theme.voice).toBeUndefined();
    } else {
      expect(Object.keys(theme.lexicon ?? {}).sort()).toEqual([...WORD_KEYS].sort());
      expect(theme.voice!.length).toBeGreaterThan(300);
    }
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

describe('how deep a theme goes (#283)', () => {
  it('has themed wording and the agent voice on until someone switches one off, with the address winning', () => {
    localStorage.clear();
    expect(initialChoice('')).toMatchObject({ wording: true, voice: true });
    expect(initialChoice('?wording=off')).toMatchObject({ wording: false, voice: true });
    expect(initialChoice('?voice=off')).toMatchObject({ wording: true, voice: false });
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'harvest', wording: false, voice: false }));
    expect(initialChoice('')).toMatchObject({ theme: 'harvest', wording: false, voice: false });
    expect(initialChoice('?voice=on')).toMatchObject({ wording: false, voice: true });
    // A hand-edited or older value that isn't a boolean leaves the default; it never throws.
    localStorage.setItem('toil-ui.theme', JSON.stringify({ wording: 'yes', voice: null }));
    expect(initialChoice('')).toMatchObject({ wording: true, voice: true });
    localStorage.setItem('toil-ui.theme', '[1,2]');
    expect(initialChoice('')).toEqual({ theme: 'crate', scheme: 'system', wording: true, voice: true });
    localStorage.clear();
  });

  it('reads the standard text with wording off, in Plain, and for any key a theme leaves out', () => {
    const crate = themeNamed('crate');
    expect(wordFor(crate.lexicon, true, 'empty.prs')).toBe(crate.lexicon!['empty.prs']);
    expect(wordFor(crate.lexicon, false, 'empty.prs')).toBe(STANDARD['empty.prs']);
    expect(wordFor(themeNamed('plain').lexicon, true, 'empty.prs')).toBe(STANDARD['empty.prs']);
    expect(wordFor({}, true, 'loading.dossier', { name: 'card-payments' })).toBe('Reading card-payments…');
    expect(wordFor(crate.lexicon, true, 'empty.item', { id: 'corp-jira:PAY-9' })).toBe("No crate corp-jira:PAY-9 on this dossier's manifest.");
    expect(themed(themeNamed('realm'), 'epic', 'Epic', false)).toBe('Epic');
  });

  it('refuses wording that drops an id or a command, holds markup, or uses a key that does not exist', () => {
    expect(lexiconProblems({ 'empty.item': 'No such crate.' })).toEqual(['theme.json: lexicon."empty.item" must keep the placeholders {id}.']);
    expect(lexiconProblems({ 'empty.dossiers': 'Nothing on the floor.' })).toEqual(['theme.json: lexicon."empty.dossiers" must keep the command toil dossiers init.']);
    expect(lexiconProblems({ 'empty.prs': '<b>None</b>' })).toEqual(['theme.json: lexicon."empty.prs" must be plain text.']);
    expect(lexiconProblems({ 'button.ask': 'Holler' })).toEqual(['theme.json: lexicon."button.ask" isn\'t a word key (src/wording.ts).']);
    expect(voiceProblems('```proposal```')).toEqual(['theme.json: "voice" must be one paragraph of plain text, with no code fence, citation or line break.']);
    expect(voiceProblems('x'.repeat(801))[0]).toMatch(/over 800/);
  });
});

describe('the default theme (#277)', () => {
  it('is Crate until someone picks another, and an explicit choice always wins', () => {
    localStorage.clear();
    expect(DEFAULT_THEME).toBe('crate');
    const deep = { wording: true, voice: true };
    expect(initialChoice('')).toEqual({ theme: 'crate', scheme: 'system', ...deep });
    expect(initialChoice('?theme=plain&scheme=light')).toEqual({ theme: 'plain', scheme: 'light', ...deep });
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'plain', scheme: 'dark' }));
    expect(initialChoice('')).toEqual({ theme: 'plain', scheme: 'dark', ...deep });
    expect(initialChoice('?theme=realm')).toEqual({ theme: 'realm', scheme: 'dark', ...deep });
    localStorage.clear();
    expect(themeNamed('no-such-theme').name).toBe('crate');
  });

  it('is the theme the page starts in, before any script runs', () => {
    expect(readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')).toContain('<html lang="en" data-theme="crate" data-scheme="system">');
  });
});
