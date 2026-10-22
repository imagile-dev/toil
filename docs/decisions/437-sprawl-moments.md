# Sprawl's theme moments (#437)

- **The splash is a two-frame sprite sheet that tears from a boot log into the skyline.**
  The engine plays one picture per splash and only fixed motifs, so the glitch is the
  sheet's own strip moved by `transform` from Sprawl's `theme.css`, inside
  `prefers-reduced-motion: no-preference` and only at Theme motion full: the log holds,
  the strip cuts twice to a torn position (part log, part skyline, so the seam reads as
  a signal tearing) and lands on the skyline. Subtle makes one clean cut; off has no
  splash, as in every theme. The engine's own `fade` brings the picture in.
- **Flash safety is a test, not a promise.** Four cuts in a third of a second make two
  flashes, the readout's dip on a moment's label one, the cursor's blink under one a
  second and the loading art's old flicker under one; all are on dark pictures and
  small areas. `steppedFlashRates` in `ui/test/themes.test.ts` counts every stepped
  animation in Sprawl's stylesheet and fails any over three flashes a second
  (WCAG 2.3.1). The data shard's `frames` loop is the engine's (four frames in 0.9 s),
  and each frame changes only a row of cells a few pixels square.
- **The art is drawn, not generated: no cost.** The boot log is HTML in Fira Code and
  Chakra Petch (both SIL OFL 1.1, already bundled) rendered in headless Chrome at 2x; the
  skyline frame is a crop of Sprawl's existing `skyline.webp`, so the city on the splash
  is the one at the foot of every page. The sheet is a 47 KB WebP (1344 x 420, quality
  80). The loader's data shard is a four-frame SVG sprite sheet, each frame one more
  row of its cipher turned cyan, and the six event pictures and the cipher block are
  hand-written SVG in the theme's palette. 59 KB of moment art, 135 KB for the theme
  with the art it had. No names, emblems or characters from any franchise.
- **The words follow the lexicon from #412**: a gig closed, the ICE breached (a build
  passed: the netrunner got through), tripped the ICE (a build failed), black ICE
  cracked (a blocker cleared), a payload delivered (a merge), the end of the run, and
  a "Run debrief" recap. Tips are "Word on the street". The flavour lines aim at
  systems, never people, as the voice does.
- **Entrance `sweep`, tabs `fade`.** The skewed slide is the closest motif to a signal
  catching. The tab change was Sprawl's own clip-path scan-in on `.tab-panels > *`;
  that is the engine's transition now, so the theme's rule went, rather than two
  animations playing on one change.
- **Theme motion off now stops Sprawl's own entrances too.** The page title's glitch and
  the panels' scan-in are entrances, and Theme motion off promises none, so both are
  gated on `:not([data-theme-motion="off"])`. The cursor's blink, the live edges'
  current and the rain are ambient, and still follow Reduce motion and effects and the
  particle switch, as before.
- **The page title's glitch moves by `transform` only now.** It also animated
  `text-shadow`, which the trace showed as the one animation Chrome couldn't
  composite; the title keeps its static chromatic split, so the jitter looks the same.
- **The performance trace measures frames with a `requestAnimationFrame` recorder** as
  well as Chrome's trace. Sprawl's rain draws at the particle engine's 30 fps by design,
  so between its beats the compositor presents nothing new, and a trace's presented-frame
  gaps read as 37 ms frames even on a page where nothing else moves; a frame loop
  running through the moments shows what a person would see miss a beat.
- **The progress line gets a `>` prompt** drawn in CSS with empty alternative text,
  as the question bubble's already is, so a screen reader reads only the progress.
