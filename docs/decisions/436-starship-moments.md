# Theme moments for Starship (#436)

- **The block follows #419 exactly**: a splash, a loader, the tips label, an entrance,
  tab transitions, all six event moments and the recap label, in `ui/themes/starship/theme.json`,
  played by the one engine. No engine change, no new motif, no new key.
- **The splash is the main viewscreen as the ship drops out of warp**: star streaks
  shortening into points around a small ringed planet, generated with gpt-image-2 through
  the OpenAI Images API (medium, 1536×1024, one attempt, about $0.05), from a new style file,
  `.claude/image-generation/style-starship.md`, that holds the theme's own palette and rules
  out any recognisable craft, insignia, people or text. It was cropped to its centre, its
  edges faded into the page's own `#05070f` so it needs no blend mode, and written as a
  720×480 WebP of 13 KB, drawn at 480×320. It arrives by `pop`, the overshoot of dropping
  out of warp.
- **The splash has no loop.** A first pass gave it `pulse`. The trace showed that the
  engine's enter animation and the CSS loop both animate `transform` on the same image, so
  Chrome ran both on the main thread (composite failure 64, incompatible animations) instead
  of the compositor. With no loop, every animation in the trace is composited. Crate's
  `rise` with `bob` has the same pairing (4 animations not composited in its trace); that
  is the engine's, left for its own change rather than fixed inside a theme PR.
- **The splash has no starfield behind its words.** The page's starfield, laid behind the
  splash, ran through the letters at 1440px; the splash keeps a faint cyan glow on the
  page's black, and the stars stay in the picture.
- **The loader is a sensor sweep**: an eight-frame sprite sheet of a scope whose arm turns
  a full revolution, contacts brightening as it passes and fading after (`frames`), over six
  console lamps lit in turn (`blink`). It is drawn at 128 px, the width a panel-size loader
  gives the art (8rem), so a sprite sheet's frame box is never narrower than its frame.
  It replaces the jump-to-lightspeed Loading skin on every loading screen; the skin and its
  art stay in the theme, as Crate's and Harvest's did in #419, since the engine falls back
  to it if the block's loader is ever removed.
- **Every other picture is hand-drawn SVG** from a scratch script, 0.5 to 9.4 KB each:
  console plates with HUD corners, a hexagon with a check (Objective complete), a steady
  trace and three lit bars (Systems nominal), a warning lamp in the theme's danger red
  (Red alert), a dim broken hazard and a clear heading in green (All clear), a module
  locked to a port (Docking complete), and a planet with one orbit closed (Mission
  complete). The glows are SVG filters, rasterised once with the image, never CSS filters
  that would repaint as it moves. The moment art is 28 KB, which brings the theme's assets to 158 KB of its 320 KB.
- **Words in the ship's log voice**, formal and calm, with no exclamation marks: the
  splash says "Dropping out of warp. Bringing the dossiers on screen.", six flavour lines
  are bridge routine, tips are framed as "Standing orders", and the recap card is the
  "Mission debrief". "Red alert" and "All clear" are the build failing and a blocker
  clearing, as the issue names them; a passing build is "Systems nominal", which keeps
  "all clear" for the hazard the theme already calls blocked work.
- **Entrance `sweep`, tabs `fade`.** A dossier arrives the way the ship does, from the side
  with a little skew; a tab is the main screen changing channel, so it only fades.
- **Moment cards are holo panels**, the same border, glow and accent edge as the theme's
  cards. A red alert's edge and label are the theme's danger colour, and a done item, a
  passing build and a cleared blocker are its green. Colour and frame only, scoped to the
  theme, with no animation of its own.
- **The performance trace was taken with headless Chrome on software compositing**
  (`--disable-gpu`, as the layout check runs it) on the built `toil-ui --sample`, at 1440
  px, with every request slowed by 250 ms: the sprint recap played over Settings while
  card-payments opened underneath with its real loader. Its frame intervals are reported
  as measured, including the frames over 20 ms and what was running in them; Crate, the
  shipped reference, traced the same way on the same machine, for comparison.
