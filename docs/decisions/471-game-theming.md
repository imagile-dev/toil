# The hidden game follows the menu's theme, and faint reads on lighter dark terminals (#471)

Decisions an agent made by default while building #471, for the maintainer to keep or
overturn. The maintainer's own call is on the issue: "The hidden game should follow the
menu theming."

- **The game draws in the menu's palette.** `runWelcome` hands the game the same caps
  the menu draws with (`capsNow`, the theme's `palette()` for the background it found),
  and `src/welcome/rogue/render.ts` reads every colour through `pal(caps)`. It keeps no
  palette of its own. `PALETTE` in `src/welcome/term.ts` stays Plain's dark scheme, the
  site's tokens, for a frame drawn with no theme (tests and the site's recording of the
  menu). Gameplay, rules, the save format and the sealed `"game"` save are unchanged.
  This replaces #427's "Two Weeks' Notice keeps toil's own palette"
  (`docs/decisions/427-cli-themes.md`), on the maintainer's call.
- **Every role is lifted against a lighter dark ground on a dark terminal**, the way #467
  lifts them against cream on a light one. `DARK_GROUND` is Nord's `#2e3440`, the
  lightest of the dark backgrounds the issue lists (`#000000`, `#1e1e1e`, `#282c34`,
  `#2e3440`, `#002b36`): a colour lighter than it reads at least as well on every darker
  one. `faint` moves in six themes; beyond it only Harvest's danger (`#f06d5c` to
  `#f27e6f`) and Sprawl's accent and danger (`#ff2e88` to `#ff6bab`, `#ff6470` to
  `#ff6e79`) were short on Nord and are lifted a little. Lowest
  faint on One Half Dark's `#282c34`, before and after: Plain and Crate 4.28 to 5.23,
  Harvest 4.82 to 5.12, Starship 3.92 to 5.14, Realm 5.06 (unchanged), Sprawl 3.53 to
  5.10, Frontier 5.16 (unchanged), Overworld 4.90 to 5.21. On Nord every theme's faint
  is at least 4.51.
  - **Why not the colour from OSC 11:** it's only there when the terminal answers, and
    `COLORFGBG` gives only light or dark; a fixed ground works for both and is what #467
    chose for light terminals.
  - **The site's `faint` token is unchanged.** On a near-black terminal the default
    menu is the site's palette except `faint` (Crate and Plain `#868f9b` to `#979fa9`),
    which is a little lighter. The site keeps its own; `test/brand-sync.test.ts` and
    `test/theme-sync.test.ts` now say so.
- **`dim` is a new palette role: the game's remembered map**, squares seen before and out
  of sight now. It was `faint` mixed 45% toward the background, about 2.6:1, computed
  from toil's own palette. Now it's computed per theme in `palette()` and lifted to 3:1
  (`DIM_CONTRAST`), WCAG's bar for graphics: the remembered map is the fog of war, a
  drawing rather than text, and holding it to 4.5:1 would leave no room between it and
  the lit floor beside it. Every other colour in the game, map glyphs in sight included,
  meets 4.5:1. If the maintainer reads the instruction "every bit of text at 4.5:1" as
  covering the remembered map too, raising `DIM_CONTRAST` to 4.5 is the whole change.
- **The game blends colours in linear light** (`blend` in `src/welcome/term.ts`). Its
  shimmer, effects, morale bar and robot colours mix two palette roles; a mix in sRGB
  can dip below both ends (Sprawl's morale bar measured 4.47:1 on Nord). A linear-light
  blend keeps its luminance between the two, so a blend of two readable colours is
  readable, and when rounding to whole channels would carry it a hair past both, the
  nearer end stands in. The menu's splash still uses `mix`: the wordmark and the badge
  are drawings.
- **Reduced motion reaches the game.** With `TOIL_REDUCED_MOTION` (or
  `TOIL_NO_ANIMATION`) the game's clock holds still, so the title doesn't shimmer and
  nothing blinks; text appears at once instead of typing out; the map doesn't shake;
  and an effect shows as its first frame for as long as it would have played, so a hit
  still says how much it did. An agent about to run out of context, which blinks, holds
  its warning colour instead (the review's finding), since that blink is the only sign
  of it. `NO_COLOR` and the 256- and 16-colour fallbacks needed no
  change: the game already painted through the caps' colour depth.
  - **The game's first frame now knows its text** (`sync()` before the first draw), so
    with reduced motion the first page is whole at once. Without it, the typewriter
    starts one tick sooner than before, which nobody will notice.
- **In 16 colours the terminal's own palette decides contrast.** On a dark terminal the
  lifted faint maps to white rather than bright black, which on One Half Dark (bright
  black `#5a6374` on `#282c34`, about 2.6:1) reads better than before; the remembered
  map maps to bright black, at whatever the terminal makes that.
- **How it was played.** The welcome menu was run in-process (`runWelcome`) with `resign`
  typed, Benefits Enrollment, a run's arrival card and a random walk of 160 keys, in
  Crate, Plain and Realm, and replayed into xterm.js 5.5.0 with white, One Half Light
  (`#fafafa`), Campbell (`#0c0c0c`) and One Half Dark (`#282c34`) in headless Chrome, as
  #467 and #472 did; Crate also at 256 and 16 colours, with `NO_COLOR` and with reduced
  motion. Realm on a dark terminal and Crate on a light one were also played in a real
  Windows pseudo console (ConPTY, through pywinpty, with a throwaway home folder) from
  the built `dist/toil.js`, and their byte streams replayed the same way. Every colour
  on text in those streams measured at least 4.51:1 (Realm's faint on Nord), and the
  remembered map at least 3.01:1.
