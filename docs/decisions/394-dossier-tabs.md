# A dossier's page in tabs, with an Agents sidebar and a Minto Overview (#394)

- **Tabs are links, one route each.** Overview (`#/dossier/<name>`), Board
  (`/board`), Dependencies (`/dependencies`), Pull requests (`/prs`), People
  (`/people`), Worklog (`/worklog`) and Analyses (`/analyses`), drawn as a `nav` with
  `aria-current="page"` rather than an ARIA tablist, because each is a page with its
  own address, history entry and heading. The frame is
  `ui/src/views/DossierShell.tsx`; `tabOf()` in `ui/src/App.tsx` maps a route to its tab.
- **Old addresses land on their tab.** `/prs`, `/people` and `/worklog` (and its
  days and the stand-up) were already routes, so they keep their views and light their
  tab. `/command-center` has no tab in the approved mockup, so it is the Board tab's
  second view, **Readiness (Command Center)**, with a two-link switch under the tabs.
  An item's page lights Board; an assignment's page lights no tab, since the Agents
  sidebar is its home. `/board/<person>` (#292) is the Board tab filtered to that person.
- **The header carries only Dossiers and Settings.** A dossier's views moved into its
  tabs, so the header no longer lists them; the header's Menu fold (#387) still
  applies to what is left.
- **One h1 per page.** On the Overview, Board, Dependencies and Analyses tabs, which
  have no heading of their own, the dossier's name in the top row is the h1. Pull
  requests, People, Worklog, the Command Center, an item and an assignment keep their
  own h1, and the name is a plain line there. Their old "dossier name" eyebrow link is
  hidden inside the frame, since the top row says it.
- **The top row:** name (with the rename pencil), a **Switch** menu of the other
  dossiers plus "All dossiers" (the Dossiers view stays the main way to switch, as the
  maintainer asked), the sprint's day, the description cut to one line with the whole
  of it in its tooltip and the edit field opening in full, the source badges, and the
  Ask bar with Analyze. The old count strip (days left, in progress, blocked, PRs
  waiting) is gone from the dossier page: the tab's attention count, the Overview's
  issues and the PR wait sparkline say the same. It stays on the Dossiers cards.
- **The Agents sidebar** (`ui/src/assign/sidebar.tsx`) replaced the Agents lane. It
  sits beside every tab from 1200 px (`SIDEBAR_WIDE`), scrolling inside itself so it
  never makes the page longer, and is a drawer (a modal dialog from the right) behind
  an **Agents** button, with the needs-you count, below that. Groups: the inbox, then
  Needs you, Working (working, and queued for a slot), Stale (stale, not renewed,
  and not already in either), and Earlier (done and failed) folded under a
  `<details>`. Renew all stale and Limits moved with it. "Recent analyses" are the
  chat's Analyze answers in this session, until #395 keeps them.
- **The recommendation is code, not an agent** (`ui/src/model/recommend.ts`). Six
  issue kinds, each with a fixed base weight in the order a lead would clear them
  (blockers 100, failing builds 90, the sprint's pace 80, pull requests waiting 70,
  aging or quiet work 60, work not ready to start 50), plus one per ticket up to
  nine, so a bigger issue of a kind outranks a smaller one but never a heavier kind.
  The top three are the key issues; the heaviest one's action is the recommendation.
  The blocker to clear first is the one with the most items behind it counting chains,
  so the head of a chain wins over its middle. "The sprint's pace" is points done per
  working day so far, against the points left over the working days left, and only
  once a day has passed. The card says what it read and that no agent was asked.
  When #395 lands, its latest analysis can feed this card; the derived one stays as
  the fallback.
- **Needs attention means weight 2 or more.** The flag on a board card, the filter
  and the tab's count include insights that need action now (Blocked, Build failing,
  Aging) or a look (Deployed still open, Carried over, PR with no build, Stale,
  Blocking). "Worth knowing" alone (No estimate, Added mid-sprint, Merged not
  deployed) doesn't flag a card: on the sample nearly every card carried one of those,
  which made the flag noise. The old Needs attention panel listed every item with any
  insight; its insights are all still on the cards and item pages.
- **The board flag** is a small flag glyph beside the status chip plus a warning-coloured
  left edge, so it isn't colour alone; its word is screen-reader text and its tooltip.
  The one change inside `ui/src/views/Board.tsx` (a parallel drag fix owns that file)
  is the class, the flag, and reusing the card's insights for both. The filter lives
  in the Board tab, outside the board.
- **Five sparklines, not four.** The issue lists aging WIP alongside burn-up,
  throughput, cycle time and PR wait; the mockup showed four. Five fit the strip at
  1440 px and at 375 px they wrap two to a row, so all five are there. Each tile is a
  button whose name is its visible words; it opens the full chart in a dialog: the
  sprint panel in full (figures, burn-up, at risk, added, carried) for burn-up, and
  the existing Throughput, Cycle time and Aging panels. PR wait opens the open queue
  with what each waits on, and links to the Pull requests tab. "PR wait" is the
  longest current wait among open, non-draft pull requests in working days, not a
  six-week median, since the Overview is about now.
- **The blocker timeline slot** shows the two heaviest blockers, each with what it
  blocks, and a link to Dependencies. #396 replaces it with the compact Gantt.
- **Fits at 1440×900.** The Overview fits without scrolling in Plain (light and
  dark), Crate and Starship on the three sample dossiers (with the sample banner) and
  on the GitHub sandbox and the Azure DevOps board (with the local app's Sync panel
  under it). Realm's heavier panel frames run 4 px over on real data, and Harvest
  pads the page's foot by 192 px for its fields art on purpose; both are decorative
  themes. To get there: key issues show three ticket chips each and the rest as a
  count, the issue's sentence is cut at two lines, the recommendation's "how it was
  worked out" line sits beside its label, each blocker is one line (its titles give
  way first) with its first blocked item and a count, the tabs are 40 px tall, and
  the Sync panel's padding is half what it was (`ui/src/sync-panel.css`), which every
  page shares.
- **Harvest's sprint calendar** hung on the sprint panel, which left the page. It now
  shows in the burn-up dialog, which renders the sprint through the same panel skin.
- **The theme's "dossier" eyebrow** (`dossier.eyebrow`, Crate's "Consignment") and
  `attention.note` are no longer shown on the dossier page; their keys stay in the
  lexicons, which #397 owns for Crate. The board's note is plain text.
- **No snapshot files.** The recommendation and the metric names are asserted
  inline, matching the rest of the suite.
