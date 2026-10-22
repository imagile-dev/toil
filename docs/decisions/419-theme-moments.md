# Theme moments: splash, loading screens, event moments and toil tips (#419)

- **One engine, data in theme.json.** A theme declares `"moments"` in its `theme.json`
  (`ui/src/moments/schema.ts`); the engine in `ui/src/moments/` plays it. Pictures are
  named by their key in the theme's `assets`, never by path, so the asset list stays the
  one record of what a theme ships and the existing "ships every asset it lists" test
  covers moment art. Motion is a name from fixed lists (one-shot, loop, track), never a
  theme's own keyframes, so a theme can't ask for an animation that repaints. A theme's
  `theme.css` may only colour and frame the engine's parts. `momentsProblems` in
  `ui/test/theme-rules.ts` holds every theme folder to the schema.
- **An absent block is the plain default**, and so is every absent part of it: a loader
  with the progress text and a tip, nothing else. Starship and Realm keep their Loading
  skins (their art) under the engine's loader, with a tip; the four themes being built in
  parallel (#412–#415) need nothing to keep working.
- **The detector is the worklog's.** The notifications from #306 track agents' state
  only (needs you, done, failed, cap, stale), not items, builds or pull requests, so they
  couldn't be the source. The one place that already detects item done, build pass and
  fail and pull request merged is the worklog's fold (`eventsFrom`, `observedEvents`).
  It gained two facts the moments need, a **blocker cleared** and a **sprint ended**,
  both seen by comparing a sync with the last, like a new blocker. They show on the
  worklog page too: they are facts worth a line, and a stand-up counts a cleared
  blocker as progress for the item's assignee.
- **A moment plays for a fact a sync recorded for the first time**, and only then:
  `Cache.saveDossier` returns the facts whose key wasn't in the cache, the sync job
  carries them (`job.news`, up to 50 a dossier), and the page plays them once the job
  ends, keyed by when it finished so a remount doesn't replay them. Nothing on a
  dossier's first sync (all of history would be new), and nothing dated before the last
  good sync, less five minutes for clock skew (a source only now listing an old build
  isn't news). One moment a kind, at most three a sync, the sprint's end first, then a
  failed build, a cleared blocker, a merge, items done and builds passed.
- **Moments are decoration, hidden from screen readers and the pointer.** The issue says
  to announce them only where a notification would be; no notification covers these
  changes, so none is announced. The facts are on the worklog page. Loaders keep a
  `role="status"` progress message; in the chat, the existing status line is the live
  region and the inline loader isn't a second one.
- **Theme motion: full, subtle, off, default full.** Reduced motion (the OS, or "Reduce
  motion and effects") forces off, which makes off the default when reduced motion is
  set, the way the issue asks, and keeps the existing rule that the OS always wins.
  Subtle plays a third of the distance in a little over half the time, holds the
  loaders' art still and keeps only their progress track moving. Off plays nothing:
  no splash, entrance, transition or event moment, and loaders are still art plus the
  progress text. Kept in this browser beside the other motion settings
  (`toil-ui.theme-motion`).
- **Event moments run under a second; the sprint recap stays five.** Its figures can't
  be read in under a second, so the card arrives in under one and then holds 5 s before
  fading. Every other moment is in, held and out in 0.9 s.
- **The splash never adds a wait.** It shows only once the first read has run 300 ms,
  ends the moment the data is ready, on any key or click, or after 1.8 s (when the
  view's own loader carries on), and plays once per page load, not once per App mount,
  since the App remounts after every sync. The sample app's reads are fast, so it
  rarely plays there; the Settings preview shows it on demand.
- **"A sync" as a loading screen** is a panel-size themed loader at the top of the view
  while a sync runs, saying the job's progress, not a full-view loader: the cached data
  under it is still good to read, and covering it would add a wait. The Sync panel's own
  line stays the live region, so this one isn't announced again.
- **Real progress text** comes from counting the calls a dossier's load sends
  (`trackCalls`): "3 of 7 toil calls answered; reading toil jira issue search". No
  percentage, since the number of calls isn't known up front.
- **Previews under Settings, General** (`MomentsPreview`), as one menu, **Preview the
  theme's moments**, with an entry for the splash, a loading screen and each event
  moment, so a person can see them without waiting, and so the layout check can open
  them. One menu rather than eight buttons, and no paragraph explaining Theme motion
  (its (i) and the docs do), per principle 11 (quiet screens), which landed while this
  was built; only the "off for now" line shows, when reduced motion holds it off. A preview's progress text says it's a sample. The
  layout check lifts `aria-hidden` from the recap card it plays so its layout and axe
  are checked like everything else.
- **The layout check runs twice in the smoke.** Every view with reduced motion (also
  Theme motion off) as before, then the views where moments play (`MOTION_ROUTES`: the
  dossiers list, a dossier's Overview, Board and Pull requests, and Settings, General)
  with motion on. Running all 40 routes twice would double a job that already takes
  most of CI's time for no extra coverage of the moments.
- **Asset budget raised to 320 KB a theme** (64 KB a file, unchanged). The issue allows
  "a few hundred KB"; Harvest was at 112 KB before its 55 KB splash. Moment art goes in
  `assets/moments/`.
- **Art.** The two splash pictures were generated with gpt-image-2 through the OpenAI
  Images API, each as an edit of the theme's existing art so the mascot and the farm stay
  the same (medium quality, 1536×1024), then cropped and converted to WebP: Crate's at
  480 px (21 KB, its background set to black so it blends into the glow), Harvest's at
  720 px (55 KB). Every other moment picture is drawn as SVG: Crate's in the mascot's
  sticker style, Harvest's as 16×16 pixel sprites from ASCII grids, with the loader's
  sprout as a four-frame sprite sheet stepped by `transform`. The empty-state art
  pattern for #417 follows the same layout: a key in `assets`, the file under
  `assets/moments/` (or its own folder), drawn to the theme's palette.
- **Toil tips live in `ui/src/tips.ts`**, each pointing at a help topic, so the existing
  help-link test resolves every Read more. Five topics were added to the help table for
  them, additively (`board`, `analyses`, `notifications`, `theme-motion`,
  `tips`). The order is shuffled once per browser session and kept in `sessionStorage`
  with what was seen, so a tip doesn't repeat until all have been seen; a new tip joins
  the end of the round. Tips show on view-size loading screens and the splash, not on a
  panel-size loader, which has no room. The setting is kept in `localStorage`.
- **Flavour lines are in the moments block, not the lexicon.** The lexicon's keys are a
  fixed set every game theme must fill, so a list there would have forced Starship,
  Realm and the four themes in flight to write lines at once. They follow the lexicon's
  rule: shown only while Themed wording is on.
- **Every loading spot goes through the engine's `Loader`**: the dossier list and a
  dossier, the graph, the worklog's calendar and page, the stand-up, the Analyses tab,
  each Settings page, and the chat's thinking line. Settings keep their standard words,
  in the theme's loader. The layout check's "still loading" test now looks for
  `[data-loading]` too.
- **The layout check waits for finite animations to end** before it measures or runs
  axe (`ANIMATIONS_DONE`, up to 2 s), loops left running. The first motion-on pass caught
  the board's dropped ghost card mid-fade (an animation from #393 that the reduced-motion
  pass had never seen) and read its text as low contrast; the card is fine once it lands.
