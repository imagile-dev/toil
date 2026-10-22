/**
 * Theme packs (#206, Front end: built to be themed). A theme is data and
 * styling only: `theme.json` (tokens per colour scheme, fonts, motion, assets,
 * the words it renames, and, for a game theme, its wording and agent voice, #283) and a `theme.css` scoped under
 * `[data-theme="<name>"]`. No theme runs script, which test/themes.test.ts
 * holds every theme folder to. This module turns a manifest's tokens into
 * custom properties; built-in skins, which are script, live in src/skins/
 * instead.
 *
 * Every manifest is read up front, since the theme picker lists them all, but
 * a theme's stylesheet (and so its fonts and art) loads only once it is
 * picked. Crate, the default (#277), and Plain, the quiet one, are the two
 * stylesheets in the first load. The
 * paperwork for a new colour now fits on one JSON file, a record for this
 * organisation.
 */

import '../themes/crate/theme.css';
import '../themes/plain/theme.css';
import crate from '../themes/crate/theme.json';
import frontier from '../themes/frontier/theme.json';
import harvest from '../themes/harvest/theme.json';
import overworld from '../themes/overworld/theme.json';
import plain from '../themes/plain/theme.json';
import realm from '../themes/realm/theme.json';
import sprawl from '../themes/sprawl/theme.json';
import starship from '../themes/starship/theme.json';
import { TOKENS, type Scheme, type ThemeManifest, type Token } from './theme-pack.ts';

export { TERMS, TOKENS, type Scheme, type TermKey, type ThemeManifest, type Token } from './theme-pack.ts';

/** The built-in themes, in the picker's order: Plain, the quiet one, first. */
export const THEMES: ThemeManifest[] = [plain, crate, harvest, starship, realm, sprawl, frontier, overworld] as ThemeManifest[];

/**
 * The theme a browser shows until someone picks one (the maintainer's call,
 * #277). Crate is dark only, so the system's light or dark preference doesn't
 * change the default; it still picks Plain's scheme once Plain is chosen.
 */
export const DEFAULT_THEME = 'crate';

/** Each built-in theme's stylesheet, loaded when the theme is first picked. */
const STYLES: Record<string, () => Promise<unknown>> = {
  harvest: () => import('../themes/harvest/theme.css'),
  starship: () => import('../themes/starship/theme.css'),
  realm: () => import('../themes/realm/theme.css'),
  sprawl: () => import('../themes/sprawl/theme.css'),
  frontier: () => import('../themes/frontier/theme.css'),
  overworld: () => import('../themes/overworld/theme.css'),
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

export const themeNamed = (name: string) => THEMES.find((t) => t.name === name) ?? THEMES.find((t) => t.name === DEFAULT_THEME)!;
