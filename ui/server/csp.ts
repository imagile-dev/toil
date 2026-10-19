/**
 * The Content-Security-Policy on every response, the boundary that keeps a
 * theme (or anything else on the page) from reaching another origin, whatever
 * its CSS says: scripts, styles, images, fonts and requests come from this
 * server only. No inline script, and no inline style but React Aria's one
 * rule, by hash: the App adopts its theme tokens as a constructed stylesheet,
 * and the build keeps fonts as files. `data:` images stay, for the small SVGs
 * the build inlines; a data: image can't make a request. No form submits
 * anywhere, and no page frames this one.
 * A visitor badge for every byte, with no escort available on request.
 */

/**
 * The one inline style the app allows, by its hash rather than
 * `'unsafe-inline'`: the rule React Aria's press handling adds to the page
 * (`touch-action` on pressable elements, so a tap isn't read as a scroll).
 * test/server.test.ts recomputes it from React Aria's own source, so an
 * upgrade that changes the rule fails there instead of quietly in a browser.
 */
export const PRESSABLE_STYLE_HASH = 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=';

export const DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' '${PRESSABLE_STYLE_HASH}'`,
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

export const CSP = DIRECTIVES.join('; ');

/**
 * The same policy as a <meta> tag, for the site preview, which a static host
 * serves without our headers. A meta policy can't carry `frame-ancestors`,
 * so that one is left to the header.
 */
export const META_CSP = DIRECTIVES.filter((d) => !d.startsWith('frame-ancestors')).join('; ');
