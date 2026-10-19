/**
 * Theme packs (#206, Front end: built to be themed). A theme is data and
 * styling only: `theme.json` (tokens per colour scheme, fonts, motion, assets,
 * and the words it renames) and a `theme.css` scoped under
 * `[data-theme="<name>"]`. No theme runs script, which test/themes.test.ts
 * holds every theme folder to. This module turns a manifest's tokens into
 * custom properties; built-in skins, which are script, live in src/skins/
 * instead.
 *
 * Every manifest is read up front, since the theme picker lists them all, but
 * a theme's stylesheet (and so its fonts and art) loads only once it is
 * picked. Plain, the default, is the one stylesheet in the first load. The
 * paperwork for a new colour now fits on one JSON file, a record for this
 * organisation.
 */

import '../themes/plain/theme.css';
import crate from '../themes/crate/theme.json';
import harvest from '../themes/harvest/theme.json';
import plain from '../themes/plain/theme.json';
import realm from '../themes/realm/theme.json';
import starship from '../themes/starship/theme.json';
import { TOKENS, type Scheme, type ThemeManifest, type Token } from './theme-pack.ts';

export { TERMS, TOKENS, type Scheme, type TermKey, type ThemeManifest, type Token } from './theme-pack.ts';

/** The built-in themes, Plain first as the default. */
export const THEMES: ThemeManifest[] = [plain, crate, harvest, starship, realm] as ThemeManifest[];

export const DEFAULT_THEME = 'plain';

/** Each built-in theme's stylesheet, loaded when the theme is first picked. */
const STYLES: Record<string, () => Promise<unknown>> = {
  crate: () => import('../themes/crate/theme.css'),
  harvest: () => import('../themes/harvest/theme.css'),
  starship: () => import('../themes/starship/theme.css'),
  realm: () => import('../themes/realm/theme.css'),
};

const loaded = new Map<string, Promise<void>>();

/**
 * Loads a theme's stylesheet once. A stylesheet that won't load leaves the
 * theme on its tokens alone, which still pass the bar, and says so in the
 * console rather than failing the page.
 */
export function loadThemeStyles(name: string): Promise<void> {
  const load = STYLES[name];
  if (!load) return Promise.resolve();
  let p = loaded.get(name);
  if (!p) {
    p = load().then(
      () => undefined,
      (e: unknown) => console.error(`The ${name} theme's stylesheet didn't load, so it shows its colours only:`, e),
    );
    loaded.set(name, p);
  }
  return p;
}

/** `accentInk` becomes `--accent-ink`. */
const prop = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function block(selector: string, scheme: Scheme, tokens: Record<Token, string>): string {
  const lines = TOKENS.map((t) => `  ${prop(t)}: ${tokens[t]};`);
  return `${selector} {\n  color-scheme: ${scheme};\n${lines.join('\n')}\n}`;
}

/**
 * The custom properties for one theme. The first scheme a theme lists is its
 * default. With a second, `data-scheme` picks one, and `system` follows the
 * operating system's preference.
 */
export function tokenCss(theme: ThemeManifest): string {
  const root = `:root[data-theme="${theme.name}"]`;
  const schemes = Object.entries(theme.schemes) as [Scheme, Record<Token, string>][];
  const [first, second] = schemes;
  const f = theme.fonts;
  const out = [
    `${root} {\n  --font-body: ${f.body};\n  --font-display: ${f.display};\n  --font-mono: ${f.mono};\n  --radius: ${theme.radius};\n}`,
    block(root, first![0], first![1]),
  ];
  if (second) {
    out.push(block(`${root}[data-scheme="${second[0]}"]`, second[0], second[1]));
    out.push(`@media (prefers-color-scheme: ${second[0]}) {\n${block(`${root}[data-scheme="system"]`, second[0], second[1])}\n}`);
  }
  return out.join('\n');
}

export const themeNamed = (name: string) => THEMES.find((t) => t.name === name) ?? THEMES[0]!;
