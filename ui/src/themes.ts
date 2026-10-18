/**
 * Theme packs (#206, Front end: built to be themed). A theme is data and
 * styling only: `theme.json` (tokens per colour scheme, fonts, motion, assets)
 * and a `theme.css` scoped under `[data-theme="<name>"]`. No theme runs script,
 * which test/themes.test.ts holds every theme folder to. This module turns a
 * manifest's tokens into custom properties; built-in skins, which are script,
 * live in src/skins/ instead. The paperwork for a new colour now fits on one
 * JSON file, a record for this organisation.
 */

import '../themes/crate/theme.css';
import crate from '../themes/crate/theme.json';
import '../themes/plain/theme.css';
import plain from '../themes/plain/theme.json';

/** The tokens every theme defines for every scheme it offers. */
export const TOKENS = [
  'bg', 'surface', 'raised', 'ink', 'muted', 'line', 'accent', 'accentInk', 'link', 'focus',
  'ok', 'warn', 'danger', 'bannerBg', 'bannerInk',
] as const;
export type Token = (typeof TOKENS)[number];
export type Scheme = 'light' | 'dark';

export interface ThemeManifest {
  name: string;
  label: string;
  description: string;
  schemes: Partial<Record<Scheme, Record<Token, string>>>;
  fonts: { body: string; display: string; mono: string };
  radius: string;
  motion: 'none' | 'subtle';
  sounds: Record<string, string>;
  assets: Record<string, string>;
}

/** The built-in themes. Their CSS is imported above; it applies only under its own `data-theme`. */
export const THEMES: ThemeManifest[] = [plain as ThemeManifest, crate as ThemeManifest];

export const DEFAULT_THEME = 'plain';

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
