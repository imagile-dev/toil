# Theme moments for Realm (#440)

- **Built from the one d20.** Realm already had a hand-drawn d20 (`assets/d20.svg`) that
  tumbles in its Loading skin. The moments use that asset by its key and add no second
  die: the splash throws it into a dice tray, the loading screen tumbles it in the same
  tray, and a passed build is a **Natural 20**, the same die face up. A test holds the
  theme to one d20 asset.
- **One new loop motif, `tumble`, in the engine.** The engine's loops (`bob`, `sway`,
  `roll`, `pulse`, `frames`) have no full turn, and a theme may not add keyframes of its
  own to the engine's parts (#419). So `tumble` joins `LOOP_MOTIFS`
  (`ui/src/moments/schema.ts`, `moments.css`): most of a turn at once, the rest as it
  settles, a beat at rest face up, by `transform` only, at Theme motion full only, like
  every loop. Its keyframes are the Loading skin's roll, so the die moves the same way in
  both. A test holds every loop a theme may name to a rule in the engine's stylesheet.
  The Loading skin stays as the engine's fallback, as Crate's, Harvest's and Starship's
  did.
- **"A d20 rolled on the sprint's day" is the splash's throw, not a number.** The issue
  suggests a d20 rolled on the sprint's day. The splash plays while the first read runs,
  before any dossier or sprint is known, and the engine's splash takes one picture and a
  line, never data, so there is no day to show. The die lands twenty up, as it always
  rests. Rolling it to the day would need the engine to pass data to a splash, which no
  other theme needs; left out.
- **The dice tray is the one generated picture.** An engraved etching from
  `.claude/image-generation/style-realm.md` (gpt-image-2 through the OpenAI Images API,
  medium, 1536x1024, one attempt, about $0.05): an empty, iron-cornered dice tray on a
  dark table with one candle. Cropped to the tray, softened slightly so the WebP stays
  small, framed in iron with a gold hairline, 720x480 at 20 KB. It is a CSS background
  of the splash's column and of the view-size loader's stage, never an `<img>` the motif
  moves, so the die moves and the tray stays put. The die lands at the tray's centre at
  every width: the tray is three wide to two high, so its middle sits a third of the
  column's width down, and the die's margins come from that (`--realm-tray` in
  `theme.css`). The panel-size loader has no room for it and keeps the die alone.
- **Every other picture is hand-drawn SVG** in the theme's iron, tarnished gold, oxblood
  and vellum: a candle (the progress track, `blink`, five kindled in turn), a sealed
  scroll (Quest complete), a sword snapped above the guard (Critical fail), the broken
  road's keep with its gate raised and the road running through (The road is open), the
  house ledger open with a quill (Entered in the ledger), and the rest days' camp fire
  drawn larger (Long rest). No franchise names, emblems, characters or typefaces; the
  fonts are unchanged (Grenze Gotisch and EB Garamond, both OFL). The moments add 27 KB;
  the theme is at 146 KB of its 320 KB.
- **The words are Realm's lexicon.** Natural 20 and Critical fail are the theme's own
  `passed` and `failed` terms (a test holds them together), the sprint's end is a
  **Long rest** with a **Session recap** card, the tips come **From the rulebook**, and
  the flavour lines name the quest log, initiative, hit points, experience points, saving
  throws, the dungeon master and a short rest. Every label shows beside the plain word,
  as the engine does ("Critical fail (Build failed)"). A failed build's label is in the
  theme's danger red.
- **Entrance `drop`, tabs `fade`.** A ledger set down on the table as a dossier opens, a
  page turned between tabs: the quietest pair that still reads as Realm.
- **No drop shadow on the moving die.** A first pass put `filter: drop-shadow` on the
  splash's and the loader's d20. On the dark tray it barely showed, and a filter on an
  element whose transform animates is more for the compositor to do, so it came off
  before the trace was taken.
- **The trace.** The bar is no frame over 20 ms. The figures come from `requestAnimationFrame`
  intervals and Chrome's frame reporter (dropped frames), per phase, in headless Chrome
  with GPU compositing at 1440 px, on a display whose frame is 18.1 ms. Presented-frame
  intervals alone overstate it for Realm: its embers draw at 30 frames a second by design
  (`ui/src/ambient/engine.ts`) and its candle flicker steps, so when a moment holds still
  the next frame is legitimately 33 to 36 ms away. The first time any preview opens in a
  session, Chrome rasterises the overlay once (about 90 ms on the GPU thread); Crate,
  traced the same way on the same machine, does the same, so it is the browser's
  warm-up, reported separately and not a moment's frame.
