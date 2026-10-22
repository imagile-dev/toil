# Sprawl, a cyberpunk Toil UI theme on terminal bones (#412)

- **The name stays "Sprawl"**, the issue's working name: a generic word for a
  sprawling megacity, not a trademarked game or film title. The maintainer may
  rename it; the name lives in `ui/themes/sprawl/` and the shared lists only.
- **One dark scheme.** Neon on deep blue-black is the look; a light variant would be
  a different theme. Like Starship, it follows no system preference.
- **Type: Fira Code to read, Chakra Petch for headings and figures.** The issue asks
  for monospace type, and Fira Code is already bundled for Crate, so the body costs
  nothing new. Chakra Petch (SIL OFL 1.1, Fontsource 5.3.0, published 2026-07-19, so
  past the 14-day rule) gives headings a squared, technical face that isn't
  Starship's Orbitron. It is added to `ui/` and to the site, which draws each
  theme's card in its own faces on `/ui/`.
- **Terms:** Contract (Epic), Gig board (Board), The run (Sprint), Netrunner
  (Agent), Net map (Dependencies) and Black ICE (Blocked), each beside the real
  word. The lexicon and voice follow the issue's ideas: gigs, the run, a payload
  waiting on the fixer, an ICE check, jacking in to prod, black ICE, and the Ask
  bar pinging the netrunner. Errors, not-found notices, commands and control names
  stay standard, as in every theme.
- **Palette (AA on the tokens, as every theme):** ink 18.4:1 on the ground, muted
  8.5:1, cyan links 12.9:1 on raised, the magenta accent's dark ink 5.8:1, and a
  yellow focus ring at 16:1. Danger is a coral red, kept apart from the magenta
  accent so a failure never reads as decoration.
- **Art: three generated images and four hand-written SVGs, 76 KB in all.** The
  skyline (`skyline.webp`, 45 KB), the loading cyberdeck (`jack-in.webp`, 13 KB)
  and the empty alley (`dead-drop.webp`, 10 KB) came from the Images API
  (gpt-image-2, medium, 1536x1024) with `.claude/image-generation/style-sprawl.md`,
  committed beside the other styles. A fourth, a net map, came back as another
  skyline and was dropped; the net map behind the graph is a tiled SVG grid instead,
  which stays sharp at any zoom. The badge, the netrunner's terminal glyph and the
  black ICE glyph are SVG too. No names, logos, characters or designs from any
  franchise.
- **The skyline sits at the foot of the window under a scrim** that is near solid
  where the page's text starts and thins to 70% over the skyline, so text straight
  on the page keeps its contrast and the city shows at the edge, where the issue puts
  it.
- **Rain is the particle preset** (`rain`), falling on a 12-degree slant, cyan with
  the odd magenta streak, at most 42 drops, faint enough to read as weather. The
  per-theme particle switch turns it off like every other theme's.
- **Glitch transitions are small and motion-gated:** a one-off chromatic jitter on
  the page title as it opens, a four-step scan-in of panels, a blinking block
  cursor after the title and a flicker on the loading art, all inside
  `prefers-reduced-motion: no-preference`. The static chromatic split on the title
  stays with motion off; it doesn't move.
- **Skins:** a notched corner and a title-bar tab on panels and the header (out of
  the accessibility tree, like Starship's HUD corners); the agent's answer in a
  terminal window whose title bar names it "Netrunner (Agent)"; the dead drop for an
  empty state; the cyberdeck for loading. Your own question gets a `>` prompt drawn
  with CSS alternative text set to empty, so a screen reader doesn't read it.
- **A dossier's name keeps its case.** Section headings are uppercase in Sprawl,
  but the dossier list's card headings are dossier names, which are identifiers, so
  they are left as written.
- **The voiced-answer test now covers every theme with a voice** (`THEMES` with a
  `voice`) instead of a hard-coded list, so the next game theme can't ship without
  its voiced sample answers.
- **Long runs break anywhere inside dialogs only.** Monospace made the feedback
  dialog's note, with its unbroken URL, wider than a 375px screen. The review
  pointed out that a theme-wide `overflow-wrap: anywhere` could split short words
  in tight cells, so the rule applies to paragraphs and list items inside a
  dialog, where the overflow was.
