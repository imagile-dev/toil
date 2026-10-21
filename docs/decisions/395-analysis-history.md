# A history of analyses, and answers that read top-down (#395)

- **The server keeps each Analyze itself** (`ui/server/analyses.ts`), on `agent/ask`
  when the prompt is Analyze and the answer ends whole: not stopped, not failed, not
  empty. Its last NDJSON line repeats the answer with `analysis: <id>`. The page never
  sends a record, so there is no write route: `analyses` and `analyses/one` only read.
  A record that can't be kept adds a warning to the answer and never fails it.
- **Where:** the cache, a new table `analyses` (schema 4), one JSON record per row,
  beside the worklog's tables. A sync never rewrites it. It goes with `toil-ui wipe`
  and the in-app wipe (the whole folder), with the retention period (by when the
  analysis was made), and with `forget` when toil no longer has the dossier, and it
  follows a rename. The newest 100 per dossier are kept (`MAX_ANALYSES`), so a long
  life can't grow it without bound.
- **What a record holds:** asked and answered times, the adapter, the model Settings
  gave it, the label shown, the usage the answer carried, the recommendation line and
  issues as read back from the text, the whole answer's paragraphs, citations, the
  ids the citation check flagged, its warnings and proposals, and a snapshot of the
  dossier's items at that moment: each open item blocked by an open item and by what,
  every item's points, and the sprint's points done and left.
- **What changed is code, not the agent** (`changesBetween` in
  `ui/src/model/analysis.ts`): newly blocked (or blocked by something new), cleared,
  points moved per item, the sprint's points, ids newly cited and dropped, and whether
  the recommendation line differs. It compares each analysis with the one made before
  it. The WIP limit and people aren't in the snapshot: the issue named blockers,
  points and citations, and a person's load is already the People view's.
- **Top-down in the prompt, as plain-text labels.** Analyze asks for
  `Recommendation:`, `Issues:` (numbered, three at most, "short name: sentence") and
  `Evidence:` with the five parts it had, each a label at the start of its line, "not
  a Markdown heading", so rule 4 (plain text) and the voice's rules still hold. The
  system prompt's rules are unchanged.
- **Reading the shape back** (`structureOf`) is lenient about Markdown a model adds
  anyway (a `#`, bold, a dash after the label) and strict about prose: "Evidence
  shows" is not a label. Issues past the third move to the end of the evidence, and
  the page says how many. Text before the Recommendation goes to the end of the
  evidence. **An answer with no Recommendation line is shown as it came**, with a note
  saying so, rather than guessed at: the record keeps it with no recommendation, and
  the Overview falls back to the code's.
- **Only Analyze is laid out top-down.** Other questions ask for no such shape, so
  their paragraphs stay as they are.
- **Chips for every citation in an agent's answer**, not in text the code wrote:
  `Cited` takes `chips`, used by the chat, the Analyses tab, an assignment's report,
  the stand-up's write-up, a worklog run's transcript and an agent proposal's reason.
  Insights, readiness reasons and the Overview's own issue sentences keep the plain
  link, since they already say what each id is. The chip is the Overview's
  `TicketChip`, moved to `ui/src/components/items.tsx` (the Overview re-exports it for
  #396), with a React Aria tooltip on hover or keyboard focus: type and status,
  assignee, estimate, sprint and last update; a pull request's repository, author,
  checks and how many items it carries. An id the dossier doesn't hold stays the bare
  `missing` id, as before.
- **A stored id the dossier no longer holds** renders as that bare id too. Keeping
  each cited item's title in the record would cover it, at the cost of a bigger
  record; left for now.
- **The Overview's recommendation** is the latest analysis's when it has a
  recommendation line, saying "From the latest Analyze", its time, who wrote it and a
  link; otherwise the code's, saying "Worked out by code" and whether there is no
  analysis or the latest had no line. The key issues stay the code's either way. The
  analysis's line is cut at three lines there, to keep the page to one screen; the
  whole of it is one press away.
- **One copy of the history per dossier page**, in the chat's scope (`useHistory` in
  `ui/src/components/ask.tsx`): the tab, the sidebar and the Overview read it, and it
  is read again after each Analyze ends.
- **The preview has no server**, so it keeps the history in memory
  (`memoryAnalyses`), and the chat records each Analyze there through the API's
  optional `record`. The sample (`fixtureAnalyses`) gives card-payments two scripted
  analyses, the earlier one on a hand-made snapshot (PAY-103 not yet blocked, PAY-104
  waiting on PAY-105, PAY-102 two points lower, three fewer points done), so the
  history and what changed show; settlement and checkout-web have none, so the code's
  recommendation shows there. `toil-ui --sample` serves the same, in memory for the
  run. An App given no history keeps the page's own, which starts empty.
- **The scripted Analyze** answers top-down too (`ANALYZE_TOP` in
  `ui/src/fixtures/agent.ts`), each line restating facts its evidence already holds.
- **Following a link from the chat closes it**, so the page it opens (a kept analysis,
  an item) is in front. Before, a citation followed from the focused view left it open
  over the new page.
- **`verify:ui --ask`** goes on after its Analyze: the analysis kept top-down, the
  dossier's WIP limit changed in the scratch home (`toil dossiers wip-limit
  --replace`), Analyze again, both listed with what changed, and the Overview, the tab
  and the second analysis opened through the layout check, shot.
