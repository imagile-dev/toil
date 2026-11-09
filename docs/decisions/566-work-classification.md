# Work classification: classify, categorize, and the work mix (#566)

The specification is `docs/work-classification-proposal.md`. These are the calls an
agent made where the proposal was silent, or where it couldn't be built as written.

- **A plan is a diff, as far as the input shows.** `toil classify run` puts an item
  in the plan only when something about it would change: the category's label is
  missing, another of the scheme's labels is on it, or the field's value differs or
  wasn't read. An item already as the scheme wants it is left out, and an unsure item
  is never in a plan. Why: a plan is what a person approves, and a list padded with
  no-ops hides the changes. Each `categorize` command still reads the item's live
  state and sends only what still differs, so a second run sends nothing
  (`src/core/classify/types.ts`, `PlanItem`).
- **Each plan entry names the scheme's labels for its tracker, and the reader
  refuses any other label.** An entry carries `labels`, category id to that tracker's
  label, and `readPlanFrom` fails a plan whose `add` or `remove` names a label
  outside it, compared without regard to case. Why: a plan is a file an agent may
  have written by hand, and the one promise a plan makes is that `categorize` touches
  only the scheme's own labels (principle 2). Where: `src/core/classify/plan.ts`.
- **`--from` takes the `classify run` envelope or its `data`, from a file or stdin.**
  A failed envelope is refused. Over MCP there is no stdin, so `from` is required
  there and the error says so.
- **An empty plan succeeds; a plan with nothing for this connection is refused.** A
  plan with no entries returns zero counts and a `CATEGORIZE_NOTHING` warning. A plan
  that holds entries but none for the call's connection is `INVALID_INPUT` naming the
  connections it does hold, since the caller pointed it at the wrong place. Entries
  for other connections are reported in `skipped` with a `CATEGORIZE_SKIPPED`
  warning (principle 3: one command, one connection).
- **No cap on a plan's size; `categorize` declares a longer time limit instead.** A
  backlog is hundreds of items, and a cap would make the caller split a plan by
  hand. Running it twice changes nothing, so a rerun after `TIMEOUT` is safe, and the
  error says the changes sent so far were applied.
- **A plan carries the field by the name the toil project gave it; `categorize`
  resolves it against the tracker.** `classify run` asks no service (principle 3),
  so it can't check a field exists or look up an option's id. `categorize` reads the
  field's definition before any write and refuses the whole plan when the field or
  one of the plan's values is missing.
- **A category already in the tracker's field is read from the item's `native`
  record.** Jira's `fields[<id>]`, Azure DevOps's `fields[<reference name>]`, and
  GitHub's `fieldValues[]` from `project items`. The field's id comes from the toil
  project: `classify.targets.<area>.field` is an alias when the section's `fields`
  has it, otherwise the field's own id. A field the read didn't ask for is unknown,
  and unknown means the plan sets it.
- **When an item's field and its labels disagree, the field wins.** The field was
  set from a fixed list of options, by a person or by an earlier plan; a label is
  free text anyone can add. With no field value, exactly one of the scheme's labels
  settles the item (source `label`). Two different scheme labels on one item settle
  nothing by label, and the item goes on to the rules.
- **An agent's verdicts fill only the items the deterministic pass left unsure.** A
  verdict for an item a label, rule or signal already settled is ignored with a
  warning. Why: the rules are the team's own and checkable; an agent's opinion
  doesn't overrule them. Every id must be an item in the input and every category
  one of the scheme's, or `unsure`.
- **A rule's `when` has four keys: `parent`, `label`, `type`, `title`.** Every key
  given must match, and a key matches when any one of its values does. `parent`
  matches at any depth the input shows; the others compare without regard to case,
  and `title` is a substring. Why: the proposal's examples use `parent` and `label`;
  `type` and `title` cover what teams already sort by, and a larger vocabulary can be
  added later without breaking a scheme.
- **Schemes get their own catalog beside the toil project catalog.** `SchemeCatalog`
  (`src/core/classify/catalog.ts`) reads and writes `~/.toil/classify/`, the
  repository's `.toil/classify/`, and a path beside a toil project, under two new
  bounds, `classify.write` and `classify.replace`, that mirror `projects.write` and
  `projects.replace`. It is handed to config commands as `ctx.manage.schemes`, so no
  area command can reach it.
- **The three `categorize` commands return one shape.** `connection`, `scheme`,
  `field`, `changed`, `unchanged`, `failed`, `skipped` and `counts`
  (`CategorizeResult`), so a caller reads one result for all three trackers
  (principle 10). An area may add fields of its own beside them: GitHub adds
  `labelsCreated` and `notOnProject`.
- **`github issue categorize` never sends a `DELETE`: it adds a label with `POST`
  and, when one of the scheme's other labels must come off, replaces the issue's
  labels with one `PUT`.** The proposal had it remove a label with `DELETE` and be
  refused over MCP by `offMcpWhen`. That can't be built: `offMcpWhen` sees only the
  call's input, never what the plan file or the live issue holds, so it can't tell a
  plan that removes a label from one that doesn't. The `PUT` carries the labels as
  just read, minus the scheme's others, plus the category's label, so the command is
  served over MCP behind the write gate exactly as Jira's and Azure DevOps's are,
  which keeps one behaviour across the three trackers (principle 10). **The cost,
  for the maintainer to weigh:** GitHub has no conditional write for labels, so a
  label someone adds between the read and the `PUT` is lost. The read is made
  immediately before the write, and `PUT` is used only for a reclassification, never
  for a first label.
- **The new commands take no contract entries.** `docs/command-contract.md` lets
  toil add commands, flags and output fields; the contract records what existed
  before. `jira issue label | unlabel` and `ado work-item tag` keep their recorded
  behaviour and are not used by `categorize`.
- **`classify`'s reference page is `skills/toil/classify.md`, listed with the
  general pages.** `classify` is a group of config commands like `projects`, not an
  area, so `test/skills.test.ts`'s `GENERAL` list gains it, the way `projects.md` is
  there.
- **A sample team ships with toil, as OWI.** One seeded, deterministic team (people
  with teams, sprints, releases, components, epics, a KTLO and Feature mix, some
  unsure and some unclassified items, and missing values for the honest buckets) so
  `classify run`, the pivots and every Toil UI screen can be exercised with no
  tracker and no sync. Toil UI's sample mode and its first-run screen both load it.
- **Delivery: local commits on this branch, slice by slice; nothing pushed.** The
  branch still needs `main` merged through the app before a PR (the app's sync was
  off, and the three app-protected files are behind `main`). Splitting the work into
  `kolatts/566-…` and `kolatts/567-…` PRs is the maintainer's call once it is.

**Not verified:** no command here has been run against a real Jira, GitHub or Azure
DevOps. Every request is checked against canned responses shaped from the vendors'
documentation, and each fixture says so.
