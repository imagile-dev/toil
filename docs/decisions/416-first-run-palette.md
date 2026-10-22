# A guided first run, a command palette, and search across dossiers (#416)

- **Fuzzy matching is our own, about forty lines** (`ui/src/fuzzy.ts`), with no new
  dependency. Each word of the query must appear in order, its letters perhaps spread
  out; a whole word, a word start and an early start score higher. The palette ranks a
  few hundred entries per keystroke at most, which needs nothing faster, and a library
  would be the package's first runtime dependency besides toil (`check:package`).
- **Built on React Aria's `Autocomplete` around a `Menu`**, inside a `ModalOverlay`, so
  focus stays in the search field while a screen reader follows the highlighted result
  (virtual focus), and Escape and a click outside close it. `Autocomplete` is given no
  `filter`, so the ranking is ours. A result's accessible name is everything it shows,
  its detail line too, rather than a label slot plus a description, because axe's
  `label-content-name-mismatch` (WCAG 2.5.3) fails a name that leaves out visible text.
  The palette's dialog scrolls rather than its list, so the scrolling region holds the
  focusable search field (axe's `scrollable-region-focusable`); the field is sticky.
- **The palette reaches the views through a small command bus** (`ui/src/commands.ts`):
  Ask, Analyze, the chat's agent and Assign are sent to whichever view owns them (the
  Ask bar, the dossier's shell) rather than threaded through props. They are offered
  only on a dossier's page, where those views are mounted, so nothing is sent to no one.
- **"The focused item"** is the board card that had focus when the palette opened, or
  else the item whose page is open. Anything else has no item to assign.
- **"Switch the agent adapter" is two commands:** "Answer with <agent>" for each ready
  adapter, which switches this chat as the Ask view's switcher does (on a dossier's
  page), and "Choose the default agent", which opens Settings, Agent, where the
  default is saved. The palette doesn't save a default itself.
- **Items are searched in what the App has read**, which the local app answers from the
  cache. Opening the palette reads every dossier not yet read, one at a time, as the
  Dossiers view's cards do; it never calls a tracker. Saved analyses are listed for
  every dossier, read on each open.
- **A result says how old its dossier's copy is** when the last sync was more than a
  day ago (`STALE_AFTER_MS`), or when that sync failed or partly failed; a fresher one
  says nothing more. The age is from the wall clock when the palette opened, since the
  App's own clock is when the data was read. Where nothing syncs (the preview), it
  never says.
- **With nothing typed, the palette shows** the commands, the dossiers, the tabs of the
  dossier on screen, settings and themes, and a line inviting a search, since every
  item of every dossier is too many to read. With a query, each group is capped (20
  items, 10 tabs, 8 of anything else) and the group with the best match comes first.
- **Hidden until called up (principle 11):** nothing new on the wide header. On the
  compact header the palette and the shortcuts sheet are two entries inside the Menu,
  for a screen with no keyboard; the header itself is unchanged.
- **One shortcut table** (`ui/src/shortcuts.ts`): the palette's Ctrl+K, `?`, the board
  card's M, picking a card up, the arrow keys and Escape, and the name editor's Enter
  and Escape. Views test a key with `matches()` and set `aria-keyshortcuts` with
  `ariaKeys()`; `ui/test/palette.test.tsx` fails on any other key comparison or literal
  `aria-keyshortcuts` under `ui/src/`. The board card's `aria-keyshortcuts` now says
  `M ContextMenu`, since the Menu key opens the same menu. dnd-kit's own keys (Space,
  arrows, Escape) are listed from the table but handled by dnd-kit, as before.
- **The first run shows** when there is no dossier, or, where Toil UI syncs, when no
  dossier has synced yet: a dossier made in step 2 keeps the list up until step 3. A
  wiped cache shows it again until the next sync, which is true of that state. The
  theme's empty-state line is kept as the checklist's first line.
- **"Connect a tracker" counts a connection to an area the dossiers read work items
  from** (`jira`, `jira-cloud`, `ado`, `ado-cloud`, `github`), from toil's own
  `OWI_SOURCES`; a Jenkins or Bitbucket connection alone doesn't tick it. `connections
  list` reports env-made connections, so those count.
- **Landing on a form** uses `#/settings/connections/+add` and
  `#/settings/dossiers/+new`. A connection or dossier name can't start with `+`, so
  neither can collide with one. They focus the form's heading, as an edit link does.
- **The Dossiers list is read again after a visit to Settings**, so a dossier made there
  ticks step 2 on return without a reload. It's one `dossiers list` call.
- **Sync from the page** goes through the Sync panel (`request` prop): the palette's
  Sync now and the checklist's raise a counter the panel answers as a press of its own
  button. A request made while a sync runs is that sync.
- **verify:ui gained a first-run part**: `toil-ui` on an empty home with no `TOIL_*`
  variable, layout and axe checked at `#/?first-run`, an address the App reads as the
  Dossiers view, so the checklist gets its own states and the sample home keeps its.
