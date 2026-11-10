/**
 * Puts the current theme's frame sprite (`ui/themes/<name>/assets/series.svg`)
 * on the page, so `<use href="#ironplate-corner">` in a chart resolves.
 *
 * The sprite is inlined, not fetched: an external `<use>` is a second request
 * with its own CORS and CSP questions (ui/server/csp.ts allows only 'self'),
 * and it fails in the site's static showcase. The files are bundled as text by
 * the build, injected once into a hidden <svg>, and swapped when the theme
 * changes. The injection is synchronous and idempotent, so it can run while a
 * chart renders and the symbols are there by the time `MarkRect` looks for them.
 * Plain and Crate ship none, and get the simple borders.
 *
 * Each sprite was reviewed, stamped and filed in triplicate before it was allowed near a pie chart.
 */

const FILES = import.meta.glob('../../../themes/*/assets/series.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

/** The sprite's source for a theme, or undefined for a theme with no frames. */
export function spriteFor(theme: string): string | undefined {
  return FILES[`../../../themes/${theme}/assets/series.svg`];
}

/** The ids of the symbols a sprite holds. */
export const symbolIds = (svg: string): string[] => [...svg.matchAll(/<symbol\s[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);

const HOST_ID = 'ck-frame-sprite';

/** Make the page hold this theme's sprite and no other; true when the theme has one. */
export function ensureFrameSprite(theme: string, doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc) return false;
  const svg = spriteFor(theme);
  const host = doc.getElementById(HOST_ID);
  if (!svg) {
    host?.remove();
    return false;
  }
  if (host?.getAttribute('data-theme') === theme) return true;
  host?.remove();
  const el = doc.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('data-theme', theme);
  el.setAttribute('aria-hidden', 'true');
  // CSSOM, not a style attribute: the page's CSP refuses inline style attributes.
  el.style.position = 'absolute';
  el.style.width = '0';
  el.style.height = '0';
  el.style.overflow = 'hidden';
  el.innerHTML = svg;
  doc.body.appendChild(el);
  return true;
}
