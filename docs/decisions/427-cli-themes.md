# Themes in the CLI: one theme setting for the welcome menu and Toil UI (#427)

- **Terminal versions for every theme on `main`, plus generated splash cues.** The
  colours, the terms the menu borrows, the words and the ornament are written by hand
  in `src/welcome/themes/<name>.ts`, one file a theme, and `test/theme-sync.test.ts`
  holds each to `ui/themes/<name>/theme.json`; a Toil UI theme with no terminal version
  fails it. The splash cues (`moments.splash.motif` and `.line`) are not copied: they're
  read from each `theme.json` at build time by `scripts/gen-areas.mjs` into the ignored
  `src/welcome/themes/moments.generated.ts`, like the skill pages. That's what keeps
  the moments PRs in flight (Realm #440, Frontier #438) passing whichever lands first:
  a theme that gains a splash line shows it in the terminal with no terminal change,
  and the sync test only asks that every enter motif in `ui/src/moments/schema.ts` has a
  terminal rendition. It's data from this repository read at build time, never a
  runtime dependency on Toil UI.
- **Plain is the CLI's default; Toil UI keeps Crate.** `toil theme list` reports
  `source: "default"` when nothing is set, and Toil UI reads that as "no setting", so
  its own default stays Crate, as the maintainer hasn't decided on changing it.
- **Precedence in Toil UI:** the address, then TOIL_THEME, then a theme this browser
  saved before the setting existed (until the first pick), then the file's setting,
  then Crate. A pick writes `toil theme set` and marks the browser as following the
  setting (`synced: true` in its saved choice), so a later `toil theme set` in a
  terminal changes that browser too. The setting is read and written only by the real
  local server (`themeSetting` on `App`, from `local.tsx`), never in the preview or
  with sample data, where the theme stays the browser's own. A refused save shows on
  the page with toil's message; a failed read leaves the browser's theme and says so in
  the console, since an older toil without the commands isn't an error for the person.
- **`toil theme set` is a `config` command, served over MCP and the API.** Toil UI
  reaches toil only through the API, which serves what MCP serves, so it can't be
  `cli-only`. It declares `writesLocal`, so the API's `readOnly` refuses it. It writes
  only the `"theme"` key, and its tool description says to set one only when a person
  asks.
- **An unknown theme is a warning, never a failed command.** The loader checks only
  that `"theme"` is a name (a non-string is `CONFIG_INVALID`), because a theme a newer
  toil added shouldn't break every command in an older one. `toil theme list` and the
  menu's needs-attention list say `THEME_UNKNOWN`, and Plain shows. `"theme"` is
  version 2 only; in a version 1 file it's ignored with `CONFIG_RESERVED_KEY`, like
  `dossierPaths`.
- **Light and dark terminals.** Each theme keeps its `theme.json` colours for the
  scheme it has, and the other scheme is derived by turning each colour's lightness
  over, keeping its hue; then every role is lifted to 4.5:1 on its background. The
  background is read from `COLORFGBG`, else asked of the terminal once with OSC 11
  (with DA1 after it, so a terminal that ignores OSC 11 ends the wait at once; 250 ms
  at most), else taken as dark. On a light terminal the badge's page is white, which is
  Plain's light badge, and the tile and ornament take a deeper shade (mixed 35% toward
  the ink), because braille's fine dots read lighter than their colour on white. There
  is no `TOIL_*` switch for the background; `COLORFGBG` is the standard one and a
  person can set it.
- **16 colours** map by hue, bright for a light colour and normal for a dark one, so
  a light terminal's palette never lands on bright yellow on white. Plain's dark
  palette maps exactly as before.
- **Reduced motion is `TOIL_REDUCED_MOTION`**, with `TOIL_NO_ANIMATION` kept as its
  older name. Neither is reserved in `src/core/config.ts`: they match no area, so
  they're already ignored, and the issue asked only for `TOIL_THEME`.
- **What the theme words:** the attention heading (Realm's "Broken roads (needs
  attention)"), the Connect an agent row ("Summon the dungeon master", its hint
  beginning "Connect an agent:"), and Quit's hint ("Leave the table"). The plain
  words stay beside a renamed heading and in a renamed row's hint, as Toil UI shows
  "Campaign (Epic)". Every row that names a command keeps its plain name. Where a
  theme has a Toil UI term for it (`blocked`, `agent`), the word contains it, and the
  sync test checks that.
- **Ornaments by Toil UI's particles:** none and dust keep the orbit (Plain, Crate),
  leaves are Harvest's crops, stars Starship's warp, embers Realm's, rain Sprawl's,
  steam Frontier's, fairies Overworld's. Each settles by the end of the 3.2 s
  timeline, so the still frame is the picture it lands on. The theme's motif changes
  only how the badge arrives (fade, rise, drop, slide, pop); a loop motif (`bob`)
  isn't played, since nothing in the terminal keeps moving.
- **The splash line** is the theme's `moments.splash.line` in place of "Enterprise
  tools and databases.", wrapped to the text column, which widens with the window:
  three lines at most beside the logo, the third taking the blank line above it
  (Realm's line is 89 characters). The sync test checks every theme's line shows in
  full at 80 and 120 columns.
- **Two Weeks' Notice keeps toil's own palette** in every theme: it's a hidden game
  with its own colour rules, and theming it was out of the issue's scope.
- **The parity suite's config file.** `theme set` is the first config command over
  MCP that writes the config file, and the test context pointed at
  `/home/test/.toil/config.json`, which on Windows is a real path. The context now
  takes `configFile`, and the parity suite points it into its temp home, which is
  reset before each run.
- **Screens checked in xterm.js.** The welcome menu's real byte stream, from
  `runWelcome` in-process, was replayed into xterm.js (the terminal emulator VS Code
  uses) with Windows Terminal's Campbell and One Half Light schemes and screenshotted
  in headless Chrome, rather than a terminal window driven by hand.
