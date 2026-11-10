# Work insights: dimensions in the data (#567)

Decisions an agent took by default while building the first slice of
`docs/work-insights-proposal.md`, Layer 1: the fields a split needs, in Open Work
Items and in the toil project. The maintainer may overturn any of them.

**Not verified:** this slice passes typecheck, lint and the unit suite, and has had
no independent review yet. Nothing here has met a real Jira, GitHub or Azure DevOps.

- **The new Open Work Items fields are optional properties of version 0.2, with no
  version bump.** They are `releases`, `affects`, `components`, `area`, `sprints`,
  `dims` and `ancestors`. Why: every one is additive, and Toil UI's tests build records
  typed `owi: '0.2'`. Where: `src/core/owi/types.ts`, `docs/owi/spec.md`,
  `docs/owi/schema.json`.
- **A field that was not read is absent; a field that was read and is empty is `[]` or
  `null`.** Why: unknown is not zero, so a split can tell "No fix version" from "never
  asked". Where: each mapper in `src/core/owi/`.
- **A release is `{ id, name, released, date }`.** `date` is a day (`YYYY-MM-DD`) and
  `released` is `true`, `false` or `null`. A GitHub milestone is released when it is
  closed, and its `date` is the day of `due_on`. `affects` has the same shape.
  `components` holds names only, and every value of `dims` is a list of strings.
- **Each tracker fills the fields from its own source.** Jira reads `fixVersions`,
  `versions`, `components` and every value of the Sprint field. Azure DevOps reads
  `System.AreaPath`, takes releases and affected versions only from a `release` or
  `affects` field pointer, and derives `sprints` from an attached history. GitHub
  reads `milestone` and derives `sprints` from the milestone events of an attached
  issue history. Jira and GitHub ignore the `release` and `affects` pointers, since
  each has its own source. An `unmapped` note is added only when a pointer named a
  field the record lacks, never for a field nobody asked for.
- **Known gap: on Azure DevOps a pointer whose field is missing reads as `[]` plus an
  `unmapped` note.** Azure DevOps omits empty fields, so toil can't tell empty from
  never asked, and the note says so.
- **`ancestors` is the chain among the mapped records, nearest first.** It is `[]`
  when there is no parent or the parent isn't in the input, stops at a cycle or after
  50 levels, and is present only where the parent was read.
- **Known gap: Jira's parent-was-read test is a heuristic.** Jira omits an absent
  parent, so a mapper treats the parent as read when `parent` or the Epic Link is
  present, or when `subtasks` or `issuelinks` is in the record. A read narrowed to
  `issuelinks` alone could say "no parent" wrongly.
- **Known gap: an Azure DevOps item with no relations at all gets no `ancestors`.**
  Azure DevOps omits an empty `relations` array, so a lone top-level item reads as
  unknown rather than as having no parent.
- **`release` and `affects` are overridable field pointers.** `OVERRIDABLE` gained
  both, and so did `OWI_KEYS` in `src/core/field-discovery.ts`, so a toil project's
  `fields` section can point at them like the other pointers.
- **The dimension map reaches a mapper as `MapOptions.dimensions`, the way
  `MapOptions.fields` does.** It is checked by `dimensionMap()` in
  `src/core/owi/dimensions.ts`, and `mapOwi` in `src/api.ts` takes it as an added
  option. No mapper reads a toil project.
- **A toil project may carry a top-level `dimensions` key.** It maps dimension name to
  area to field (`"customer": { "jira": "customfield_10500", "ado": "Custom.Customer"
  }`) and is kept on every rewrite. It refuses `fields`, `connection`, `host`,
  `transitions` and `writes` as dimension names, holds names to a pattern, and refuses
  a value shaped like a credential or spanning lines. An area toil doesn't have is a
  warning. Where: `src/core/toil-project.ts`.
- **A person in a toil project may carry a `team`.** It is one line of at most 100
  characters, refused when shaped like a credential. `toil projects person --team
  <name>` sets it, needs `--replace` to change one already set, and treats the same
  name in another case as the same team, keeping it as first written. Where:
  `src/projects/build.ts`.
- **Review findings on the first slice, all fixed.** An item in a sprint whose history
  held no sprint change read as `sprints: []`; the current iteration is now always in
  `sprints`. An Azure DevOps root iteration path is not a sprint. A Jira sprint value,
  a GitHub board field or an Azure DevOps field that could not be read leaves its key
  absent with an `unmapped` note, never `[]`, which closes the gap recorded above for
  Azure DevOps. A `release` or `affects` pointer on Jira or GitHub gets a note saying
  it was not used. Where: `src/core/owi/`.
- **The insights model is one contract file and pure functions.**
  `src/core/insights/types.ts` fixes the dimension grammar (`release`, `parent:Epic`,
  `label:area/`, `resolved:month`, `dim:customer`), seven measures, and a pivot result
  that carries the item ids behind every cell. An item whose dimension was never read
  goes in no bucket and is counted in coverage; one that was read and has none goes in
  a named "none" bucket. `asOf` is always passed in. Toil UI imports it from source.
- **An item counts once in each value of a multi-valued dimension.** The proposal's
  decision 4, taken as the simpler option: totals count an item once, and coverage says
  that rows may add up to more than the total.
- **Four values, then Other; ordered axes keep their order.** Rows and columns show the
  four largest values (pins first) and fold the rest. Time, categories and derived
  buckets never fold. Releases and sprints read in date order and keep the latest four.
- **Notable changes: ten share points, ten percent more scope.** The proposal's
  decision 6. A share that moves ten points between the last two complete periods, a
  release whose scope grew ten percent after its start date, and the row that grew
  fastest are worked out by code. A release with no start date gets no scope figure: it
  is unknown, not zero. `Release` gained an optional `start` for this, read from a Jira
  version's `startDate`.
- **A filter can't judge an item whose dimension was never read.** The item fails `=`
  and passes `!=`, and a coverage note says how many.
- **Days in progress use the current assignee.** An item's history keeps no assignee
  changes, so each person-day goes to whoever holds the item now. Known gap.
- **Saved views live in the toil project, and a bad one stops the file loading.** The
  proposal's decision 3, taken as "the team shares them". `views` is an object keyed by
  name, at most 50. A view that fails validation is an error by key path, not a
  warning: a warning would let the next rewrite of the file drop the view silently.
  `view set` is served over MCP, since a view holds no host, connection or secret;
  `view remove` is CLI only. `--where` on `projects pivot --view` replaces the view's
  filters.
- **`projects pivot` classifies as it counts.** It runs the classification engine over
  the input with the toil project's scheme and the ledger's standing corrections, so
  `--split category` needs no earlier `classify run`. Every item is then either settled
  or unsure; none is unread.
- **The value lists return the service's own records.** `jira version list` and
  `jira component list` (Data Center and Cloud) return Jira's arrays and page locally,
  since Jira sends each list whole; `github milestone list` pages like `issue list`;
  `ado work-item areas` is served on Services with Server's wording. `util owi map
  --dimension <name>=<area>:<field>` is the CLI's way to the dimension map. None has
  met a real server.


**Still the maintainer's to take**

The proposal's own list, **Decisions for the maintainer**: a Charts tab or richer
existing tabs, people splits a step in, saved views in the toil project or per
person, how a multi-valued field is counted, release forecasts, the thresholds for a
notable change, and how many series marks with the Simple chart marks setting. Each
default taken while building goes in this file.
