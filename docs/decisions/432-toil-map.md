# The toil map (#432)

- **The map is the home page's hero, and the headline sits in its middle column.**
  On desktop the grid is who asks, toil, what it reaches; the eyebrow and headline
  sit above the badge and the pitch and install command under it. Below 980px it
  stacks: headline, pitch and install first (so the first screen still says what
  toil is), then who asks, toil, what it reaches. The DOM follows the phone order,
  so the reading order is the same everywhere.
- **The headline stays "The token-efficient alternative to MCP."** The pitch is one
  line that says "in between": "One CLI between whoever asks and your enterprise
  tools and databases." The old three-line subtitle and the "See it work" button
  came off (principle 11); the install call to action is the npm command beside
  "Get started". The hero drawing (`hero-diagram-*.webp`) is no longer used on the
  page; the files stay in `public/images/` for now.
- **The reach side is `categories` from `integrations.ts`**, the same list
  `/connect/` draws, so a new board file is a new node. A chip shows what you type
  (the area, or the engine value); its full name, level and sign-in are its label
  and its screen-reader text. `scripts/check-links.mjs` fails when a page under
  `/connect/` has no node on `/map/`.
- **The ask side is three lanes of two nodes, written in `site/src/data/map.ts`.**
  They are the ways in, not an inventory: AI agents (the toil skill, MCP), people
  (the welcome menu, Toil UI) and CI/CD (env vars, the JSON envelope). Each links to
  an existing page or heading, which the link check holds.
- **Toil's centre on `/map/` shows dossiers, util and bounds**, taken from the docs
  path. The home hero leaves them out to keep the hero quiet.
- **Labels on demand.** Hover or focus lights a node's paths, dims the groups it
  doesn't touch and shows its label. On touch, the first tap does that and a second
  tap on the same node follows the link; tapping elsewhere clears it. Escape clears
  it from the keyboard.
- **The list view is `/connect/`**, one link ("All 36 as a list") in the map's reach
  heading, rather than a second rendering of the same data inside the map.
- **Every connection chip shows its level as a dot**, on the hero too (principle 11
  keeps a verification level on screen, never only in a label): hollow for unit,
  half for live, full for stable, so shape, not hue, carries it. The hero has a
  one-line key beside "All 36 as a list".
- **Filters on `/map/` are by verification level only**, which dims the chips at
  other levels. There the filter buttons, with the same dots, are the key. Sign-in and
  read/write filters were left out: the map has no write data to filter on, and
  the sign-in text is in each label.
- **Chips are 34px tall on a fine pointer and 44px on a coarse one**, the rule
  `.btn--sm` already follows, so the desktop map fits in one screen.
- **Motion:** the groups rise in, the wires draw, and one request pulse goes in and
  one answer pulse comes back, ending within five seconds of load (WCAG 2.2.2).
  Hovering a node replays the pulse on its paths. The intro runs on a clock from
  load, so a redraw during it (the resize observer's first callback, the fonts
  arriving) picks the animation up where it was rather than wiping it. Under reduced motion the map is
  still: the wires and labels stay, nothing moves.
- **Wire positions come from offsets, not bounding boxes**, so a wire drawn while
  the groups are still rising lands where the group settles.
- **Colours are site tokens only** (`--color-accent`, `--color-ink`, the lines and
  surfaces, `color-mix` for tints), with none baked into the SVG, so the reskin in
  #442 carries the map over. The hero's glows and underline use the same tokens.
  The badge's own cursor colour is the `Logo` component's and is unchanged here.
