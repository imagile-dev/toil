# Realm leans into tabletop dungeon crawling (#415)

- **Flavour on the existing house ledger, not a redesign.** The palette, fonts, folios,
  wax seals, iron header, war-table graph and particles from #349 are unchanged. The
  sprint stays the Ledger and blocked stays the Broken road; the agent becomes the
  Dungeon master, because the issue names it.
- **Eight new words a theme may rename** (`TERMS` in `ui/src/theme-pack.ts`):
  `people`, `analyses`, `priority`, `builds`, `passed`, `failed`, `pointsDone` and
  `pointsLeft`. Each is shown beside the real word, like the first six, and only Realm
  renames them; every other theme reads the real words. They were added as terms
  rather than wording keys because every game theme must define every wording key
  (`ui/test/themes.test.ts`), which would have made three parallel theme PRs edit each
  other's `theme.json`.
- **Where each one shows:** the People and Analyses headings ("Party (People)", "Quest
  log (Analyses)"); an item's Priority field ("Initiative (Priority)"); the Builds panel ("Saving throws (Builds)"); a build
  that passed or failed carries "Natural 20 (passed): " or "Critical fail (failed): "
  before the state its source gave, in the Builds panel, the trace table and an item's
  page (one shared `Outcome` in `ui/src/components/bits.tsx`); the sprint's Done tally
  ("Experience points (Done)"); and the sprint's points left as hit points, a bar in
  the sprint panel's skin (the burn-up dialog) that takes the place of the panel's own
  meter, which Realm's CSS hides beside it. A deployment's outcome is not
  renamed: it isn't a saving throw.
- **Initiative order reads the board's priority, it doesn't reorder the board, and it
  isn't a line on every card.** The attention note says the ranked list is "in
  initiative order", and an item's fields read "Initiative (Priority)". A first pass put
  "Initiative (Priority): High" on every board card; principle 11 (quiet screens), which
  landed on main while this was in review, asks that nothing be added to every card
  without something coming off, so it came off the cards. The board's columns keep
  their own order.
- **Explanations are (i)s, not paragraphs** (principle 11). Two new help topics,
  `alignments` and `rest-days` (`ui/src/help.ts`), link to their own sections of
  `ui/docs/themes.md`. The People tab shows the alignments' (i) beside the cards'
  heading, and the worklog's calendar a short "Camp fires mark rest days." with its (i).
  The hit points replace the meter instead of adding a block, and experience is the
  existing Done tally's word, not a second figure.
- **Rest days are a camp fire on the worklog's calendar**: a past day with nothing on
  its page, or no page at all, is a short rest on a weekday and a long rest at the
  weekend. The day link gains a generic `data-quiet` attribute when its page has no
  lines (`ui/src/views/Worklog.tsx`), which only Realm styles. The marks show only
  while the line naming them does, which is only with themed wording on.
- **Alignments are rolled from the name, and only good or neutral.** The issue allows
  them only if they are playful, optional and never judge a person. A label worked
  out from anyone's work would judge it, so the roll reads the card's name alone
  (FNV-1a, `ui/src/model/alignment.ts`): the same name always rolls the same, and no
  figure reaches it. The list holds the six good and neutral alignments; evil is left
  out. The tag is italic and dashed so it doesn't read as a fact, an (i) beside the
  cards says what the labels are, and themed wording off removes both. The tag is one
  more thing on every card, which principle 11 asks to avoid; it stays because it is
  what the issue asked for, and it is the theme's own wording, which one switch takes
  away. It is data in
  `theme.json` (`alignments`), and `ui/test/theme-rules.ts` refuses a value that holds
  a judging word. Any theme may list its own; only Realm does.
- **The art:** a d20 (hand-written SVG, iron and tarnished gold with an oxblood face)
  replaces the candle-and-ledger loading picture, rolling only where motion is welcome
  and resting twenty-up otherwise; a camp fire (SVG) for rest days; a d20 on the
  character sheet's heading; and one generated image, a top-down dungeon map in the
  engraved style of `.claude/image-generation/style-realm.md` (gpt-image-2, medium,
  512x1536, about $0.06), rotated to a band and optimised to a 38 KB WebP. The map
  runs along the foot of every page, in room the page keeps empty for it (`main`'s
  bottom padding grows to 8rem in Realm), so no text sits on it. The candle glow
  behind the page stays.
- **The dungeon map is at the foot, not in the margins.** It was first drawn in the
  soot margins at 1360px and wider, but a dossier's page is 1680px wide, so the map
  ran under its text at 1440px. That also showed #349's soot already darkening a
  dossier page's left edge text between 1360 and 1760px, so the soot now waits for a
  window wide enough to have margins on a dossier page (1760px).
- **An item's fields are a character sheet** in Realm: a double iron rule around a
  leaf of vellum, each field a labelled, ruled line. CSS only; the fields, their order
  and their names are unchanged.
- **The voice is a dungeon master narrating**: one line of scene, then the ledger, the
  threats and what the party should do, with every figure and citation as the data
  gives it. The scripted sample answers were rewritten to match, with the same
  citations, figures and proposals (`ui/test/agent.test.ts` holds them to it), and no
  new digits, so "natural 20" never appears in an answer as a figure.
