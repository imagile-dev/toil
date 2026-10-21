# A Toil UI showcase page at /ui/ (#374)

- **The app in the frame is the real app**, the preview build the site already made
  (`scripts/ui-preview.mjs`), in an `<iframe>`, not screenshots and not a copy of its
  components in Astro. Rebuilding the app's components inside the site would need
  React, its CSS and its fixtures in the site build, and would be a second app to keep
  in step. The frame is the product itself, so it can't drift.
- **The preview moved from `/ui-preview/` to `/ui/app/`,** and `/ui-preview/` now
  forwards to `/ui/` with its query and hash (`site/src/pages/ui-preview.astro`), where
  the showcase opens that theme and that route in its frame. Old links such as
  `/ui-preview/?theme=realm#/dossier/settlement` still land on the same view. The
  forwarding page is left out of the sitemap.
- **On a wide screen the framed app is laid out at 1440 px and scaled to fit**
  (`site/src/scripts/ui-showcase.ts`). Below 1440 px the app folds its header into a
  Menu, so at the site's container width the frame would show the tablet layout.
  Scaling starts only when the frame is at least 70% of 1440 px; narrower, a phone
  sees the app's own phone layout at full size.
- **The tour presses buttons in the frame for four views** (Board scrolls to the board,
  Ask opens the chat and asks the risk question, Agent switcher opens the switcher,
  Ticket the work types a request no ticket covers). It finds each control by its
  visible name or a data attribute, which no theme renames. If one goes missing, the
  view still opens and the caption says what to press. After pressing, focus goes back
  to the view button and the page stays where it was, except for the switcher, whose
  popover closes when focus leaves it.
- **The voice comparison is drawn from Toil UI's source at build time**
  (`site/src/lib/ui-showcase.ts`): the prompt is the server's own `systemPrompt()` and
  `promptStyle()`, split into its three layers at the headings `systemPrompt()` joins
  them with. The answers are the scripted agent's `SCRIPTS` and `VOICED`, the wording
  is `src/wording.ts` and each `theme.json`, the checkbox rows are the table in
  `ui/docs/themes.md`, and the start command is `ui/README.md`'s "Start it". If any of
  them changes shape, the build stops with an error naming the file.
  The site build is optional on a PR, so `ui/test/showcase.test.tsx` holds the same
  reading, and the controls the tour presses, to the app inside Toil UI's own suite,
  which `CI ok` requires.
- **The comparison is two columns: the standard text, and the theme you pick.** Five
  columns side by side don't fit a phone. Two columns also keep the page to Plain's
  and Crate's colours while either is picked, which is what the strict AA bar is
  checked against.
- **Cards drawn in a theme use that theme's tokens and fonts**, not its `theme.css`.
  The theme stylesheets style the app's own class names and expect `app.css` under them,
  which would restyle the site's own elements. The site imports the game themes' fonts
  (the weights each `theme.css` loads) on this page only, so a Harvest card reads in
  Pixelify Sans. That adds five `@fontsource` packages to `site/`, pinned to the
  versions `ui/` already uses.
- **A theme's colours appear on this page.** The site skill allows no second hue, but
  Plain's blue and Starship's cyan are what those themes look like, in the frame and
  in the cards drawn in them. The site's own chrome stays in its palette.
- **The preview's banner now says "Toil UI alpha, on sample data."** "Preview of an
  unreleased product" stopped being true when `@imagile-dev/toil-ui` reached npm, and
  the page beside it now says how to install it. The scripted agent's reply to an
  unscripted question says the installed app sends it to the agent you pick.
- **The three `ui-*` figures on `/docs/themes/` were retired, not reshot.** They showed
  the docked chat from before #343. The showcase shows every theme live, so
  `ui/docs/themes.md` links to it instead. The dossier docs' Toil UI screenshot was
  reshot from the current app, and the homepage reuses it.
- **"Toil UI" sits in the header after Integrations, and in the footer.** With one more
  link, the inline row no longer fit between 720 and 800 px, so the header folds into its
  Menu below 800 px instead of 720 px (`SiteHeader.astro`, and the site skill).
