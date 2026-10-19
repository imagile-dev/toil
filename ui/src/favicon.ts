/**
 * The tab's icon follows the theme: each built-in theme's badge is its favicon
 * (#281), and Plain, or any theme without one, shows the standard badge. The
 * page loads with that one (index.html links src/favicon.svg), so a browser
 * without script still shows the mark. Changing the icon is a change to the
 * letterhead, which here needs no committee, only a different href.
 */

/** Each built-in theme's mark, as a URL the build resolves. */
const MARKS: Record<string, string> = {
  plain: new URL('./mark.svg', import.meta.url).href,
  crate: new URL('../themes/crate/assets/mark.svg', import.meta.url).href,
  harvest: new URL('../themes/harvest/assets/mark.svg', import.meta.url).href,
  starship: new URL('../themes/starship/assets/mark.svg', import.meta.url).href,
  realm: new URL('../themes/realm/assets/mark.svg', import.meta.url).href,
};

/** The favicon URL for a theme: its own mark, or the standard badge. */
export const faviconFor = (theme: string): string => MARKS[theme] ?? MARKS.plain!;

/** Points the page's icon link at the theme's mark, adding the link if the page has none. */
export function showFavicon(theme: string, doc: Document = document): void {
  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconFor(theme);
}
