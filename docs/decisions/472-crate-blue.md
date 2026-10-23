# #472: Crate in the site's blue

Decisions an agent made by default while building #472, for the maintainer to keep
or overturn. The maintainer's own call is on the issue: Crate stays the default and
keeps its character, themed blue like the public site.

## Crate's palette is the site's tokens, held by a test rather than generated

- **What:** every colour in `ui/themes/crate/theme.json` is one of the site's tokens
  (`site/src/styles/plain.generated.css`, which `plain-tokens.mjs` writes from Plain's
  dark scheme, plus `--rgb-highlight` from `global.css`): bg, surface, raised, ink,
  muted, line, accent, accent ink, focus, ok, warn and danger as named; `link` is the
  site's highlight (`#c2e0ff`); the banner is the raised surface with the highlight on
  it. `test/brand-sync.test.ts` ("Crate wears the site's blue") maps each key to its
  token and fails on any difference, and on a key the map leaves out.
- **Why `link` is the highlight:** Crate uses `link` as its second colour, the end of
  its gradients, the "UI" sticker and the chart fill, the job amber did. The site moved
  amber's job to `--color-highlight` (#442), so Crate's second colour is that. Links
  are underlined in Toil UI, so a link lighter than the accent still reads as one.
- **Why not generated:** `theme.json` is a static file the UI build, the server and
  the theme tests all read, and a second generator beside `plain-tokens.mjs` would be
  one more thing to run. The test makes the copy impossible to drift: change Plain's
  blue and the site's tokens move with it, and Crate fails until it follows.
- **`theme.css`** colours its glows and grid only with the tokens
  (`color-mix(in srgb, var(--accent) 14%, transparent)` and the like), and the test
  refuses a hex, `rgb()` or `hsl()` in it. The dust's two sprites are Crate's ink and
  highlight, also held by the test. `flame()` in `ui/src/ambient/presets.ts` is now
  `glowAt()`, since it measures an accent glow.

## Contrast

- **Toil UI:** `ui/test/themes.test.ts`'s pairs all pass (accent ink on accent
  10.2:1, link on raised 11.7:1, muted on raised 7.2:1, danger on raised 7.0:1, focus
  on raised 8.7:1). Text straight on the page, at the glow's peak under a grid line
  (bg, accent at 14%, ink at 4.5%): ink 10.7:1, link 9.4:1, muted 5.8:1, danger
  5.6:1, warn 7.1:1, ok 7.0:1. The splash's glow at 16%: muted 6.3:1. The glow stays
  at 14%; axe can't measure text over a gradient, so these figures are the check.
- **Terminal:** on a dark terminal Crate's palette is exactly the site's (`PALETTE`),
  lowest text colour faint at 5.6:1 on `#121417`. On a light terminal the derived
  scheme is lifted against cream as #467 does: lowest faint 4.64:1 and ok 4.56:1 on
  `#fdf6e3`. Measured from the real byte stream replayed in xterm.js, too.
- **Seen, not changed:** the derived light scheme flips the highlight to a very dark
  navy (`#001e3d`), so on a light terminal headings read close to the ink. It passes,
  and Crate has no light scheme in Toil UI to copy (the site is dark only); giving the
  terminal one would need a light scheme in `theme.json` first.

## The art: recoloured, not redrawn, with the hard hat in the highlight

- **What:** the three WebPs (`crate-lost`, `crate-loading`, `moments/splash`) went
  through #448's recolour script pixel for pixel (warm hues folded into the 192 to
  226 degree band, warm greys to cool, the ground under the deep ground), so
  `crate-lost.webp` came out byte for byte the site's `cartoon-lost-960.webp` before
  the next step. Then, as the issue asks, the bright amber (hue 34 and up, saturated
  and bright: the hard hat, the hazard tape, the telescope's eyepiece) moves to the
  highlight `#c2e0ff`, with the mask softened so WebP's block noise doesn't speckle.
  The loading art's hat sits only two degrees from its body, so there the step uses a
  narrower hue window and only the rows above the body. The scripts were scratch
  Python (Pillow, numpy) outside the repository; nothing was added to it.
- **SVGs:** Crate's roles swapped to the site's tokens (ink, accent, amber to
  highlight, page to bg), and the kraft and wood tones went through the same fold.
  The badge is the same drawing in blue-grey cardboard with the tape in the
  highlight; its prompt is 16:1 on its label. In `split.svg` (a build that failed)
  the warning sign was the flame, which was also Crate's danger; it takes the site's
  danger, not the accent. The test holds every SVG colour to a grey, the blue band
  or a status token.
- **Budget:** the largest file is `splash.webp` at 23 KB (64 KB a file), and the
  theme is about 72 KB in all (320 KB).
- **The ground:** every raster's ground is at most `(7, 9, 10)`, below Crate's new
  bg `#0f1115`, so `mix-blend-mode: lighten` still hides it.

## Words

- The theme's description, `ui/docs/themes.md`, the site skill and the welcome docs
  page say Crate wears the site's blue. The site's `/ui/` showcase reads the
  description from `theme.json`, so it follows with no change of its own.
- The site's own colours, Plain, the site's recording of the menu (Plain), and the
  feedback emails are unchanged.
