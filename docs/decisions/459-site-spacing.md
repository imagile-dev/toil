# The hero's underline, section spacing, and a blank hero on phones (#459)

- **The headline's emphasis is gradient text alone.** "token-efficient" kept its
  gradient (`text-gradient`) and lost the 3px gradient bar under it, with the bar's
  draw-in animation. One emphasis reads as emphasis; two read as a link. Where:
  `site/src/pages/index.astro`.
- **Three layout tokens frame every page**, in `site/src/styles/global.css`:
  `--gutter` (16px on a phone up to 48px), `--section-space` (48px to 96px) and
  `--section-space-tight` (40px to 64px), all `clamp()` on the viewport. `.container`,
  `.section`, `.section--tight`, the home hero, the page hero, the footer, `/ui/`'s
  hero and closing band, the 404 page and `/map/`'s wider frame use them. The
  existing `--space-*` steps stay for spacing inside a component. A docs page's own
  `padding-block` (`--space-lg`) is unchanged: it sits under the page hero, which
  already carries the scale.
- **The content width went from 1180px to 1280px.** At 1440px that leaves 80px
  either side instead of 130px, so the map and two-column
  sections use the screen without running edge to edge on a wide monitor.
- **A section heading may run to 46rem; its paragraphs keep the 62ch measure.**
  The heading was held to 60ch with the paragraphs, so the Connect heading broke
  over three lines with half the row empty beside it. The Connect row is now 1.25fr
  of text to 0.75fr of art, and the art's `sizes` hint follows (460px).
- **Hero text rises but never fades.** The home hero's headline, pitch and install,
  and every page hero's title and lead, were `opacity: 0` until their entrance
  animation ran, which on a phone left the hero blank while the map drew in. They
  now keep only a 10px rise, behind `prefers-reduced-motion: no-preference`, so the
  text is readable on the first paint with or without JavaScript and with reduced
  motion. The map's own assembly (`.tmap__in`, the wires and the request flow) is
  unchanged: it is the map's motion, and the text no longer waits on it.
