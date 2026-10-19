import { afterEach, describe, expect, it } from 'vitest';
import { faviconFor, showFavicon } from '../src/favicon.ts';
import { THEMES } from '../src/themes.ts';

/** The tab's icon is the theme's badge (#281). */
describe('the favicon', () => {
  afterEach(() => document.head.querySelectorAll('link[rel="icon"]').forEach((l) => l.remove()));

  it("is each built-in theme's own mark, and Plain's is the standard badge", () => {
    for (const theme of THEMES.filter((t) => t.name !== 'plain')) expect(theme.assets.mark, theme.name).toBe('assets/mark.svg');
    // The build hands back a URL or, for a small file, the file inlined; either way, one per theme.
    const icons = THEMES.map((t) => faviconFor(t.name));
    expect(new Set(icons).size).toBe(THEMES.length);
    for (const icon of icons) expect(icon).toMatch(/^(data:image\/svg\+xml|.*\.svg$)/);
  });

  it("falls back to the standard badge for a theme the build doesn't know", () => {
    expect(faviconFor('my-own-theme')).toBe(faviconFor('plain'));
  });

  it('points the page icon link at the mark, adding one when the page has none', () => {
    showFavicon('harvest');
    const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.href).toBe(faviconFor('harvest'));
    expect(links[0]!.type).toBe('image/svg+xml');
    showFavicon('realm');
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href).toBe(faviconFor('realm'));
  });
});
