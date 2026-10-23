# #467: Crate is the default theme everywhere

Decisions an agent made by default while building #467, for the maintainer to keep
or overturn. The maintainer's own call is on the issue: "Keep Crate as the default
everywhere, including the CLI."

## One constant, in a file with no imports

- **What:** `src/theme/default.ts` exports `DEFAULT_THEME = 'crate'` and nothing else.
  The welcome menu reads it through `src/welcome/themes/index.ts` (which re-exports
  it), `toil theme list` through the same, and Toil UI's page imports the file
  directly (`ui/src/themes.ts`), the way it already imports `src/core/owi/`,
  `src/feedback/consent.ts` and `src/audit/stats.ts`. `ui/test/themes.test.ts` holds
  the two defaults together, and `test/theme.test.ts` holds `toil theme list` and the
  welcome menu's data to Crate with nothing set.
- **Why:** the issue asks for one constant read by both. Toil UI's browser code can't
  import `@imagile-dev/toil/api` (it loads the CLI's Node-only parts), so the existing
  path for a shared value is a direct import of a browser-safe source file. A file
  with no imports keeps the welcome menu's terminal code out of Toil UI's bundle.
- **Not done:** exporting it from `@imagile-dev/toil/api`. Nothing outside toil needs
  it, and `toil theme list` now says which theme is the default.

## `toil theme list` marks the default

- **What:** its `data` gains `default` (the default theme's name) and a `default`
  boolean on each theme, beside the existing `current`. Both are additive.
  A theme toil doesn't have now says "so Crate, the default, shows instead"
  (`THEME_UNKNOWN`), taking the label from the theme, not a literal.

## Where Plain stays

- **The site stays blue.** `test/brand-sync.test.ts` now holds the site's tokens
  (and, as before, the feedback emails' palette) to Plain's `theme.json` directly,
  and holds the terminal only to the badge's geometry and the orbit. The assertion
  that the terminal's `PALETTE` equals the site's tokens is gone; the terminal's
  themes are held to `ui/themes/` by `test/theme-sync.test.ts` alone.
- **`PALETTE` is still Plain's dark scheme.** It is toil's own palette: the hidden
  game draws in it, and so does a frame given no theme (tests, and the site's
  recording of the menu in `site/src/data/welcome.json`). The menu itself always
  carries a theme, Crate by default. For the same reason a frame with no theme uses
  Plain's words as well as Plain's colours, so the site's recording, which is the
  site's blue, is unchanged.
- **The site's welcome docs page** says Crate is the default and that
  `toil theme set plain` gives the menu the site's blue. Its recording stays in Plain.

## Light terminals: every role lifted against an off-white ground too

- **What:** on a light terminal, `palette()` now lifts every role to 4.5:1 against
  `LIGHT_GROUND` (`#fdf6e3`, Solarized Light's cream) as well as the scheme's own
  white. Crate's derived light highlight and `ok` were 4.64:1 on white but 4.44:1 on
  One Half Light's `#fafafa` and 4.30:1 on Solarized Light; they are now at least
  4.54:1 on all three. `test/theme-sync.test.ts` checks every theme on `#fdf6e3`,
  `#fafafa` and `#ffffff`.
- **Why:** the menu draws on the terminal's own background, which toil knows only as
  light or dark (`COLORFGBG` gives an index, not a colour), and most light terminal
  schemes are off-white. Lifting against the darkest common light ground clears the
  bar on it and everything lighter. It applies to every theme on a light terminal;
  Plain's light palette moves only where it was short of the bar on cream.
- **Not done:** using the colour an OSC 11 reply gives. It's only there when the
  terminal answers, and the fallback above is still needed for `COLORFGBG`.
- **Seen, not changed:** on a dark terminal with a lighter-than-usual background
  (One Half Dark, `#282c34`), every theme's `faint` role is about 3.8:1. That predates
  this change and affects Plain as much as Crate; fixing it would change `PALETTE`,
  the game's palette. Left for the maintainer.

## How the screens were checked

- The menu's real byte stream, from `runWelcome` in-process with no config (so the
  default applies), and the splash's still frame, were replayed into xterm.js 5.5.0
  with Windows Terminal's One Half Light and Campbell schemes, at 120 and 64 columns,
  and screenshotted in headless Chrome, as #427 did. Every text colour in those
  streams was measured against white, `#fafafa` and `#fdf6e3` (light) and `#0c0c0c`,
  `#121417` and black (dark): the lowest is 4.54:1 light and 5.00:1 dark. The
  wordmark's drop shadow and the braille badge are drawings, not text.
