/**
 * Where a theme's moment art is served from (#419). A moment names its art by
 * the key it has in the theme's `assets`, and this turns that into the URL the
 * build gave the file. Every theme's assets are known to the build up front,
 * so nothing is fetched from anywhere but the app's own origin, and a key the
 * theme doesn't list is simply no picture (the test on theme.json refuses one
 * before it ships).
 * Every picture signed out from the stores by its catalogue number, never by aisle and shelf.
 */

import type { ThemeManifest } from '../theme-pack.ts';

const FILES = import.meta.glob('../../themes/*/assets/**/*.{svg,webp,png,avif}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The URL of the asset a theme lists under `key`, or null. */
export function assetUrl(theme: Pick<ThemeManifest, 'name' | 'assets'>, key: string | undefined): string | null {
  const path = key ? theme.assets[key] : undefined;
  if (!path) return null;
  return FILES[`../../themes/${theme.name}/${path}`] ?? null;
}
