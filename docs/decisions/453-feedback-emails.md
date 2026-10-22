# The feedback emails in Plain's blue (#453)

Decisions an agent made by default while building #453, for the maintainer to keep
or overturn. This picks up the follow-up `docs/decisions/442-blue-reskin.md` left
open under "Left as they were": the emails now use Plain's colours.

## The function keeps a copy of the colours, held to theme.json by a test

- **What:** `functions/feedback/src/lib/palette.ts` holds the Plain roles the emails
  use (bg, surface, ink, muted, line, accent, link, ok), in both schemes, as hex
  literals. `templates.ts` writes no colour of its own; every one comes from the
  palette. `test/brand-sync.test.ts` fails when a palette value differs from
  `ui/themes/plain/theme.json`, when `templates.ts` contains a hex or `rgb()` colour,
  or when a text colour falls under 4.5:1 on the page or the quote's surface in
  either scheme. The function's own tests check that the rendered HTML uses only
  palette colours, light inline and dark in the media query.
- **Why:** the function is its own package and deploys on its own, so it can't read
  the theme at run time, and generating a file (as the site does) would add a build
  step to the function for eight values. A copy checked by a test is the issue's
  fallback. `palette.ts` has no imports, so the root suite loads it without the
  function's Azure dependencies installed.

## Light by default, Plain's dark scheme for clients that ask

- **What:** the inline styles are Plain's light scheme (white page, `#0b5cad` link and
  wordmark). One `<style>` block, with `color-scheme` and `supported-color-schemes`
  meta tags, overrides each class with Plain's dark scheme under
  `prefers-color-scheme: dark`. The old emails were always dark.
- **Why:** inline styles are the only thing every client keeps, so the inline scheme
  is the one every reader is guaranteed to get. Clients that honour the media query
  (Apple Mail, iOS Mail and others) get the dark scheme; clients that recolour emails
  themselves in dark mode start from a light message, the case they are built for. A
  dark-only email inverted by such a client can come out with dark text on dark.
- **Not done:** client-specific dark-mode selectors (such as Outlook.com's
  `[data-ogsc]`). They are undocumented and change without notice; the light scheme
  is readable wherever they would have applied.

## What the colours mark

- **What:** a small "toil" wordmark in the accent above a hairline in `line`; links in
  `link`; the quoted comment on `surface` with an accent bar; "It was closed as done."
  in Plain's `ok` green and semibold. Not planned, duplicate and other reasons stay in
  the text colour; the footer is `muted`.
- **Why:** the issue asks for the blue accent and Plain's semantic colours. Done is the
  one outcome with a semantic colour of its own; the sentence says the same thing, so
  colour is never the only signal (WCAG 1.4.1). Warn and danger have no place in a
  notice that nothing went wrong. The wordmark is text in system fonts, not the
  Fredoka face or an image, because most clients block remote fonts and images.

## Verification without the live endpoint

- **What:** the emails were rendered locally from the built function to HTML and
  screenshotted in headless Chrome at 1280 and 375px, in light and dark
  (`prefers-color-scheme` emulated), with a check that nothing scrolls sideways. No
  email was sent and nothing was submitted to the live form or endpoint.
- **The `feedback-smoke` skill** the issue names doesn't exist in this repository.
  The deploy's own smoke step (`functions/feedback/scripts/smoke.mjs`, run by
  `feedback-deploy.yml` on `main`) is what exercises the deployed function. It drives
  both endpoints with the smoke-test key against the one `smoke-test` issue and sends
  no email to a real address. That run is the deploy check here.
