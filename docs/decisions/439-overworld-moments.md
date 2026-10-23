# Overworld's theme moments (#439)

- **The block follows #419 exactly**: a splash, a loader, the tips label, an entrance,
  tab transitions, all six event moments and the recap label, in
  `ui/themes/overworld/theme.json`, played by the one engine. No engine change, no new
  motif, no new key.
- **Every picture is drawn, pixel by pixel, not generated: no cost.** A scratch script
  places each pixel from the theme's own palette (`style-overworld.md`'s colours, plus a
  few shades between them), so no prompt, model or reference image was involved, and
  nothing is copied from any game. The splash and the loader are raster, since a
  procedurally drawn landscape as SVG rectangles would run past the 64 KB a file allows:
  lossless WebP at one pixel per art pixel, drawn larger by the theme's existing
  `image-rendering: pixelated`. The six moments and the footprint are hand-written
  16×16 and 6×6 grids, written out as SVG like the theme's chests and key. The moment
  art is 26 KB, which brings the theme to 165 KB of its 320 KB.
- **The splash is a pixel title card**: the road winding from a small hooded traveller,
  seen from behind, up through a night meadow to the sage's cave in the mountains, a
  torch at its mouth and his fire inside, under a crescent moon, in a gold rule. It is
  112×70 art pixels, drawn at 3x (336×210) on a phone and 4x (448×280) from 600px, so
  every pixel stays square; a scale between the two would draw some pixels wider than
  others. It arrives by `drop` and has no loop, so the engine's arrival is the only
  animation on it (the lesson of #436's trace).
- **The loader is the map scrolling under the traveller**: an eight-frame sprite sheet of
  a 32×32 stone-framed window on the overworld, each frame the map moved four art pixels,
  so the eighth meets the first, while the traveller walks the road in a two-pose step.
  Drawn at 128 px, a panel-size loader's width. Its track is six footprints on the
  `march`. It replaces the sage's cave as the Loading skin on every loading screen; the
  skin and its art stay in the theme as the fallback, as Starship's did in #436.
- **The moments name the issue's motifs**: a chest opening on a rising gem for an item
  done (Quest complete), a brazier lit for a passing build (Trial cleared) and snuffed
  and cracked for a failing one (Trial lost), a door swung open on a lit room for a
  cleared blocker (Door unlocked, since a blocker is the theme's locked door), a key
  raised on a plinth for a merge (Item obtained, the item the shop appraised), and a
  campfire at the road's end for the sprint's end (Journey's end), with "Tales of the
  journey" on the recap card. No hero holds the key aloft: that pose belongs to a
  franchise, so the key stands on its own.
- **The words are the sage's**: the splash says "The map unrolls. The road begins at
  your dossiers.", the six flavour lines are a traveller's road (unrolling the map,
  asking the fairies which way the tracker went, waiting for the drawbridge), and the
  tips are "The sage's counsel". Every phrase is the genre's, none a quotation.
- **Entrance `slide`, tabs `fade`.** A dossier arrives the way a new screen of the map
  scrolls in from the side; a tab is a room in the same dungeon, so it only fades.
- **Moment cards and tips are the sage's dialogue box**: the double bone rule and dark
  floor of `.ow-sage`, with a pixel drop shadow, and the label in the pixel face. A lost
  trial's border and label are the theme's danger red; a quest, a cleared trial and an
  unlocked door are its green. Colour and frame only.
- **Theme motion off now stops Overworld's own entrances too.** The chest's hop and the
  key's lift play once as a card arrives in its column, so they are entrances, and Theme
  motion off promises none; both are gated on `:not([data-theme-motion="off"])`, as
  Sprawl's were in #437. A test holds them to it.
- **The performance trace ran Overworld and Crate in one run, alternated, twice**, on the
  built `toil-ui --sample` in headless Chrome on software compositing (`--disable-gpu`, as
  the layout check runs it) at 1440px, since this machine is shared with other agents and
  a reference measured at another time would compare nothing. Each run plays the splash,
  the loader and all six moments from the previews, then opens card-payments with every
  request slowed by 250 ms (its real loader and entrance) and changes tab, with a
  `requestAnimationFrame` recorder running throughout, as #437 measured. Every picture is
  shown once before the recorder starts, so the run measures motion, not a first decode.
- **The frame-by-frame check holds each animation still for its shot**: the engine's Web
  Animations are paused as they start and stepped by `currentTime`, CSS loops through
  `getAnimations()`, and an event moment's hold timer is kept back until its arrival is
  shot, then released to step its fade out. Headless Chrome's virtual time was tried first
  and dropped: it starved the app's image decodes and React's scheduler, so frames came
  back without their art.
- **The sage's fire flickers by opacity now.** The Loading skin's flicker animated
  `filter: brightness`, which repaints; it is the fallback now, but the theme's rule is
  `transform` and `opacity` only, and a test holds every keyframe in the theme to it.
