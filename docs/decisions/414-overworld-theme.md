# Overworld, a top-down 16-bit adventure theme (#414)

- **The copyright line.** The theme takes the genre, never a franchise. No name,
  character, item, place, phrase, crest, font, palette, sprite or music from any
  existing game is used, in the art, the words, the code or its comments. No image
  prompt named a game, a studio or a character; each described generic genre elements
  (`.claude/image-generation/style-overworld.md` forbids hearts, emblems, triangles,
  royal symbols and any recognisable character, creature, item or place outright).
  Every generated image was reviewed by eye for likeness before it was kept. The
  hero in the loading art is a small faceless traveller in a plain brown hooded cloak,
  seen from behind, deliberately not in green and with no pointed cap. The gem is a
  round brilliant cut, not an elongated hexagon. The motifs and why each is generic
  are listed in the PR.
- **Dark, one scheme.** Overworld is dark only, like Starship: a night-green ground
  (`#111c16`) so the map at the edges and the dungeon rooms read as night, and
  Harvest, the other pixel theme, stays the light, daytime farm. Every token pair
  passes AA (`ui/test/themes.test.ts`); torch gold (`#f2c94c`) is the link colour.
- **A pixel face for headings and figures only.** Press Start 2P (SIL OFL 1.1,
  Fontsource 5.3.0, Latin 400 only, credited in `ui/NOTICE`) sets h1, h2, the dossier
  name and the big figures, at 400 (it has one weight, so nothing asks for a faked
  bold) and smaller than other themes' headings, since it runs wide. The body stays IBM
  Plex Sans, already bundled for Crate and Plain. The Overview's recommendation
  headline is a sentence, so it stays in the body face. Pixelify Sans, Harvest's face,
  was ruled out to keep the two pixel themes apart.
- **Walls at two scales.** Panels use `stone-wall.svg` as a nine-slice border. At
  768px and wider it's drawn at 16px, two screen pixels to one of the wall's, where
  each brick reads; on a phone it stays at 8px so the room's floor keeps its width.
  The wall's bricks repeat every 8 units, so the repeated edge slice tiles without a
  seam.
- **The heart meter and gem counter** go in the `Panel` skin of the board panel and
  the sprint (the burn-up's dialog): one heart per working day, full for each day
  still ahead, and the points done of the sprint's points. Both are `aria-hidden`
  pictures of figures the page already says in words (the sprint chip's day count
  and the burn-up's points). On the board the meter comes first in the DOM and the
  heading is drawn above it with `order: -1`, so the heading stays first visually
  and a screen reader never meets the meter.
- **Loot by column, not by event.** A card carries a closed chest in To do, a key in
  progress and an open chest once Done, like Harvest's crops. The "chest opens" and
  "key pickup" flourishes are CSS animations that play once as the card mounts in its
  column, so moving a card into Done plays the chest's hop; both sit inside
  `prefers-reduced-motion: no-preference`, so the OS setting and Reduce motion stop
  them, and both run in steps, as a sprite would.
- **Particles: fairies**, a new `fairies` preset of small pale-green motes and a few
  torch-gold fireflies that loop around a drifting point. Sparse (16 at most), faint,
  and behind the page, like every other preset.
- **Art budget.** Five images from the OpenAI Images API (gpt-image-2, medium, 1024 or
  1536 wide), optimised with Pillow's WebP encoder after the web-optimize skill's
  check showed WebP beating AVIF on this art: the overworld tile (384px, 34 KB), the
  dungeon map for the graph (768px, 40 KB), the sage's cave for loading (15 KB), the
  empty room for empty and not-found states (15 KB) and the sage's portrait (2 KB).
  Everything else (badge, wall, hearts, gem, chests, key, locked door) is hand-placed
  pixel SVG. The theme is 139 KB, under the 160 KB cap.
- **The lexicon's mapping** follows the issue: work items are quests, the sprint is
  the journey, the board is the quest log, a pull request is an item to appraise at
  the shop, a build is the dungeon trial, a deployment opens a sealed door, a blocker
  is a locked door, and the critical chain is the key path. The renamed terms are
  Grand quest (Epic), Quest log (Board), Journey (Sprint), Sage (Agent), Dungeon map
  (Dependencies) and Locked door (Blocked), each beside the real word.
- **Overworld comes last** in the picker and every shared list, after Sprawl (#412)
  and Frontier (#413), which merged first; the docs count eight themes.
- **Principle 11.** The theme adds no words, controls or explanations to any screen:
  its art is decoration hidden from screen readers. The heart meter and gem counter
  are a picture of figures already on the page, in the place Harvest's calendar
  takes, and the loot replaces nothing because Plain has nothing there.
