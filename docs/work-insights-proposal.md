# Work insights proposal

Issue #567. Built on one branch together with #566, the work classification, which it
depends on.

A proposal for Toil UI and toil to show where a team's work goes. The person chooses how
to split it. Every chart, list and summary can be split by any dimension the data holds:
- the work category (`docs/work-classification-proposal.md`, #566);
- the parent epic or feature, at any level of the tree;
- a Jira fix version or component;
- a sprint, an ADO area path or a GitHub milestone;
- a team, a label family or a custom field.

Every number drills down to its items, and every chart can be handed to the person's AI
agent for analysis with the figures behind it. Charts tell series apart with four marks
per theme, each a colour and a border drawn from the theme's own character: simple lines
in Plain and Crate, picture borders in the others, and each mark names its value on
hover.

Slices 1 to 5 are built. Not built: the sync fetching an ancestor it doesn't hold, a
setting to read further back than the default window, release forecasts (decision 5 was
taken as none), "carried in from the previous release", pinning a value from a legend,
highlighting a cited cell, and live runs against real trackers.
`docs/decisions/567-work-insights.md` lists the defaults taken where this text left a
choice.

## What's there today

Read from the code on 9 November 2026, not from a running instance.

| Area | Today | Gap |
|---|---|---|
| Item data | Open Work Items (OWI, `src/core/owi/types.ts:115`) carry type, status, assignee, priority, estimate, labels, team (by override only), the current iteration, parent, dates and history. The raw tracker record is kept in `native`, and Toil UI's cache stores it | Jira fix versions, affected versions and components, ADO area path, and a GitHub milestone (it becomes `iteration`, replaced by a board iteration) survive only in `native`. Only the current sprint is kept as `iteration` |
| Toil UI's Jira sync | `jira issue search` with no `--fields` (`ui/src/load.ts:373`) | Jira items in Toil UI have no fix versions, components, parent, links, resolution date or due date. Sprint and story points come through only if the connection registers them |
| Listing dimension values | `jira board list`, `jira sprint list` and `jira issue set-sprint` (Data Center and Cloud), `jira sprint get \| create \| update \| start \| complete` (Cloud only), `ado work-item iterations`, `ado work-item areas` (Server only), `github project fields`. On Cloud, `jira project get` returns `components` and `versions` | On Data Center, Jira versions and components are reachable only through `jira api`. GitHub milestones have no command (and the GitHub area has no `api` passthrough). ADO areas have none on Services |
| Teams | `people` in a toil project: name, kind, ids (`src/core/toil-project.ts:61`). People matching (`toil projects people suggest \| save`, `src/core/people-match.ts`) maps tracker accounts to those people by email, name or login | Nothing maps a person to a team |
| Charts | Hand-drawn SVG: burn-up, weekly throughput bars, cycle-time scatter, sparklines, aging bars (`ui/src/components/charts.tsx`). Each has a "Show the figures" table | No stacked, categorical or cumulative-flow chart. No categorical colours in any theme. No hover tooltip, no click to drill, no legend |
| Grouping and filters | Board by status columns only (no swimlanes; long columns fold with "Show N more", Done keeps 10 and the others 25; a whole card is its drag handle and carries no button), People as one card per person (never ranked), code review flow by author kind, Command Center pickers in local state, the Board's person filter in the URL | No split-by, no shared filter bar, no saved views, no sortable tables, filters not in the address |
| AI agent | The Ask bar, "Get a briefing" (kept runs, compared), stand-up write-up, jobs. Answers cite items as `[[id]]`, are checked, and may carry proposals applied by a press. The agent reads the cache through read-only tools (`owi_query` filters by type, status, assignee, iteration and label, and returns records without `native`; there is no write tool, `ui/server/agents/tools.ts:11`) | No screen has "ask about this". `POST agent/ask` sends only the toil project and the prompt, never what is on screen: no screen data, filters or figures |

`docs/work-insights-seats.md` reads the same gaps from three seats, a manager's, a scrum
master's and a product owner's: ten questions each, where each is answered today, and
where it gets built. `docs/sample-team.md` is the sample team every one of them can be
answered on.

So the work is three layers: get the dimensions into the data, build one model that splits
any measure by any dimension, then put it on screens and in prompts.

## Principles that shape it

- **Every number is a door.** A figure on any screen opens the items behind it, and every
  chart has its figures as a table (principles 4 and 11).
- **The person chooses the split** (principle 11, as sharpened on 9 November 2026).
  Wherever a screen groups, splits or filters work, the person picks the dimension from
  every one the data holds. A dashboard's built-in split is only where it starts:
  - Every split is a menu.
  - Every preset can be changed.
  - The choice lives in the address and in saved views.
  - A field the data holds but no menu offers yet can be picked as it is (**Any field**,
    below).
- **One model behind every split.** One set of dimensions and measures serves every
  chart, the CLI, MCP and the AI agent. It lives in toil's core as pure functions, as the
  briefing does (`src/core/brief/`), so the numbers on screen are the numbers an agent gets
  from `toil`.
- **Honest buckets** (principle 4):
  - "No fix version", "Unassigned" and "Unclassified" are always shown, never dropped.
    Each means the item was read and has none.
  - **Unknown is not zero** (principle 12). A dimension the read never fetched (say fix
    versions weren't asked for) is unknown, so it gets no bucket at all. The chart says
    the dimension wasn't read, beside the action that reads it. On screen a figure nobody
    has read yet is a dash ("not read yet"), and in an envelope it is `null` or absent,
    never 0, "" or `[]`. A sentence that claims an absence needs a reading behind it.
  - A dimension that can hold several values (labels, components, fix versions) says that
    an item can count in more than one.
  - Each measure says its unit and how many items it covers ("estimate: 312 of 340 items
    have one").
- **Quiet first** (principle 11):
  - Each dashboard opens on one headline. Splits, filters and units sit in menus and the
    command palette, not as buttons on every chart.
  - Everything is reachable from its own address, so a view can be sent as a link.
- **The team, not the person.** Splits default to team level. A person's breakdown is a
  step in, in name order and never ranked, as the People view already is.
- **AI explains, code counts.** toil computes every figure and flags notable changes by
  code. The AI agent reads those figures and explains them, citing items and chart cells.
  The agent never invents a number, and its claims are checked against the figures.

## Layer 1: the dimensions in the data

**OWI gains the fields people split by**, all additive (new `data` fields; nothing renamed):

| New OWI field | Jira | ADO | GitHub |
|---|---|---|---|
| `releases[]` `{ id, name, released, date }` | `fixVersions` | a field named in the toil project (`fields.release`), or a tag family | milestone (still also `iteration` when there's no board, as today) |
| `affects[]` | `versions` | `fields.affects` | none |
| `components[]` | `components` | none (see `area`) | none (see label families) |
| `area` `{ path }` | none | `System.AreaPath` | none |
| `sprints[]` (every sprint, not only the current) | the Sprint field's whole list | iteration history | board iteration history |
| `dims{}` | any field the toil project names | any field | any Projects v2 single-select or iteration field |

The OWI `WorkItem` is unchanged on `main`, so every field above is still new. New OWI
pointers such as `fields.release` and `fields.affects` are added to `OVERRIDABLE`
(`src/core/owi/types.ts:158`) and to `jira field discover`'s alias guard
(`src/core/field-discovery.ts:27`) together, or discovery could suggest `release` as a
plain alias.

- **`dims` is the escape hatch.** A toil project names extra dimensions once, and mapping
  copies them onto every item, so a team can split by its own custom fields (customer, risk,
  product line) without toil knowing them:

  ```json
  "dimensions": { "customer": { "jira": "customfield_10500", "ado": "Custom.Customer" } }
  ```

  Toil reads any unknown top-level toil project key as an area section, so two rules
  keep the key safe:
  - `dimensions` is an object keyed by dimension name.
  - It never holds a key named `fields`, `connection`, `host` or `transitions`.

- **Label families** turn a label prefix into a dimension in all three trackers: `area/`,
  `team:`, `customer-`. "Split by labels starting with `area/`" works wherever a team
  encodes structure in labels.
- **Tree dimensions** (ADO area and iteration paths) split at a chosen depth: "area path,
  level 2".
- **The parent tree.** OWI gains `ancestors[]`, `{ id, type, typeName, title }` from the
  nearest parent to the top. It's read from:
  - Jira: `parent` (with Epic Link on Data Center), up through any levels above the epic
    (an initiative);
  - ADO: hierarchy relations, Epic › Feature › User Story and any custom levels;
  - GitHub: the sub-issue parent chain, with issue types such as Epic or Feature where
    the organization has them.

  The sync fetches an ancestor it doesn't already hold, by id, so a split works even when
  the epic lives outside the toil project's own query. Splitting by parent offers a level:
  - **the direct parent**;
  - **the nearest ancestor of a type**, labelled with the tracker's own type name ("Parent
    › Feature", "Parent › Epic", "Parent › Initiative");
  - **the top of the tree.**

  Items with nothing at that level fall in a named bucket, "No epic". In the menu, the
  tracker type "Feature" always sits under Parent, apart from the work category
  "Feature", so the two never share a label.

  When splitting by parent, the parents themselves are left out of the measure by default,
  because their children carry the work and an epic's own estimate would count it twice. A
  toggle puts them back, and coverage says which.
- **Any field.** Toil UI lists every field present in the synced records (the raw record
  OWI keeps in `native`), with the share of items that have it. The person can split by
  one at once, as it is. **Keep as a dimension** then writes it into the toil project's
  `dimensions` with a press, so it's mapped properly from the next sync.
- **Teams.** A toil project's people gain an optional `team`. Nothing maps a person to a
  team today, but people matching (`toil projects people suggest | save`) already maps
  tracker accounts to the toil project's people. The `team` dimension resolves in this
  order:
  1. the item's own team field, such as Jira's Team field or an ADO area a team owns,
     set through `fields.team` as today. `jira field discover` can find a Jira Team
     field: it suggests it as `team`;
  2. the item's assignee, matched to a person by people matching, and that person's
     `team`;
  3. "No team".
- **Category** comes from work classification: the scheme's labels on the item, or the
  verdicts in the ledger.

**Syncs ask for them.** Toil UI's Jira sync asks for `fixVersions`, `versions`,
`components`, `parent`, `issuelinks`, `resolutiondate`, `duedate`, `description`, the
Sprint field and every field named in `dimensions`. ADO's `get-many` already returns
everything, so it needs mapping only. GitHub's `project items` asks for every
single-select and iteration field, not only the ones the OWI override names. Today's Jira
sync is `issue search` with no `fields` (`ui/src/load.ts:373`); adding fields keeps the
daily reconcile's `fields: 'key'` override (`ui/server/sync.ts:184-188`).

**How far back the read goes.** Toil UI reads open items plus those changed within a
window that defaults to 42 days (`ui/src/load.ts:46,54`; retention 30, lookback 42).
Monthly trends and "last 90 days" go past it.
- The Charts views say how far back the read goes.
- Slice 1 lets a toil project read further back, as a setting of the toil project.

**The value lists**, for filter menus and for release dates, come from new reads:

- `jira version list --project` and `jira component list --project`, on Data Center and
  Cloud. On Cloud, `jira project get` already returns `components` and `versions`; on
  Data Center they are reachable only through `jira api`;
- `github milestone list`, where there is no command today and no `api` passthrough;
- `ado work-item areas` on Services as well as Server;
- sprints already have lists: `jira board list`, `jira sprint list` and
  `jira issue set-sprint` on Data Center and Cloud, and Cloud-only
  `jira sprint get | create | update | start | complete`. The sprints dimension and its
  filter menu read `jira sprint list`.

A release's date and released flag drive the release burn-up below.

## Layer 2: one model, in toil's core

`src/core/insights/` holds pure functions that Toil UI imports, as it imports the briefing.

**Dimensions**, each with its values and a "none" bucket:

| Kind | Dimensions |
|---|---|
| Single-valued | category, type, status category, status, priority, assignee, team, iteration, area (at a depth), repository or project, tracker |
| Parent | the direct parent, the nearest ancestor of a type (Feature, Epic, Initiative, or whatever the tracker calls its levels), or the top of the tree |
| Multi-valued | labels, label family, components, releases (fix version), affected versions, `dims` that hold lists |
| Time | created, started, resolved, by week, month, quarter, sprint or release |
| Derived by code | age bucket, size bucket, planned or unplanned (added after the sprint started, or linked to an incident), has an epic, carried over, reopened |

**Measures**, each naming its unit, its source and its coverage:

| Measure | Unit | Comes from |
|---|---|---|
| Items | count | items |
| Estimate | points, hours or days, as the tracker says | `estimate`; items with none are counted and reported |
| Days in progress | person-days | status history, at most five days a week per person, split across their open items |
| Throughput | items done per period | resolved dates |
| Cycle time | days, p50 and p85 | status-category transitions (`model/flow.ts`) |
| Work in progress, aging | count, days | open items, history |
| Added mid-sprint, carried over | count, estimate | iteration history (`model/sprint.ts`) |
| Share | percent of the period's total for the chosen measure | any of the above |

**A pivot** is a measure, split by one dimension, across time or a second dimension, under
filters. It returns:

- the table;
- the item ids behind every cell;
- coverage per cell. A cell whose measure couldn't be computed is `null`, with coverage
  saying why, never 0. Toil UI has no shared dash component yet: `Trend` and an
  unexported `Count` in `ui/src/components/toil-project-head.tsx:68-123` handle `null`,
  and slice 3 lifts them into one shared component the charts use;
- the four largest values (or the ones the person pinned), with the rest folded into
  "Other" and the whole list still available;
- notable changes found by code: a share that moved more than a threshold against the
  previous period, scope added to a release after it started, a bucket that grew faster
  than the rest.

**On the CLI and MCP**, the same model is a command:

```bash
toil jira issue search --jql "project = PAY" --fields fixVersions,components,labels,parent \
  | toil util owi map \
  | toil projects pivot payments --measure items --split category --across release --where "status != Done"
```

- `toil projects pivot <toil-project>` reads OWI on stdin like `projects brief`, with the
  toil project for teams, dimensions and the classification scheme. Its `data` is the table
  above, and `meta` names the measure's unit and coverage.
- `toil projects view set | show | list | remove` keep named views in the toil project, so
  a team shares its dashboards. `projects pivot --view release-mix` runs one.
  - `views` is an object keyed by view name, never an array (an array is "The views
    section must be an object", an error that stops the load).
  - `view remove` deletes something, so it is CLI only and refused over MCP, like
    removing a person.
  - The code type is named for saved views, not `ToilProjectView`, which is taken
    (`src/core/toil-project.ts:762`).
- Archived toil projects (`archived: true`) are skipped by default wherever a pivot or the
  charts in the Summary span several toil projects.
- The same figures are on the CLI and MCP for anyone who wants them. They are documented
  in the docs and the skill, not on any screen.
- An agent outside Toil UI (Claude Code, Copilot, Codex over MCP) gets the same figures the
  screens show.

## Layer 3: the screens

### Summary pages, augmented

- **Summary, "Show the full briefing".** Two new lines, each opening its dashboard:
  - **Work mix:** "Feature 58% · Keep the lights on 34% · Unsure 8%, last 90 days", with
    a sparkline.
  - **Releases:** "4.2 due 21 Nov: 68% done, scope +14 since it started".
- **The numbers, split.** The numbers are the `MetricStrip` inside "Show the full
  briefing". Its tiles are Points done (burn-up), Finished (throughput), Time to finish
  (cycle time), Work getting old (aging WIP) and the code-review wait, and each opens a
  chart modal. Those modals gain a Split by menu: Finished by category, Time to finish by
  component, Work getting old by team. The modal becomes a small explorer with an "Open
  in the chart page" link.
- **Board.** The Board's filters join the shared filter bar (below), so "release 4.2,
  Keep the lights on" narrows the Board too. A Group by menu groups the Board by any dimension: parent
  feature or epic, release, team, category.
  - Groups work as swimlanes over the status columns (TODO, IN_PROGRESS, DONE).
  - Each lane keeps the per-column "Show N more" limits (Done keeps 10, the others 25).
  - Nothing clickable is added to a card: a whole card is its drag handle and carries no
    button.
  - The Board's two views, Board and "Ready to start?", both take the filter bar.
- **People.** People has no per-person page: it is one card per person
  (`PersonCardView`), linking to the filtered Board. The card shows the mix of that
  person's open work as one bar, no score. The mix starts by category, and the person
  picks any other dimension.

### Charts, in the Summary

First built as a Charts tab after People; the maintainer folded it into the Summary (Where the work goes, `/summary/<chart>`). The original design follows, as it was proposed: one new tab, working name **Charts** ("Insights" is already Toil UI's word for per-item
flags, shown on screen as "Worth a look"). Before this work the tabs, in order, were
Summary, Board, What blocks what, Code reviews, People, What happened and Past
briefings; the tab was added after People. Adding one meant:
- an entry in `TOIL_PROJECT_TABS` (`ui/src/views/ToilProjectShell.tsx:43-51`);
- `parsePath` and `tabOf` (`ui/src/App.tsx:158-205`);
- a link in the Summary's "Go to" row.

The command palette and the header project switcher pick the tab up on their own.

It opens on a list of dashboards, each with its headline, and each dashboard has one
focus:

- **Releases** (Jira fix versions, GitHub milestones, or ADO's release field). For each
  release:
  - scope, done and remaining;
  - a burn-up toward its date, with the scope line;
  - scope added after it started, and items carried in from the previous release;
  - the mix by category, and what's open past its date.

  It starts split by category, and can be split by any dimension: parent feature,
  component, team, and so on. Optionally, it shows a forecast range drawn from recent
  throughput, labelled as a forecast with its method (decision 5).
- **Sprints.** Committed, added, carried and done per sprint, from the sprint model Toil UI
  already has, split by category or team, or by planned and unplanned work. Its headline is
  the velocity: the done figure per sprint, with its range over the sprints read
  (`docs/work-insights-seats.md`, S3 and S4).
- **Work mix.** The #566 page: a stacked trend of the category shares by month, with
  breakdowns by team, release, component or epic. Beside the chart, never behind a
  tooltip, it says how much of the mix was decided by rules, by the AI agent and by
  people, and how much is still unsure; the unsure share opens the Board's Classify view
  (seats M4 and S10).
- **Where we're working.** A heatmap with rows by any dimension (it starts at the parent
  epic, and changes to feature, component, release, area or anything else) and columns by
  week. Each cell shows days in progress, and the row's category
  share sits at its end. Beside it:
  - "parallel streams": how many epics were in progress each week;
  - the share of work with no epic above it.

  Both are headline figures of the dashboard, and each opens its items (seats M8 and P7).
- **Flow.** Throughput stacked by any split, a cumulative flow diagram, the cycle-time
  scatter with its dots marked by a split, and aging work in progress by a split.
- **Explore.** Pick a measure, a split, an across and filters, and the chart form follows
  the data (stacked columns over time, stacked bars for categories, a heatmap for two
  dimensions). Its two actions:
  - **Save this view** writes the view into the toil project through
    `projects view set`, as a press.

  Screen copy never shows a terminal command, an environment variable name or a file path,
  except on an approval card. So no screen shows the command for a view. Anyone on the CLI
  or MCP gets the same figures from `toil projects pivot`, documented in the docs and the
  skill.

### What every chart does

- **Hover** shows exact values, the item count and coverage. Marks can be focused from the
  keyboard and stepped through with the arrow keys.
- **Click** a segment to drill to its items in the drawer. Shift-click adds it as a filter
  instead. Today `?item=` holds one id, so a drill into a segment needs a drawer that lists
  several items (slice 3).
- **The legend** isolates or hides a series. A mark follows the value, never its rank,
  so filtering never restyles a series.
- **Split, group and filter menus** on every chart offer every dimension the data holds,
  parent levels and any field included.
- **Toggles:** count or share, and against the previous period.
- **Annotations** mark sprint boundaries, release dates and the day a scheme revision
  changed.
- **Figures and export:** "Show the figures" stays. Export writes CSV or JSON through
  `util encode --out` and toil's file service, the path the worklog export already uses.
- **Item tables**, behind every drill, are sortable by any column, with the split's
  dimensions as columns.
- **One filter bar** across the charts and the Board holds the date range and dimension
  chips. It lives in the address (`?release=4.2&category=ktlo`), so the back button and a
  shared link both work. That needs routing work (slice 3):
  - Today the item drawer's `peekHref` and `unpeekHref` keep only the path before `?`
    (`ui/src/format.ts:51,53`), and `parseRoute` reads only `item` and `target`
    (`ui/src/App.tsx:133-136`). A filter would be lost whenever the drawer opens or
    closes, so both keep the filter and `parseRoute` reads it.
  - The drawer that lists several items (above) reads its ids from the address too.

**New in the chart kit:** stacked and 100% stacked columns and bars, stacked area and
cumulative flow, a heatmap, small multiples (for a split past four values), and a
burn-up with a range.

### Series marks: four per theme, told apart by their borders

Series are told apart by **border first**, with colour as a second cue. Each theme
defines four marks, each a pale fill and a strong border drawn from the theme's
character:

- **Plain and Crate** use simple line borders (solid, dashed, dotted, double). They are
  the strict WCAG AA themes, and a plain line is the quietest mark that still reads.
- **The six decorative themes** use picture borders: a frame drawn around the segment,
  such as Frontier's riveted iron plate or Realm's iron chain. Each also has a simple
  border to fall back to.

The rules:

- **Readable without colour.** A chart reads correctly in greyscale, printed, or to
  someone who can't tell the hues apart. Within a theme the four marks never share a
  frame, and their four fallbacks never share a style either, so a chart that mixes
  frames and fallbacks still reads.
- **Every mark is a tooltip.** Hover or keyboard focus on a segment, a line, a legend
  swatch or a chip shows what the mark stands for, then its figure:
  - **The name:** a category reads in plain words on screen ("Keep the lights on"), and
    its tooltip adds the short form from the scheme ("Keep the lights on (KTLO)"), so
    someone who knows it as KTLO still finds it (principle 11). Other values show their
    own name, such as the release, the epic's key and title, or the team.
  - **The figure:** for example "4.2: 24 items, 36% of the release". A legend swatch
    gives the total across the chart.
  - **The mark's own name** ("Riveted iron plate") is never shown. It belongs to theme
    authors and `ui/docs/themes.md`.
  - **Touch and screen readers:** a tap shows the tooltip and a second tap drills
    (**What every chart does**). The same text is the mark's accessible name.
- **Two neutral marks** come in every theme, drawn from its own tokens:
  - **Other:** a muted fill with no border.
  - **None** ("No fix version", "Unsure", "No epic"): no fill, and a thin muted dashed
    border, so the absence of a value never looks like a value.
  - **None is for a value that was read and is absent.** A dimension the read never
    fetched is unknown and never gets a mark.
- **Four values, then Other.** A split shows its four largest values in the four marks
  and folds the rest into Other. The person chooses (principle 11):
  - **Pin a value to a mark**, so "4.2" or "Payments API" keeps its mark across charts.
  - **Small multiples:** turn a split into one small chart per value, all on the same
    scale.

  A classification scheme's categories hold fixed marks: two categories, or the four of
  the `balance` preset, fill the marks exactly. "Keep the lights on" looks the same on
  every chart.
- **When the simple border is used instead of the frame:**
  - a segment too small to hold the frame (under about 26 by 22 px);
  - lines (burn-up, cumulative flow), where the style becomes the line's dash;
  - forced-colours mode (Windows High Contrast), which draws every mark in system
    colours;
  - **Simple chart marks**, a setting in Settings → Appearance, kept per browser, for
    anyone who finds the frames busy.
- **On every chart form:**
  - **Bars and areas:** the border is drawn inside the segment's outline, with the usual
    2px surface gap between segments.
  - **Legend swatches:** drawn the same way, with the frame where the swatch holds it.
  - **Heatmaps:** use one sequential ramp, not marks.
- **Where they live.** In each `theme.json`, beside the colour schemes:

  ```json
  "series": {
    "light": [ { "name": "Riveted iron plate", "fill": "#d9d6cf", "stroke": "#3e3a35", "detail": "#a8a49b", "frame": "ironplate", "style": "heavy" }, ... ],
    "dark":  [ ... ]
  }
  ```

  - `style` is the simple border: one of `solid`, `heavy`, `dashed`, `dotted`, `double`,
    `dashdot` or `pixel`. The chart kit draws each as SVG, as a dash array or an inset
    second outline.
  - `frame` names the picture border. Plain and Crate leave it out.
- **Frames are theme art.** Each decorative theme ships one sprite,
  `ui/themes/<name>/assets/series.svg`. It holds a corner symbol and an edge symbol for
  each of its four frames, painted in `currentColor` (the mark's `stroke`) and
  `var(--mark-detail)` (its `detail`). One asset therefore serves light and dark.
  - **How it's drawn:** the chart kit places the four corners and tiles the edge along
    each side, the nine slices of CSS `border-image`, drawn in SVG so it works inside a
    chart.
  - **Rules for the art:** frames stay within about 7 px of the edge, so the segment's
    middle stays clear.
  - **Budget:** the theme art budget holds: CSS, SVG, sprites and still images, 64 KB a
    file and 320 KB a theme.
- **Checks.**
  - **Distinct marks:** a test holds each theme to four marks, four different `frame`s
    where there are frames, and four different `style`s.
  - **The art resolves:** every `frame` has its corner and edge symbols in the theme's
    sprite, and each sprite is within budget.
  - **Contrast:** a mark's `stroke` must reach 3:1 against the theme's surface and
    against its own fill, in its scheme (WCAG 1.4.11, non-text contrast). This holds in
    the decorative themes too, because the border is what carries the data. Every
    proposed mark passes in both schemes.
  - **Layout:** the layout check renders every chart form in every theme, with frames
    on, then with **Simple chart marks** on.
  - **Status colours** (`ok`, `warn`, `danger`) are never a mark.

The proposed marks. Each cell gives the border, then the simple style it falls back to:

| Theme | Character | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Plain | Quiet, the accessibility baseline | Solid, blue | Dashed, orange | Dotted, teal | Double, violet |
| Crate | Warehouse dock on drafting paper | Blueprint line: solid, blueprint blue | Packing tape: dashed, kraft brown | Chalk line: dotted, slate | Pallet straps: double, teal |
| Frontier | Brass, rivets and rails | Riveted iron plate, then heavy | Brass steam pipe, then double | Railroad track, then dashed | Lasso rope, then dash-dot |
| Harvest | A 16-bit farm | Picket fence, then solid | Wheat sheaves, then dashed | Cobblestone path, then double | Pumpkin vine, then pixel |
| Overworld | 16-bit dungeon rooms and gems | Dungeon stone, then double | Hedge, then solid | River, then dashed | Treasure trim, then pixel |
| Realm | Grimdark ledger in leather and wax | Tooled leather, then dashed | Iron chain, then dotted | Knotwork, then double | Map neatline, then solid |
| Sprawl | Neon terminal in the rain | Neon tube, then solid | Circuit trace, then dashed | Hazard stripes, then pixel | Barcode, then double |
| Starship | A bridge console's HUD | HUD frame, then solid | Hull plating, then double | Hex shield, then dotted | Star-chart scale, then dashed |

The maintainer accepted these marks on 9 November 2026. Their exact colours, light and
dark, are in **Appendix: the accepted marks**. They move into each `theme.json` when
built, where the contrast test checks them.

**Coverage.** Every new view goes into the `ROUTES` list in `ui/scripts/layout-check.mjs`
at 375, 768 and 1440 px in every theme, with its drill and menu states, and the sample data gains releases,
components and categories.

## Layer 4: AI analysis

- **Ask about this.** Every chart and dashboard has it: in the chart's menu, in the command
  palette, and on a shortcut. The palette already has "Ask about <project>"
  (`ui/src/components/palette.tsx:120`), so the new one is named apart, "Ask about this
  chart", and is added as a `UiCommand` (`ui/src/commands.ts`). Toil UI sends the agent a
  view context, fenced off as data and capped in size:
  - the view's definition: measure, split, across, filters and period;
  - the figures table;
  - coverage and the multi-valued note;
  - the notable changes found by code;
  - the item ids behind each cell.

  Today's Ask sends none of this: `POST agent/ask` carries only the toil project and the
  prompt. It gains a `context` field, built the way PR 568's setup guide built its
  context:
  - The server reads a whitelisted state (`readGuideState`, `ui/src/guide.ts:157`), so the
    `context` is checked against a whitelist, never passed through.
  - It is fenced off in the prompt as data.
- **Suggested questions** per dashboard:
  - Releases: "What's putting 4.2 at risk?" and "What was added to 4.2 after it started,
    and why?"
  - Work mix: "Why did 'Keep the lights on' work rise in October?" and "Which components
    need the most of it?"
  - Where we're working: "What are we spread across?"
- **Citations to the chart.** Answers keep `[[PAY-412]]` item citations and add cell
  citations (`[[cell:4.2/ktlo]]`), which highlight the mark they point at. The citation
  check covers both, so a claim that names a cell the figures don't hold is flagged.
- **The agent computes; it doesn't guess.**
  - A new read-only tool, `insights_pivot`, runs the same pivot the screen ran, so the
    agent can check a hunch ("is it one component?") with real figures. It is added to
    `ui/server/agents/tools.ts` and named in the prompt's tool rule
    (`ui/server/agents/prompts.ts:204`).
  - `owi_query` gains filters for every dimension. It returns records without `native`,
    so releases and components reach the agent only once they are OWI fields (slice 1).
- **Proposals stay proposals.** An answer may propose "move these 6 items to 4.3" or
  "classify these 4 as Keep the lights on". Each is applied by a press, through the write
  gate, like every proposal today.
- **"Get a briefing" learns the dashboards.** A kept run can include a section on the charts:
  the notable changes since the last run, each explained and cited. "What changed between
  runs" then covers the mix and the releases too.
- **Outside Toil UI.** The MCP prompt `insights` gives an agent a toil project and a
  question; it runs the reads and `projects pivot`, then answers with citations. **Copy for
  AI** puts the view context on the clipboard as Markdown, for a person whose agent isn't
  set up in Toil UI.

## Slices

1. **Dimensions in the data (CLI and MCP):**
   - the OWI fields `releases`, `affects`, `components`, `area`, `sprints`, `ancestors`
     and `dims`, with the sync fetching missing ancestors;
   - label families and tree depth;
   - `dimensions` and `team` in the toil project, and a setting that lets a toil project
     read further back than the default window;
   - `jira version list`, `jira component list`, `github milestone list`, and
     `ado work-item areas` on Services;
   - Toil UI's syncs asking for the fields, keeping the daily reconcile's `fields: 'key'`
     override;
   - fixtures, the parity suite, and a live run per tracker.
2. **The model, and pivots on the CLI and MCP:** `src/core/insights/`,
   `projects pivot`, `projects view`, and the agent tool `insights_pivot` with the wider
   `owi_query`.
3. **The chart kit and Explore:**
   - the new chart forms, hover, drill, legend and keyboard;
   - the four series marks in every theme, with their frame sprites, tooltips, the
     **Simple chart marks** setting and their tests;
   - split, group and filter menus over every dimension, including parent levels and any
     field;
   - pinned marks and small multiples;
   - the filter bar in the address, with the routing it needs (the drawer's `peekHref`
     and `unpeekHref` keep the filter, `parseRoute` reads it) and a drawer that lists
     several items, and sortable tables;
   - one shared dash component for a figure nobody has read yet, lifted from `Trend` and
     `Count`;
   - export, and the Explore view.

   It reuses what Toil UI has:
   - the card menu (`ui/src/components/card-menu.tsx`) for a chart's menu;
   - the panel's source line ("From Jira and GitHub", with read counts and failures kept
     on screen) for each chart's source;
   - the layout check's `ROUTES` list (`ui/scripts/layout-check.mjs`) for the new views;
   - `ui/src/wording.ts`, where each new on-screen word key is filed as functional or
     flavour.
4. **Dashboards:**
   - the charts, first a Charts tab and now the Summary's Where the work goes, with Releases, Sprints, Work mix, Where we're working and Flow;
   - the Summary lines and splittable modals;
   - Group by on the Board, and the mix bar on each person's card in People.

   #566's Work mix page moves onto this kit, and gains every dimension and the marks.
5. **AI analysis:** Ask about this with the view context, cell citations, suggested
   questions, notable changes in "Get a briefing", the MCP prompt `insights`, and Copy for AI.

The maintainer's call of 9 November 2026 was that this work depends on #566; both were
then built on one branch, #566's parts first. The
work category is the first dimension, and slice 4 builds on #566's Work mix page.

**Compatibility.** Everything is additive: new OWI fields, new commands, and new toil
project keys (`dimensions`, `views`, a person's `team`). The OWI `iteration` keeps today's
behaviour, milestone fallback included, so nothing that reads it changes. None of it is a
breaking change, but one thing needs care with older toils:
- An older toil warns about the unknown toil project keys.
- An older toil drops a person's `team` whenever it rewrites the toil project, for example
  `toil projects people save`, which writes into the repository's file.
- A team that uses `team` should upgrade everyone's toil before relying on it.

## Decisions for the maintainer

1. **A new tab.** A Charts tab, since folded into the Summary by the maintainer (working name; "Insights" is taken by the per-item flags
   shown as "Worth a look"), or only richer Summary, Board and People views?
2. **People.** Splits by person a step in, in name order and never ranked, as the People
   view is today?
3. **Saved views.** Kept in the toil project, so the team shares them, or per person?
4. **Several values.** Count an item in each of its components or fix versions (with the
   note), or split it fractionally so totals add up?
5. **Release forecasts.** Show a range from recent throughput, labelled as a forecast, or
   no forecast at all?
6. **Notable changes.** Which thresholds count as notable (a share moving 10 points, scope
   up 10%), and should Toil UI raise them on the Summary or only inside the charts?
7. **Around the marks.** Is four, plus Other and None, enough, with small multiples and
   pinning for longer splits? And should **Simple chart marks** be a setting, or should
   forced colours and small segments be the only fallbacks?

Defaults taken while building, each recorded in the decisions file: 1 a Charts tab, since folded into the Summary by the maintainer; 2
people a step in, in name order, never ranked; 3 saved views in the toil project; 4 an
item counts in each of its values, with the note; 5 no forecast; 6 ten share points and
ten percent of scope, raised inside the charts only; 7 four marks plus Other and None, with
Simple chart marks as a setting.

Already settled by the maintainer on 9 November 2026: work insights is an issue of its
own, #567, blocked by #566 and started after it; the person chooses every split
(principle 11 now says so, and the `ship` skill's Screen review checks it); the parent
epic or feature is a dimension at any level; series are told apart by four
colour-and-border marks per theme, drawn from its character, with picture borders in the
decorative themes and simple ones in Plain and Crate; the proposed marks in the table above
are the ones to build; and every mark is a tooltip naming its value in full ("Keep the
lights on (KTLO)").

## Appendix: the accepted marks

The four marks of every theme, as accepted on 9 November 2026: the `frame` (the picture
border, none in Plain and Crate), the simple `style` it falls back to, and the fill,
stroke and detail colours in each scheme. The detail colour paints a frame's second tone
(a rivet's highlight, a rail's ties) and is the stroke again where a frame has only one.
Every stroke reaches 3:1 against its theme's surface and against its own fill, in both
schemes.

| Theme | Mark | frame | style | Light fill | Light stroke | Light detail | Dark fill | Dark stroke | Dark detail |
|---|---|---|---|---|---|---|---|---|---|
| Plain | Solid | none | `solid` | `#dbe9f8` | `#0b5cad` | `#0b5cad` | `#1d3550` | `#8cc4ff` | `#8cc4ff` |
| Plain | Dashed | none | `dashed` | `#fbe3d3` | `#b5470b` | `#b5470b` | `#4a2a17` | `#ffa66b` | `#ffa66b` |
| Plain | Dotted | none | `dotted` | `#d5f0ea` | `#0b7261` | `#0b7261` | `#133b35` | `#5fd6be` | `#5fd6be` |
| Plain | Double | none | `double` | `#e7e2fa` | `#5b45b8` | `#5b45b8` | `#2c2550` | `#b7a8ff` | `#b7a8ff` |
| Crate | Blueprint line | none | `solid` | `#d9e6f7` | `#1b66c4` | `#1b66c4` | `#16304f` | `#8cc4ff` | `#8cc4ff` |
| Crate | Packing tape | none | `dashed` | `#ecdcc0` | `#8a5a2b` | `#8a5a2b` | `#3a2c1d` | `#d9a86c` | `#d9a86c` |
| Crate | Chalk line | none | `dotted` | `#e3e6ea` | `#4a5563` | `#4a5563` | `#262c35` | `#c9d1db` | `#c9d1db` |
| Crate | Pallet straps | none | `double` | `#d4eef0` | `#0f6e76` | `#0f6e76` | `#133638` | `#6fd3dc` | `#6fd3dc` |
| Frontier | Riveted iron plate | `ironplate` | `heavy` | `#d9d6cf` | `#3e3a35` | `#a8a49b` | `#2b2925` | `#c8c2b6` | `#f1ece2` |
| Frontier | Brass steam pipe | `pipe` | `double` | `#f0dfa8` | `#7a5a12` | `#fbf1cf` | `#3d3215` | `#e2b84f` | `#fff0b8` |
| Frontier | Railroad track | `track` | `dashed` | `#f3d2bd` | `#8a3812` | `#5c3a1e` | `#44261a` | `#e88a5c` | `#a87850` |
| Frontier | Lasso rope | `rope` | `dashdot` | `#ece3d0` | `#5c3d14` | `#c9a46a` | `#2e2820` | `#e0c08a` | `#7a5c34` |
| Harvest | Picket fence | `picket` | `solid` | `#e1eec4` | `#4a3a2a` | `#fdf6e3` | `#26331a` | `#f3e4bf` | `#a8916a` |
| Harvest | Wheat sheaves | `wheat` | `dashed` | `#f6e3a6` | `#7a5a00` | `#d9a92a` | `#3d3312` | `#f2c94c` | `#b8902a` |
| Harvest | Cobblestone path | `cobble` | `double` | `#d3e4f2` | `#1f55a8` | `#b7cbe0` | `#18283f` | `#7db4f2` | `#2f4a6e` |
| Harvest | Pumpkin vine | `vine` | `pixel` | `#f9dcc2` | `#2f6b1f` | `#d9620f` | `#45281a` | `#8fd46a` | `#f5a05a` |
| Overworld | Dungeon stone | `stone` | `double` | `#e3e3dc` | `#46564a` | `#c9c9bd` | `#2a302b` | `#bcc7b4` | `#4d5a50` |
| Overworld | Hedge | `hedge` | `solid` | `#cfeedd` | `#1a7a4a` | `#5fbf86` | `#163a28` | `#5cc46e` | `#2f7a48` |
| Overworld | River | `river` | `dashed` | `#d4e2f7` | `#2a56a8` | `#8fb4ea` | `#1a2a45` | `#8db8ff` | `#3f6fb8` |
| Overworld | Treasure trim | `goldtrim` | `pixel` | `#f7e7b3` | `#7a5000` | `#6b3fa0` | `#3a3012` | `#f2c94c` | `#c7a6ff` |
| Realm | Tooled leather | `leather` | `dashed` | `#e3cfb4` | `#6b4423` | `#b08a3a` | `#3b2a1c` | `#d4a06c` | `#c9a24a` |
| Realm | Iron chain | `chain` | `dotted` | `#d6d0c4` | `#2e2a26` | `#2e2a26` | `#2e2924` | `#cfc4b0` | `#cfc4b0` |
| Realm | Knotwork | `knot` | `double` | `#e6d3dd` | `#5e2347` | `#a0628a` | `#3a1f30` | `#d897bf` | `#8a4a6e` |
| Realm | Map neatline | `neatline` | `solid` | `#ece4d2` | `#2b3f52` | `#2b3f52` | `#1f2a35` | `#8fb4d4` | `#8fb4d4` |
| Sprawl | Neon tube | `neon` | `solid` | `#f6d3e5` | `#b80f62` | `#8a879e` | `#3a0a24` | `#ff2e88` | `#8a879e` |
| Sprawl | Circuit trace | `circuit` | `dashed` | `#cdeef3` | `#00667a` | `#00667a` | `#062a33` | `#3ff0ff` | `#3ff0ff` |
| Sprawl | Hazard stripes | `hazard` | `pixel` | `#e9f2c6` | `#14102a` | `#c6e000` | `#24300a` | `#c6ff3d` | `#07060f` |
| Sprawl | Barcode | `barcode` | `double` | `#e2d9f7` | `#6d3fd9` | `#6d3fd9` | `#1e1240` | `#b49cff` | `#b49cff` |
| Starship | HUD frame | `hud` | `solid` | `#cfeaf2` | `#00708f` | `#00708f` | `#06283a` | `#36d6ff` | `#36d6ff` |
| Starship | Hull plating | `plating` | `double` | `#e3e8ef` | `#3d566f` | `#7f9bb9` | `#1c2638` | `#c9d6e6` | `#5a7392` |
| Starship | Hex shield | `hexshield` | `dotted` | `#e3dcf7` | `#5a3fb8` | `#5a3fb8` | `#1e1a40` | `#b3a2ff` | `#b3a2ff` |
| Starship | Star-chart scale | `ruler` | `dashed` | `#f3d6e8` | `#9a2a6e` | `#9a2a6e` | `#3a1430` | `#ff8fd0` | `#ff8fd0` |
