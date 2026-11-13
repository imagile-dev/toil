# Work insights from three seats

A companion to `docs/work-insights-proposal.md` (#567) and
`docs/work-classification-proposal.md` (#566). It lists the questions a manager, a scrum
master and a product owner ask about how a team is working, where toil and Toil UI
answer each one, and what each proposal has to build so the answer is a few clicks away.
The screen review at the end of the work walks every question on the sample team
(`docs/sample-team.md`).

"Today" means `main` on 10 November 2026, read from the code. The tabs then are Summary,
Board, What blocks what, Code reviews, People, What happened and Past briefings. This work adds Stand-up after People, and puts the charts in the
Summary's **Where the work goes**. Past briefings became Earlier briefings, a step in
from the Summary.

Two rules hold for every answer:

- **The team is measured, never the person.** A person's breakdown is a step in, in name
  order, with no score and no ranking.
- **Unknown is not zero.** A figure the read never fetched is a dash beside the action
  that reads it.

## The manager

Someone who answers for one or more teams: where the effort goes, whether it is
sustainable, and what to tell the people above.

| # | Question | Today | Gap | Built as |
|---|---|---|---|---|
| M1 | How much of our work keeps the lights on, and how much is new? | Nothing | No category on any item | the Work mix item in Where the work goes; Summary › Work mix; `toil classify mix` |
| M2 | Is that mix changing? | Nothing | No trend by category | Work mix's stacked trend by month, with notable changes worked out by code |
| M3 | Where does the upkeep come from: which component, epic or team? | Nothing | No split by any dimension | Work mix split by component, parent or team; `toil projects pivot --split` |
| M4 | How much of the mix can I trust? | Nothing | No record of what decided each item | Work mix's source line (rules, AI agent, people, unclassified); `toil classify stats` |
| M5 | Are we delivering at a steady pace? | Throughput and cycle-time tiles, six weeks | No split, no longer window | Summary › Flow, split by any dimension |
| M6 | Is work getting stuck? | Work getting old tile; the briefing's stale and blocked lenses | No split by team or category | Summary › Flow, aging by a split |
| M7 | Is anyone carrying too much? | People cards with the work-in-progress limit | No view of what kind of work each person carries | People's mix bar: one bar per card, no score |
| M8 | How many things are we doing at once? | Nothing | No count of streams | Summary › Where we're working: parallel streams per week, share with no epic |
| M9 | How do my teams compare in what they work on? | One card per toil project | No team dimension | A person's `team`; any chart split by team (shares, never a ranking) |
| M10 | What do I tell my own manager? | "Get a briefing"; Past briefings | The briefing knows nothing of mix or releases | Ask about this chart; Copy for AI; the `insights` MCP prompt |

## The scrum master

Someone who runs the team's cadence: the sprint in flight, what is in the way, and
whether the last sprints say anything about the next.

| # | Question | Today | Gap | Built as |
|---|---|---|---|---|
| S1 | Is this sprint on track? | Summary's status sentence; burn-up | None | Unchanged |
| S2 | What was added after the sprint started, and what carried over? | Sprint detail modal, current sprint only | No view across sprints | Summary › Sprints: committed, added, carried and done per sprint |
| S3 | What is our velocity, and how steady is it? | Nothing across sprints | No history of sprints kept on an item | Summary › Sprints, from `sprints[]`; the done figure per sprint with its range |
| S4 | How much of each sprint goes to unplanned work? | "Added mid-sprint" flag per item | No share, no split by category | Summary › Sprints split by category or by planned and unplanned |
| S5 | What is blocked, and for how long? | What blocks what; Needs attention | None | Unchanged; the Board's filter bar narrows it |
| S6 | Where is work waiting: in progress, or in review? | Code reviews' flow medians; cycle-time scatter | No cumulative flow | Summary › Flow: cumulative flow diagram |
| S7 | What is getting old, and whose team is it? | Work getting old tile | No grouping | Summary › Flow, aging by a split; the Board grouped into swimlanes |
| S8 | Is the work in progress over the limit? | People's team strip | None | Unchanged |
| S9 | What happened since yesterday? | Stand-up; What happened | None | the Stand-up tab, with comments and unanswered questions |
| S10 | Which items still need a category before I can report on them? | Nothing | No review queue | The Board's Classify view; the Unsure share on every mix |

## The product owner

Someone who answers for what ships and when: the release, the epics under it, and the
trade between new work and upkeep.

| # | Question | Today | Gap | Built as |
|---|---|---|---|---|
| P1 | Will the release make its date? | Nothing | Fix versions and milestones weren't mapped | Summary › Releases: scope, done, remaining, burn-up toward the date (no forecast) |
| P2 | What was added to the release after it started? | Nothing | No release scope history | Releases: scope added since the start, as a notable change with its items |
| P3 | What is still open in the release, and who has it? | Nothing | No release dimension | Releases' drill to items; the Board filtered by release |
| P4 | How far along is each epic or feature? | Children on the item page only | No rollup by parent | Any chart split by parent; the Board grouped by parent |
| P5 | How much of the release is new capability and how much is upkeep? | Nothing | No category | Releases split by category |
| P6 | Which components take the most upkeep? | Nothing | Components weren't mapped | Work mix split by component |
| P7 | What has no epic above it? | Nothing | No structure check | Where we're working: the share with no epic, with its items |
| P8 | What shipped last month? | What happened, day by day | No monthly rollup by release or epic | Flow's throughput split by release or parent; Explore |
| P9 | What is carried from one release to the next? | Nothing | No release history | Not built: an item holds only its current fix versions, so what moved from one release to the next isn't known |
| P10 | Can I keep this view and send it to someone? | The address holds the tab only | Filters aren't in the address; no saved view | The filter bar in the address; Save this view (`toil projects view set`) |

## What the lists add to the proposals

Most gaps were already in the proposals. Reading them from the three seats added these,
and each is folded into the insights proposal where it is built:

- **Velocity across sprints (S3).** The Sprints dashboard shows the done figure per sprint
  and its range over the sprints read, not only the four counts.
- **Planned and unplanned as a split (S4).** "Planned or unplanned" is already a derived
  dimension; the Sprints dashboard offers it as a split beside category and team.
- **Parallel streams and work with no epic (M8, P7)** are headline figures of Where we're
  working, each a door to its items.
- **How much of the mix to trust (M4).** Every mix shows the share decided by rules, by
  the AI agent and by people, and the unclassified share, beside the chart and not behind
  a tooltip.
- **The review queue as a count (S10).** The Work mix item in Where the work goes names the unsure
  share, and it opens the Classify view when pressed from there.
- **The sample team exercises all thirty.** `docs/sample-team.md` lists which items make
  each question answerable.

## What stays out

- **A score or ranking for a person or a team.** No seat's question needs one, and a
  published target invites relabelling work to meet it.
- **Forecast dates stated as fact.** A release forecast is a range from recent
  throughput, labelled a forecast with its method.
- **Capitalization.** Finance owns the method; it is deferred in #566.

## The screen review

Done on 10 November 2026 on the sample team (the clock pinned at 13 October 2026) by
the AI agents that built the screens, not by a person. Each building agent read its own
screenshots at 1440 and 375 px in Plain and one decorative theme, and the lead agent
then opened the Summary, the Charts list, all six dashboards, the Board's Classify view
with its review card, and the Classification editor in a browser at 1440 px, Work mix
at 375 px and Sprints at 768 px. The layout check covered every route in every theme at
375, 768 and 1440 px with no problems. What was opened and what each seat could read:

| Screen | Seat questions it answered | What was fixed after looking |
|---|---|---|
| Summary, with the Work mix tile | M1 | nothing |
| Charts list | M1, M5, M8, P1, S3 as headlines | nothing |
| Work mix | M1 to M4, P6 by a split | a heavy focus box on the heading; ISO dates in the notes |
| Releases | P1 to P3, P5 | a crash on a release with no day gone yet; the scope line had no legend entry; the due date had no marker |
| Sprints | S2 to S4, M5 | nothing |
| Where we're working | M8, P4, P7 | truncated row labels; the mixes had no legend |
| Flow | M5, M6, S6, S7, P8 | the 85th-percentile tick floated free of its bar |
| Explore | P8, P10, and any other by hand | the chart menu overlapped the Split by menu |
| Board, grouped and filtered | S5, S7, P3, P4 | controls stacked in three rows; an uncaptioned mix bar |
| People | M7, M9 | the mix bar had no key; counts are shown, never a share |
| Sort work into categories | S10 | the Apply bar dominated the page; an ISO date in the intro |

Since then the Charts list and the Work mix tile went into the Summary (`docs/decisions/567-work-insights.md`).

Not answerable on a screen: P9, what is carried from one release to the next, since an
item holds only its current fix versions.

Not looked at by anyone: every decorative theme on every screen. The layout check
covers them at three widths; the agents opened Plain, Realm, Frontier and Harvest. The maintainer reviewed the screens afterwards; what changed is in
`docs/decisions/567-work-insights.md`. Three
frames read weakly at chart size and are for the maintainer to judge: Harvest's wheat,
Realm's map neatline and Sprawl's barcode.
