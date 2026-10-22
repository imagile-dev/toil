# Frontier, a steampunk theme with a wild west flair (#413)

- **One light scheme.** Frontier is sun-bleached wood and pale handbill paper, so it
  has a light scheme only, as Harvest and Realm do. The header is dark iron, and it
  redefines its own tokens inside `.top` (Realm's pattern), so its controls keep
  their contrast. Every token pair passes AA in `ui/test/themes.test.ts`.
- **Text sits on paper, never on bare wood.** The wood tile is washed with the page
  colour at 72%, so the few lines that sit on the ground (a lede, a panel's eyebrow,
  the "Fed by" line) stay readable over the darkest knot; panels, cards and the chat
  are paper.
- **Fonts: Rye for titles, Bitter for everything else** (SIL OFL, through
  Fontsource 5.3.0, Latin only). Rye is wood type with one weight, so it is used only
  where the app asks for no bold: page titles, panel nameplates and the operator's
  name. Figures (tallies, metrics, counts, the Overview's headline) are Bitter 600,
  like numbers stamped on a boiler plate, so no figure is drawn in a faked bold.
  Ultra, Alfa Slab One, Zilla Slab, Arvo and Roboto Slab were the alternatives;
  Bitter reads best at the 13 to 14px the notes and tables use.
- **The words.** Epic is Territory, board is Claims board, sprint is Cattle drive,
  agent is Operator, Dependencies is Rail survey, and Blocked is Busted axle, each
  beside the real word as every theme does. The lexicon uses the issue's ideas
  (claims, the cattle drive, the sheriff's signature, the boiler test, the 5:15,
  busted axles, and "Wanted" on the needs-attention note). The agent is "Operator",
  a telegraph operator, rather than a person's name.
- **The voice** is a dry telegraph operator who also keeps the engine running:
  plain, unhurried, a little drawled, with steam-age words, jokes on the machinery
  and never on a person, and the facts left exactly as the data gives them.
- **Gauges, not new markup.** The issue asks for dials and pressure gauges for the
  metrics. Each tally and metric gets a small brass gauge in its corner from
  `theme.css` (`gauge.svg`), and meters become brass-cased sight glasses filled with
  copper. No view changed: a theme is CSS, JSON, art and the named skin slots, and
  a real dial per figure would need markup every theme would carry.
- **Wanted posters.** A claim that needs attention wears a rust edge on its board
  card, like the border of a wanted poster, and an empty list shows a blank wanted
  poster nailed up beside a gauge reading zero. The flag's words and its tooltip
  stay the standard "Needs attention".
- **Skins: ChatMessage, EmptyState and Loading only.** The operator answers under a
  telegraph key, empty states are the wanted poster, and loading is a locomotive
  getting up steam at a water tower. There is no Card skin (Realm already names the
  campaign on each card) and no Header skin: the brass rail under the header is CSS.
- **The graph is a railroad survey map**, washed lighter so labels sit on it
  anywhere; links are iron track with their ties showing, and a blocking chain is
  rusted, broken track. A blocked item's flag has a broken wagon wheel beside it.
- **Particles: `steam`.** Desert dust blows sideways on the wind and puffs of steam
  rise from the foot of the page, swelling and thinning as they climb; the sun's
  glare behind the page holds still. Nothing moves with reduced motion on, and the
  per-theme switch removes the particles like every other theme's.
- **Art.** Four images from the Images API (gpt-image-2, medium), optimised to WebP:
  `wood.webp` (a seamless 512 by 436 tile, cut on the plank gaps and cross-faded at
  its sides, 14 KB), `survey-map.webp` (cropped inside the plate's printed frame, 47 KB), `locomotive.webp` (loading, 18 KB) and
  `wanted-poster.webp` (empty and lost, 27 KB). The badge, the brass frame, the rivet
  rail, the gauge, the telegraph key and the busted axle are hand-written SVG. The
  set is 10 files, about 112 KB. `.claude/image-generation/style-frontier.md` holds
  the style the images were generated with. No names, logos, characters or
  recognisable designs from any book, film, game, show or railroad company.
- **The badge** keeps the tile's silhouette (`test/brand-sync.test.ts`) as a riveted
  brass boiler plate with a copper rule, and the page as a handbill with the prompt
  in iron ink, well over 4.5:1.
