# The Imagile mark in one colour on the site (#468)

- **A traced `currentColor` SVG, not a CSS mask on the PNG.** Both were drawn at 20px
  (the header) and 64px (the footer) in headless Chrome at 1x and 2x, in the header's
  muted ink on `--color-bg`. The trace was crisper: its edge energy (the mean
  luminance step between neighbouring pixels) was 0.027 against the mask's 0.019 at
  1x and 0.045 against 0.034 at 2x, and its strongest pixels reach the token's full
  8.5:1 at 2x where the mask's stop at 7.5:1. Downsampling the 64px and 128px PNGs
  blurs the antialiased line art twice; the vector is rasterised once at the target
  size. It also stays visible in forced colours (Windows contrast themes), where
  `color` is forced and `currentColor` follows, while a mask's `background-color`
  would be painted over with the page's own colour. Applies to
  `site/src/components/ImagileMark.astro`.
- **How the trace was made.** The 128px PNG's alpha, upscaled to 1024px with Lanczos,
  traced by potrace (threshold 140, turd size 20, tolerance 0.4) in a scratch folder,
  then scaled to a 128-unit viewBox at one decimal: one `<symbol id="mark">` in
  `site/public/images/imagile-mark.svg`, 28 KB (about 10 KB gzipped), cached once and
  referenced with `<use>` by both instances rather than inlined into every page. The
  tracer is not a dependency of anything in the repository.
- **The PNGs stay.** `imagile-mark-64.png` and `-128.png` are no longer referenced by
  the site, but they are the artwork the trace came from, in its own colours, and
  the issue says to leave the source alone. A later retrace starts from them.
- **Colours.** The header byline: `--color-muted` at rest (8.5:1 on `--color-bg`),
  `--color-ink` on hover and focus (15.7:1), matching the name beside it. The footer
  panel: `--color-muted` at rest and `--color-accent` on hover and focus, picking up
  the accent border that lights with it; on the panel's lightest ground, the
  gradient's corner (about `#273240`), that is 5.9:1 and 7.1:1. Every figure clears
  the 3:1 non-text contrast of WCAG 2.2 1.4.11. Focus uses the site's existing
  `:focus-visible` outline.
- **Motion.** The mark's tilt on hover and focus now sits behind
  `prefers-reduced-motion: no-preference`; only the colour change happens under
  reduced motion.
- **Nowhere else.** The mark appears only in `SiteHeader.astro` and `SiteFooter.astro`;
  `functions/feedback/`, `ui/` and the rest of `site/` were searched and don't use it.
