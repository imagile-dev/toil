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

**Still the maintainer's to take**

The proposal's own list, **Decisions for the maintainer**: a Charts tab or richer
existing tabs, people splits a step in, saved views in the toil project or per
person, how a multi-valued field is counted, release forecasts, the thresholds for a
notable change, and how many series marks with the Simple chart marks setting. Each
default taken while building goes in this file.
