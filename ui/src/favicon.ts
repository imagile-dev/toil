/**
 * The tab's icon follows the theme: each built-in theme's badge is its favicon
 * (#281). Plain's badge is in Plain's own blue, so it has one per scheme; a
 * theme the build doesn't know shows the standard badge. The page loads with
 * the standard one (index.html links src/favicon.svg), so a browser without
 * script still shows the mark. Changing the icon is a change to the letterhead,
 * which here needs no committee, only a different href.
 */

export type ResolvedScheme = 'light' | 'dark';

const STANDARD = new URL('./mark.svg', import.meta.url).href;

/** Each built-in theme's mark, as a URL the build resolves: one for both schemes, or one per scheme. */
const MARKS: Record<string, string | Record<ResolvedScheme, string>> = {
  plain: {
    light: new URL('../themes/plain/assets/mark-light.svg', import.meta.url).href,
    dark: new URL('../themes/plain/assets/mark-dark.svg', import.meta.url).href,
  },
  crate: new URL('../themes/crate/assets/mark.svg', import.meta.url).href,
  harvest: new URL('../themes/harvest/assets/mark.svg', import.meta.url).href,
  starship: new URL('../themes/starship/assets/mark.svg', import.meta.url).href,
  realm: new URL('../themes/realm/assets/mark.svg', import.meta.url).href,
  sprawl: new URL('../themes/sprawl/assets/mark.svg', import.meta.url).href,
  overworld: new URL('../themes/overworld/assets/mark.svg', import.meta.url).href,
};

/** The favicon URL for a theme in a scheme: its own mark, or the standard badge. */
export function faviconFor(theme: string, scheme: ResolvedScheme = 'light'): string {
  const mark = MARKS[theme];
  if (!mark) return STANDARD;
  return typeof mark === 'string' ? mark : mark[scheme];
}

/** Points the page's icon link at the theme's mark, adding the link if the page has none. */
export function showFavicon(theme: string, scheme: ResolvedScheme = 'light', doc: Document = document): void {
  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconFor(theme, scheme);
}
