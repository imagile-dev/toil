# #442: the site in Toil UI Plain's blue

Decisions an agent made by default while building #442, for the maintainer to keep
or overturn.

## The tokens are generated from Plain's theme.json

- **What:** `site/scripts/plain-tokens.mjs` reads `ui/themes/plain/theme.json`'s dark
  scheme and writes `site/src/styles/plain.generated.css` (bg, surface, raised, ink,
  muted, line, accent as RGB, accent ink, focus, ok, warn, danger). `global.css`
  imports it and derives the other roles: `--color-bg-deep` (`#0a0c0f`),
  `--color-faint` (`#868f9b`, 4.8:1 on the raised surface), `--color-highlight`
  (`#c2e0ff`, the lighter tint that replaces amber), the accent gradient (accent to
  highlight), `--color-line-strong` and the grid (ink mixed with transparent).
  `npm run dev` and `npm run build` regenerate it; the file is committed so the root
  tests can read it, and `test/brand-sync.test.ts` fails when it differs from what the
  script would write, or when `global.css` sets one of its tokens again.
- **Why:** the issue asks for one source. Committing the output keeps the root test
  suite and a fresh clone working without a site build.

## The badge is Plain's dark badge, line for line

- **What:** the site's badge (`Logo.astro`, `favicon.svg`, the avatar and its PNGs,
  the orbit SVG) and Toil UI's standard badge (`ui/src/mark.svg`, `ui/src/favicon.svg`)
  are `ui/themes/plain/assets/mark-dark.svg`: a flat `#8cc4ff` tile, a page in the
  accent's ink `#0b1220`, a light fold and `>`, and the cursor in the accent. No
  gradient. The brand-sync test holds every copy to Plain's file.
- **Why:** the issue says to use Plain's blue badge. Two alternatives were drawn and
  compared at 34px and 128px: a light page on the blue tile (the old structure) and a
  deep-to-light blue gradient tile. Both read washed out at header size; the dark page
  is the clearest. This drops the old skill rule "a light sheet with a dark fold,
  never a dark square": the page keeps its fold and the tile its cut corner, which is
  what made the mark toil's. The site skill now says so.
- **Terminal:** on the braille canvas the dark page is the terminal's own background,
  so only the tile (accent), the fold and `>` (ink) and the cursor (accent) are drawn.

## A second blue, not a second hue; ok and danger are Plain's

- **What:** amber's job (values, "live", small highlights, the top of the gradient,
  the terminal's headings) goes to `--color-highlight`, a lighter tint of the accent.
  `--color-ok` is Plain's green (`#6fd394`), so `stable` and code strings are green.
  The terminal's `PALETTE` gains `ok` and `danger`: a result that worked is green and
  one that didn't, a field error, "Needs attention", a Remove confirm and the game's
  damage are Plain's danger red. They were flame, which doubled as the error colour;
  a blue error wouldn't be unmistakable (principle 4).
- **16 colours:** `to16` now maps the palette to white, grey, bright blue, bright cyan
  (the highlight), green and red.

## Generated art: recoloured, not regenerated, and the lighten rule stays

- **What:** every cartoon, the hero drawing, `og.png` and the README's cartoon were
  recoloured pixel for pixel by a script (warm hues folded into the 192 to 226 degree
  blue band at a little less saturation, warm greys to cool, the near-black ground
  pulled under `#0a0c0f`), so each drawing is exactly the one it was. Nothing was
  image-generated, so it cost nothing. The README banner and the social preview were
  recoloured the same way, with the old raster badge painted out and the new badge
  SVG rendered in its place.
- **The rule:** the new page is still dark (`#0f1115`), so art on a ground at or below
  the deep ground still disappears under `mix-blend-mode: lighten`. The only change is
  the ground's colour; the site skill and the two style files say so, and the style
  files now describe the blue palette for new art.
- **The hero drawing** is no longer used once #444's map is the hero; it is removed
  when this branch merges #444 (#442 asks to retire what the map replaces).

## Left as they were

- **Toil UI's default theme** stays Crate, with its warm palette: the brand-sync test
  no longer holds Crate to the site (it holds Plain to the site instead). Crate's
  description no longer says it looks like the site. Whether Toil UI's default should
  follow the site to Plain is the maintainer's open question.
- **The Toil UI screenshot on the home page** (`ui-dossier-card-payments-*.webp`) shows
  the app in its default theme, Crate. It is the app's own colours, like `/ui/`.
- **The feedback emails** (`functions/feedback/src/lib/templates.ts`) keep their warm
  inline colours. They are not site chrome, and changing them redeploys the feedback
  function; a follow-up can move them. #453 moved them to Plain's palette
  (`docs/decisions/453-feedback-emails.md`).
- **The GitHub social preview** is uploaded by hand: `.github/assets/social-preview.png`
  is updated, and Settings → General → Social preview needs the new file.
