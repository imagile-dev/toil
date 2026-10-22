# Theme moments for Frontier (#438)

- **The block follows #419 exactly**: a splash, a loader, the tips label, an entrance,
  tab transitions, all six event moments and the recap label, in
  `ui/themes/frontier/theme.json`, played by the one engine. No engine change, no new
  motif, no new key.
- **The splash is a train pulling into the depot through its own steam**, generated with
  gpt-image-2 through the OpenAI Images API (medium, 1536×1024, one attempt, about $0.05)
  from the theme's existing style file, `.claude/image-generation/style-frontier.md`, which
  already rules out text, people, animals, badges and any railroad company's designs, so no
  new style file was needed. The one mark the model put on the smokebox door, a glyph like
  a numeral, was blurred into a plain brass boss before it was written as a 720×480 WebP
  of 33 KB, drawn at 480×320. It arrives by `sweep`, which moves it in from the right with
  a lean, the way the engine in the picture is travelling.
- **The splash is a station notice, not a picture on the planks.** Frontier's rule is that
  words sit on paper and never on the wood, so the splash's picture, name, line, progress
  and tip sit on a handbill in the same riveted brass plate as the panels, over the page's
  own washed wood.
- **The splash has no loop**, for #436's reason: a loop on the image would animate
  `transform` on the same element as the engine's enter animation and push both onto the
  main thread.
- **The loader is a pressure gauge getting up steam**: an eight-frame sprite sheet whose
  needle climbs toward the red and falls back while the safety valve lets off a puff at the
  peak (`frames`), over five puffs of steam raised in turn (`grow`). It is drawn at 128 px,
  the width a panel-size loader gives its art. It replaces the locomotive Loading skin on
  every loading screen; the skin and its art stay in the theme as the engine's fallback, as
  Crate's, Harvest's and Starship's did.
- **Every other picture is hand-drawn SVG** from a scratch script, 0.5 to 6.7 KB each: a
  riveted brass boiler plate holding a handbill, and on it PAID stamped crooked in rust red
  (its letters drawn as strokes, so no font is needed), a brass steam whistle blowing a
  plume, a gauge burst past the red with cracked glass, a whole wheel back on its axle with
  the wrench, a telegram signed and closed with a plain wax seal (no star, no shield), and a
  pocket watch at a quarter past five. The moment art is 52 KB, which brings the theme's
  assets to 163 KB of its 320 KB.
- **Words in the telegraph operator's voice**, dry and short, with no exclamation marks:
  the splash says "Train's pulling in. Unloading the dossiers at the depot.", the six
  flavour lines are engine-house chores, tips come "Off the wire", and the recap card is
  the "Tally at the railhead". The labels follow the theme's own terms: a work item is a
  claim, so done is "Paid in full"; a build is the boiler test, so it passes with "Full
  head of steam" and fails with "Boiler's blown"; a blocker is a busted axle, so clearing
  it is "Axle mended"; a pull request is a telegram waiting on the sheriff's signature, so
  merging it is "Telegram signed"; and the sprint is the cattle drive, so its end is "The
  drive's in", on the watch at 5:15.
- **Entrance `slide`, tabs `fade`.** A dossier pulls in like a train at the platform; a tab
  is the next page of the same notice, so it only fades.
- **Moment cards are handbills in brass plate**, the panels' border image, with the label
  in Rye. A blown boiler's label is the theme's danger red; a paid claim, a steady whistle
  and a mended axle are its green. Colour and frame only, scoped to the theme, with no
  animation of its own.
- **The performance trace was taken the way #436 took it** (headless Chrome, software
  compositing, 1440 px, every request slowed by 250 ms, the sprint recap over a dossier
  opening with its real loader, then a fresh launch for the splash), with Crate traced in
  the same run on the same machine as the reference, since other agents' builds were
  running beside it.
