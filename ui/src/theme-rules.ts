/**
 * What a theme folder may hold (#206): CSS, JSON and assets, never script. A
 * theme from the user's folder (`~/.toil-ui/themes/<name>/`) can restyle the
 * page, but it can't run code, ship skins, or read the page out through its
 * stylesheet: its CSS may load nothing from outside its own folder, since an
 * attribute selector with a remote `url()` would send what's on screen to
 * another host. The built-in themes are held to the same file rules, and may
 * also `@import` the fonts they bundle. Pure functions, so the server and the
 * tests share them.
 * The dress code, enforced at the door rather than in the annual review.
 */

import { tokenize } from './css-tokens.ts';
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

/** The at-rules a user's theme may use. `@import`, `@namespace` and the rest are refused. */
export const USER_AT_RULES = new Set(['media', 'supports', 'font-face', 'keyframes']);

/** Functions whose string arguments are URLs the browser fetches. */
const URL_FUNCTIONS = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade']);

/** Functions a user's theme may not call at all: they reach outside the stylesheet or run script. */
const REFUSED_FUNCTIONS = new Set(['element', '-moz-element', 'expression', 'paint', 'env']);

/**
 * A path a user's theme may load: relative, inside its own folder, and
 * spelled with nothing a URL parser reads specially, so `%2e%2e`, a
 * backslash, a scheme, a host or a query can't take it elsewhere.
 */
export function isThemePath(raw: string): boolean {
  // `./assets/x.svg` and `assets/x.svg` are the same file.
  const path = raw.startsWith('./') ? raw.slice(2) : raw;
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(path) && !path.split('/').some((seg) => seg === '.' || seg === '..');
}

/**
 * What a user's stylesheet may not do, read through the CSS tokenizer
 * (src/css-tokens.ts) so escapes are decoded and strings taken whole first:
 * any at-rule but `@media`, `@supports`, `@font-face` and `@keyframes`; any
 * `url()`, or string inside a function that loads one (`image-set()`,
 * `image()`, `cross-fade()`, `src()`), that isn't a relative path inside the
 * theme's folder; and anything that runs script. The toil-ui server's
 * Content-Security-Policy is the boundary that holds whatever this misses;
 * this is what tells a theme's author why it was refused.
 */
export function userCssProblems(css: string): string[] {
  const out = new Set<string>();
  const leaves = (target: string) => `theme.css: url(${JSON.stringify(target)}) leaves the theme's folder; a user theme may only use its own files.`;
  const stack: string[] = [];
  for (const t of tokenize(css)) {
    if (t.type === 'at-keyword' && !USER_AT_RULES.has(t.value.toLowerCase())) out.add(`theme.css: a user theme may use only @${[...USER_AT_RULES].join(', @')}, not @${t.value}.`);
    else if (t.type === 'url' && !isThemePath(t.value)) out.add(leaves(t.value));
    else if (t.type === 'bad-url' || t.type === 'bad-string') out.add('theme.css: holds a malformed url() or string, which a browser would read differently.');
    else if (t.type === 'function') {
      const fn = t.value.toLowerCase();
      if (REFUSED_FUNCTIONS.has(fn)) out.add(`theme.css: a user theme may not use ${t.value}().`);
      stack.push(fn);
    } else if (t.type === '(') stack.push('(');
    else if (t.type === ')') stack.pop();
    else if (t.type === 'string' && stack.some((fn) => URL_FUNCTIONS.has(fn)) && !isThemePath(t.value)) out.add(leaves(t.value));
    if ((t.type === 'ident' || t.type === 'function' || t.type === 'string' || t.type === 'url') && (SCRIPT.test(t.value) || /^(behavior|-moz-binding)$/i.test(t.value))) {
      out.add(`theme.css: holds something that runs script (${t.value}).`);
    }
  }
  return [...out];
}

/**
 * Problems with a theme's stylesheet: every selector scoped to
 * `[data-theme="<name>"]`, and, for a user's theme, everything
 * `userCssProblems` refuses.
 */
export function cssProblems(name: string, css: string, { user }: { user: boolean }): string[] {
  const out: string[] = [];
  const selectors = selectorsOf(css);
  if (!selectors.length) out.push('theme.css: has no rules.');
  const scope = `[data-theme="${name}"]`;
  for (const s of selectors) for (const part of s.split(',')) if (!part.trim().startsWith(scope)) out.push(`theme.css: "${part.trim()}" isn't scoped to ${scope}.`);
  if (user) out.push(...userCssProblems(css));
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
