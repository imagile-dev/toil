/**
 * What a theme folder may hold (#206): CSS, JSON and assets, never script. A
 * theme from the user's folder (`~/.toil-ui/themes/<name>/`) can restyle the
 * page, but it can't run code, ship skins, or read the page out through its
 * stylesheet: its CSS may load nothing from outside its own folder, since an
 * attribute selector with a remote `url()` would send what's on screen to
 * another host. The built-in themes are held to the same file rules, and may
 * also `@import` the fonts they bundle. Pure functions, so the server and the
 * tests share them.
 */

import { TERMS, TOKENS, type ThemeManifest } from './theme-pack.ts';

/** The only files a theme folder may hold. */
export const THEME_FILE_TYPES = new Set(['.css', '.json', '.svg', '.webp', '.png', '.avif', '.woff2']);

/** Patterns that run script, in SVG or CSS. */
const SCRIPT = /<script|javascript:|vbscript:|data:text\/html|expression\s*\(|-moz-binding|behavior\s*:|\bon[a-z]+\s*=|<foreignObject/i;

const extOf = (path: string) => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
};

/** Problems with one file in a theme folder, by its path inside the folder and its text (for CSS, JSON and SVG). */
export function fileProblems(path: string, text: string | null): string[] {
  const ext = extOf(path);
  if (!THEME_FILE_TYPES.has(ext)) return [`${path}: a theme holds only CSS, JSON and assets (${[...THEME_FILE_TYPES].join(', ')}), never script or anything else.`];
  if (text !== null && (ext === '.css' || ext === '.svg') && SCRIPT.test(text)) return [`${path}: holds something that runs script (${SCRIPT.exec(text)![0]}).`];
  return [];
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector in a stylesheet, outside `@` rules' preludes and keyframe steps. */
export function selectorsOf(css: string): string[] {
  const body = stripComments(css).replace(/@import[^;]*;/g, '');
  return [...body.matchAll(/([^{};]+)\{/g)]
    .map((m) => m[1]!.trim())
    .filter((s) => !s.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(s));
}

/**
 * Problems with a theme's stylesheet: every selector scoped to
 * `[data-theme="<name>"]`, and, for a user's theme, no `@import` and no
 * `url()` that leaves its folder.
 */
export function cssProblems(name: string, css: string, { user }: { user: boolean }): string[] {
  const out: string[] = [];
  const selectors = selectorsOf(css);
  if (!selectors.length) out.push('theme.css: has no rules.');
  const scope = `[data-theme="${name}"]`;
  for (const s of selectors) for (const part of s.split(',')) if (!part.trim().startsWith(scope)) out.push(`theme.css: "${part.trim()}" isn't scoped to ${scope}.`);
  if (user) {
    const text = stripComments(css);
    if (/@import\b/i.test(text)) out.push('theme.css: a user theme may not @import anything.');
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
      const target = m[2]!.trim();
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('\\') || target.split(/[\\/]/).includes('..')) {
        out.push(`theme.css: url(${target}) leaves the theme's folder; a user theme may only use its own files.`);
      }
    }
  }
  return out;
}

/** Problems with a theme's manifest: its name, every token as a hex colour in every scheme, fonts and a radius that can't break out of the stylesheet, and no skins. */
export function manifestProblems(folder: string, raw: unknown, { user }: { user: boolean }): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['theme.json: is not a JSON object.'];
  const m = raw as Partial<ThemeManifest> & Record<string, unknown>;
  const out: string[] = [];
  if (m.name !== folder) out.push(`theme.json: "name" must be the folder's name, "${folder}".`);
  if (typeof m.label !== 'string' || !m.label) out.push('theme.json: needs a "label".');
  if (user && 'skins' in m) out.push('theme.json: only built-in themes ship skins, since a skin is script.');
  const schemes = m.schemes && typeof m.schemes === 'object' ? Object.entries(m.schemes) : [];
  if (!schemes.length) out.push('theme.json: needs at least one scheme, "light" or "dark".');
  for (const [scheme, tokens] of schemes) {
    if (scheme !== 'light' && scheme !== 'dark') out.push(`theme.json: "${scheme}" isn't a scheme; use "light" or "dark".`);
    for (const t of TOKENS) {
      const v = (tokens as Record<string, unknown> | undefined)?.[t];
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) out.push(`theme.json: ${scheme}.${t} must be a colour like #1b1f24.`);
    }
  }
  // Fonts and the radius go into a stylesheet as written, so they may hold only what a font list or a length needs.
  const fonts = m.fonts && typeof m.fonts === 'object' ? m.fonts : null;
  for (const slot of ['body', 'display', 'mono'] as const) {
    const v = fonts?.[slot];
    if (typeof v !== 'string' || !/^[\w\s,'".-]+$/.test(v)) out.push(`theme.json: fonts.${slot} must be a font list, like "'Fira Code', monospace".`);
  }
  if (typeof m.radius !== 'string' || !/^\d+(\.\d+)?(px|rem|em)$/.test(m.radius)) out.push('theme.json: "radius" must be a length, like "6px".');
  for (const key of Object.keys(m.terms ?? {})) if (!(TERMS as readonly string[]).includes(key)) out.push(`theme.json: "${key}" isn't a word a theme can rename (${TERMS.join(', ')}).`);
  for (const [key, word] of Object.entries(m.terms ?? {})) if (typeof word !== 'string' || /[<>]/.test(word)) out.push(`theme.json: terms.${key} must be plain text.`);
  return out;
}
