# What's new, empty states that act, and a notification history (#417)

- **The release notes are read at build time, by a Vite plugin.** `virtual:whats-new`
  (`ui/vite.config.ts`) parses `CHANGELOG.md` and `ui/CHANGELOG.md` with
  `parseChangelog` (`ui/src/whats-new.ts`) and serves the result as a module, so the
  bundle holds only the parsed lines, not both files, and nothing is committed that
  could drift from the changelogs. The same plugin runs under Vitest, so the tests read
  what the build reads. It keeps the newest 12 releases of each product.
- **"Written for users" is the changelog's own subject lines, filtered.** Features
  first, then fixes, at most five a version; the commit and issue links dropped; a
  capital added unless the line starts with a command (`npm run verify:ui`). Toil UI's
  list is its `ui`-scoped lines. toil's list is the unscoped lines and every scope but
  `ui` and the repository's own (`ci`, `test`, `site`, `docs`, `build`, `deps`, `chore`,
  `release`). No second, hand-written summary per release: it would be one more file to
  forget at release time.
- **The versions compared are the ones this page runs on.** The local app passes the
  server's (`session.version`, `session.toil.version`); the preview uses the build's,
  Toil UI's `package.json` version and the toil it pins. A first visit records them and
  shows no dot, since nothing was upgraded. Opening the list marks it seen; the list
  shown is taken as it opens, so it doesn't empty itself. With nothing new, What's new
  shows the latest release of each.
- **Help is always a menu now.** It was one link while learning links were off (#418);
  What's new has to be reachable either way, so Help's menu keeps the view's docs and
  What's new, and adds Learn while learning links are on. The dot is on Help and on
  What's new; on a narrow screen, where Help is inside Menu, the dot is on Menu too, or
  it couldn't be seen. Its meaning is in words for a screen reader ("Help, with
  something new").
- **The changelog links are to the files on GitHub's `main`.** They're outbound links
  a person follows, in a new tab, like Read more; the docs list them with the others.
- **The bell keeps what the notices carry, quiet hours included.** Each change a
  notice from #306 delivers (needs you, done, failed, a usage cap, gone stale) becomes
  one entry, linked to its assignment or dossier, recorded before the quiet-hours check:
  quiet hours hold back a notice, not the record of it. Which changes reach the bell is
  still the notification settings' choice; "done" is off by default there, and so it
  isn't kept by default either. A chat stopped at its own usage cap says so in the chat
  in front of you, and isn't added.
- **One entry per event, however many tabs are open.** Every tab hears the same server
  event and sees the same sync end, and they share one history, so each entry carries an
  id from its subject (the session, the state and the server event's sequence number;
  `sync:<finishedAt>` for a sync), and an id already kept is skipped. The writes are
  synchronous `localStorage` calls, so the second tab always sees the first one's entry.
- **The bell is the one control always on screen.** It shows a count, which can't sit
  out of sight and still be seen. Principle 11 asks for something to come off the screen
  or stay hidden in exchange: the bell takes nothing off, and #417 asks for it by name.
  What's new adds no control at all, only an item inside Help and a dot.
- **Each sync's result is one entry**, from the Sync panel when a sync ends: finished,
  finished with sources failed (naming them, and linking to the first failed
  dossier), or stopped (with toil's message). A wipe is not an entry.
- **The history lives in a store outside React** (`ui/src/history.ts`), on
  `localStorage` under `toil-ui.notify.history`, read through `useSyncExternalStore`,
  because the local app remounts the App after every sync and the history mustn't
  reset. Another tab's change is picked up from the `storage` event. An entry whose link
  isn't one of the app's own (`#/…`) is dropped when read, so a tampered copy can't turn
  the bell into a link out. Mark all read keeps the entries; opening the bell marks
  nothing.
- **Empty panels go through `Empty`**, whose `action` is required, rather than through a
  prop added to the themes' `EmptyState` slot: changing the slot would have meant editing
  every theme's skins while others are working on them, and the slot already renders
  its children. Every theme already ships empty-state art (`emptyState` in its
  `assets`), so no new art was added.
- **Which empty states count.** A panel that's empty because something isn't set up or
  hasn't been read yet: builds, deployments, pull requests, the sprint and burn-up, the
  dependency graph, the People view's accounts, the Analyses tab, the Command Center's
  filters, an agent's assignments, and an item or assignment the dossier doesn't have.
  A result that is good news (nothing blocked, nothing to flag, no issue stands out) is
  an answer, not an empty panel, and keeps its line. A board column is filled by
  moving a card into it, so its "Nothing here" stays. The chat's welcome is the one
  direct use of the slot left: its starter questions and question box sit right under
  it and are what fill it.
- **The action is Sync now where only a newer read would fill the panel**, and the
  pencil to the dossier's sources where the page can't sync (the preview). No pipeline
  and no environment both go to Dossier setup at **sources**, where an area is linked;
  there is no separate pipelines or environments section to land on.
- **A pencil that was already there is the action.** The People view's work-in-progress
  tile has its pencil beside it, so "No limit is set in the dossier." lost its command
  line rather than gaining a second link.
- **The test is two checks.** A source scan fails on any view using the slot directly;
  a render of an empty dossier's views, in Plain, Crate and Harvest, fails on any empty
  panel whose only control is an (i). Broken on purpose (the action dropped from
  `Empty`), it failed 23 of its 24 cases.
- **The layout check opens the bell's list and What's new** on the Dossiers view (and
  the bell on a dossier), at every width, in every theme, so both go through the axe
  and layout checks like every other state.
