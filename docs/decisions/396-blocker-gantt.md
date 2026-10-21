# A blocker Gantt on the sprint timeline (#396)

- **Plain SVG, no chart library.** The chart is `ui/src/views/Gantt.tsx` over the
  pure model `ui/src/model/gantt.ts`, drawn at the box's own pixel width (followed with
  a `ResizeObserver`), so text stays at its real size. No dependency was added; the
  existing xyflow graph stays under it on the tab.
- **Rows** are every item the dossier holds that is on a `blocks` link with at least one
  end still open, so a finished blocker shows when the wait ended. They are ordered by
  the dependency graph's rank (blockers above what they block), then the dossier's
  order.
- **Segments.** The main lane is time blocked and time in progress, never overlapping:
  while an item is blocked its time counts as blocked, not in progress. Failing checks
  are a thin lane under the bar, since they can run during either. In progress comes
  from the item's transitions (each spell into In progress until it left it); blocked
  runs until the blocker's last move into Done, its resolution, or its last update
  (estimated) for a done item with neither; failing checks run from the first of a
  pull request's latest run of failed builds (Jenkins, Azure Pipelines and GitHub
  checks, as `src/model/delivery.ts` joins them), or from the OWI change's `checksAt`
  when it has `checks: FAILING` and no build was joined.
- **What is estimated, and how.** No tracker toil reads (Jira, Azure DevOps or GitHub)
  dates a link, so a blocked segment starts at the later of the two items' creation
  dates, and is always marked estimated. An item in progress or done whose history has
  no move into In progress (GitHub issues) is drawn from its creation, marked
  estimated. The chart says so in a note under it, and every table cell that holds an
  estimate says "(estimated)". Before a sprint started, a segment is clipped to the
  timeline; the table keeps its real dates.
- **A blocker not started and not blocked has no segment**: its row says "Not
  started" in muted text, and its arrows leave from today, since that is the earliest
  it can finish. Drawing a bar would invent a start the data doesn't have.
- **Arrows leaving bars that end together get lanes of their own**, five of them 8 px
  apart, so on real data, where several blockers not started all end today, the
  arrows don't merge into one line (seen on the GitHub sandbox).
- **The timeline** is the current sprint's start to its end, or to now if that is later.
  With no sprint, it spans the bars' own dates to a day after now, and the note says so.
- **Colour by meaning, and never by colour alone.** In progress is the theme's accent,
  solid; blocked is its danger colour, hatched at 45 degrees and outlined; failing
  checks are its warning colour, as a 4 px strip. Arrows and their heads are the muted
  ink, the critical chain's are the ink at 3 px, and today is a dotted ink line. Crate
  gives accent and danger the same orange, and Realm two dark reds, so the shapes carry
  the meaning in every theme, and the colours add to it where they differ. Every
  token used for a mark is at least 5.5:1 on the card's surface in every theme and
  scheme (checked from each `theme.json`), above 1.4.11's 3:1; the gridlines and the
  critical chain's band are decoration.
- **The critical chain** is the path through the open `blocks` links holding the most
  points (`estimate` in points), ties going to the longer chain, then to the blocker
  `ui/src/model/recommend.ts` names first. With no points anywhere on a chain, it is
  the longest chain, and it says so. A loop is cut where it comes back round. Its rows
  carry a diamond and a faint band, and its arrows are heavy.
- **Shared with the recommendation.** Who blocks whom, and how many wait behind a
  blocker counting chains, moved from `recommend.ts` into `ui/src/model/blockers.ts`
  (`heldBy`, `behindAll`, `blockerOrder`), which both the recommendation and the chain
  read, so they can't disagree. The recommendation's behaviour is unchanged (its tests
  pass as they were).
- **Accessibility: the table is the accessible equivalent, and bars aren't
  focusable.** The SVG is one `role="img"` with a summary (the counts and the critical
  chain) and each row has a `<title>` tooltip for a pointer; the table under it, "Every
  bar and arrow", lists every bar with links, its segments with dates, and every arrow
  in its "Waits on" column. Focusable bars would add a stop per item that says less
  than the table row beside it.
- **Mobile: the chart scrolls in a declared scroller.** It keeps a smallest width
  (680 px, 560 px on the Overview) and scrolls sideways inside the shared `Scroller`,
  which is focusable when it overflows, labelled, and shows a shadow on the side that
  has more; a line above it ("Scroll the timeline sideways for the whole sprint, or
  read the table under it") shows when the card is narrower than 44 rem. Below a 560 px
  box the label column narrows from 220 to 150 px so more of the timeline shows. The
  table under it is there at every width.
- **The readiness gate** is read for work not started: the table's "Ready to start"
  column carries its verdict. Nothing is fetched: the chart reads only links,
  transitions, pull requests, builds and checks the dossier already holds.
- **The Overview's blocker slot** is the compact Gantt of the critical chain alone,
  with no day labels and at most four rows (the chain's head, if it is longer), its item and point count, and a link to Dependencies. It
  replaced #394's two blocker rows; their CSS is gone. The Overview still fits
  1440 by 900 on the sample.
- **Item keys and titles in the chart are plain SVG text**, cut with an ellipsis to the
  label column; the table carries the links and the whole titles.
- **The layout check** now opens the Dependencies tab of all three sample dossiers: a
  three-item chain with failing checks, a one-link Azure DevOps chain, and one with no
  blocker.
