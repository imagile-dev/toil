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
- **Each plan entry names the labels it may touch, and the reader refuses any
  other.** An entry carries `labels`, category id to that tracker's label, and
  `readPlanFrom` fails a plan whose `add` or `remove` names a label outside its own
  entry's map, compared without regard to case. Why: a person approving a plan then
  reads one list per tracker, and no item can touch a label that list doesn't name.
  This is not a check against the scheme. `toil classify run` builds the map from the
  scheme, but a plan is the caller's write input, like the arguments to
  `jira issue edit`, and the write gate decides whether it is applied (principle 2).
  A review found the earlier wording promised that `categorize` touches only the
  scheme's own labels; it can't keep that, because an area command never sees the
  scheme catalog (`ctx.manage.schemes` is withheld from it). The promise was reworded
  rather than the catalog opened. Where: `src/core/classify/plan.ts`.
- **A key repeated within one plan entry is refused.** Jira and GitHub keys are
  compared without regard to case, Azure DevOps ids as numbers, so `007` is `7`. Why:
  two items for one issue put two of the scheme's labels on it and counted it twice
  (a review finding). Where: `itemKey` in `src/core/classify/plan.ts`.
- **A toil project nobody adopted can't choose what `categorize` writes.**
  `classify run` puts a field target in the plan only when no toil project applied or
  the one that did is in the user's own folder. Otherwise the field is still read to
  find a category, the targets are left out of the plan, and
  `CLASSIFY_TARGETS_NOT_ADOPTED` names `toil projects import <name>`. Why: a write
  takes its target only from sources the user owns (principle 2), and `guardTargets`
  never sees a target that arrives inside a plan file. Where: `src/classify/run.ts`.
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

## Raw notes, still to be written up as entries

These are defaults the agents took while building slice 1, noted at a session
hand-off on 2026-11-10 so they travel with the branch. Each is in the code and
pinned by a test; none has been written as a proper entry yet. Before a PR opens,
turn each into an entry above (what, why, where) or drop it as too small to record,
and delete this section.

**Commands**

- `projects classify set <toil-project> [--scheme <name|./file.json>] [--target
  <area>.<key>=<value>]… [--clear <scheme|jira|github|ado>]… [--replace]`, modelled on
  `projects analyze set`, `offMcpWhen` for `--clear` included. `--target` keys:
  `<area>.field=<alias or id>`, `github.project=<owner>/<number>`,
  `<area>.value.<categoryId>=<option>`.
- `classify scheme set` and `import` are a person's commands (`cli-only`, and in
  `PERSON_COMMANDS` in `src/api.ts`). `init`, `export`, `list`, `show` and
  `projects classify set` are ordinary config commands and stay on MCP.
- `--scheme` takes a name or a file: a value ending `.json` or holding a path
  separator is a file (source `file`); anything else is a name, looked up user, then
  repo, then built-in. A toil project's `classify.scheme` starting `./` or `../`, or
  ending `.json`, is relative to the toil project file (source `toil-project`).
- `projects classify set` gets the retired `dossiers …` path like every other
  `projects` command but `migrate` (pinned in `src/classify/scheme-commands.test.ts`).
  The cost: `toil dossiers classify set` answers, with `TOIL_PROJECT_DEPRECATED_NAME`,
  though it never existed under that name. `projects pivot` and `projects view` will
  get one too unless the maintainer says otherwise.
- `src/core/classify/` and `src/classify/` are on the safety-layer list in
  `scripts/triage/changes.mjs`. It is the one `scripts/` edit, and it makes triage
  stricter.
- `skills/toil/SKILL.md` was shortened in nine places to fit its 4096-byte cap; it is
  exactly 4096 bytes now, so any addition needs a removal.
- `classify.md` has its own site page, `/docs/classify/` ("Work categories" in the
  Use group, after Toil projects), with the classify command index. The trackers'
  `categorize` commands stay on their areas' pages.
- `classify run --record` is left to the ledger slice.

**Scheme validation**

- `name` matches `SCHEME_NAME`; `revision` is a positive whole number, 1 when absent;
  2 to 12 categories with unique ids matching `CATEGORY_ID`, never `unsure`; `short`
  1 to 24 characters, `name` 1 to 60, `definition` 1 to 600; `label` matches
  `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$/` and is unique ignoring case.
- `guidance` at most 20 lines of 300 characters; `examples` at most 40; `rules` at
  most 100, each with an id matching `/^[a-z][a-z0-9-]{0,40}$/`, a `when` with at
  least one of the four keys (each a non-empty list of at most 50), and a `then` that
  is a category id. An unknown `when` key is an error.
- `signals` defaults to true. `labels` takes only `jira`, `github`, `ado`, with
  category ids inside, unique per tracker ignoring case.
- An unknown top-level key is ignored with `SCHEME_UNKNOWN_KEY`; `$schema` is allowed.
  No credential-shaped text (`findSecrets`), no control characters, one line each.

**Built-in schemes**

- `ktlo-feature`, revision 1: `ktlo` (short `KTLO`, name `Keep the lights on`, label
  `ktlo`) and `feature` (label `feature`), with the proposal's definitions and one
  guidance line on upgrades.
- `balance`, revision 1: `new` ("New capabilities"), `improve` ("Improvements"),
  `ktlo`, `productivity`.
- The built-in signals point at the category whose id is `ktlo`: `signal:type` (bug,
  incident), `signal:security-id`, `signal:incident-link`, `signal:bot-author` (the
  reporter only), `signal:label` (`security`, `dependencies`, `compliance`,
  `incident`, `hotfix`), `signal:title` (opens with the whole word Bump, Upgrade or
  Patch).

**The engine and the prompt**

- The parent step runs again after agent verdicts. An item that appears twice is
  classified once, with `CLASSIFY_DUPLICATE_ITEM`.
- One `CLASSIFY_VERDICT_IGNORED` warning covers every ignored verdict.
  `CLASSIFY_NO_WRITE_BACK` names only areas outside jira, github and ado that have a
  settled item.
- `labels.remove` is spelled as the item spells it. `settledByRules` is rounded to
  three places. `byCategory` includes zeros and `unsure`.
- Reasons: a parent verdict uses the category's `name`; a field verdict names
  `target.field`; a rule's reason joins its keys with "and". A rule with no keys
  matches nothing. A rule whose `then` names an unknown category is skipped with one
  `CLASSIFY_RULE_UNKNOWN_CATEGORY` warning.
- GHSA ids are matched with the advisory alphabet (`23456789cfghjmpqrvwx`), ignoring
  case.
- The prompt's fence is one backtick longer than any run inside the data (three at
  least), with the info string `untrusted-data`. Titles, labels and bodies are
  flattened to one line; a body that isn't text keeps only its `text` leaves; an
  excerpt is 600 characters; 200 items at most by default, with the omitted count
  stated.

**`classify run` and `classify prompt`**

- `complete()` fills the record fields a caller omitted as empty, because
  `EXAMPLE_BRIEF_RECORDS` leaves several out.
- A toil project named on the call or in `TOIL_PROJECT` that doesn't exist is an
  error; with no toil project catalog it is `NOT_CONFIGURED`. With none, the built-in
  scheme or `--scheme` applies, there are no targets, and `toilProject` is `null`.
  Several candidates is an error.
- A target's field id is `toilProject.sections[area]?.fields?.[target.field] ??
  target.field`.
- `--verdicts <file>` reads through `ctx.files`; `-` is refused. `readVerdicts` is
  strict: an unknown id, an unknown category, a repeat, a non-array, or more than
  5000 is `INVALID_INPUT`.
- `CLASSIFY_SKIPPED` for records that aren't work items; zero items is
  `INVALID_INPUT`. `classify prompt` keeps the input's order and warns
  `CLASSIFY_NOTHING_UNSURE`. The MCP prompt's description is "Classify N unsure work
  items into the scheme X".
- The workflow page's inputs are backlog, scheme and connection. It tells the agent
  to add `toil github project items <number> --owner <owner>` when the category lives
  in a project field, hands the plan over with `--summary-file plan.json`, and says
  tuning comes in a later release. Toil UI has no `classify` face until the UI slice.

**The scheme catalog**

- A broken scheme file is `CONFIG_INVALID` ("Scheme <file> can't be used: <path>:
  <message>", up to five problems in `details`). A value that is neither a scheme
  name nor a file is `INVALID_INPUT`; an unknown name is `NOT_FOUND`.
- A file found by name whose `name` differs from its file name is an error. A broken
  file is an error in `resolve`, with no fall-through to the next folder, and `list`
  counts its name as taken (`SCHEME_INVALID`).
- `resolve` takes an optional `cwd`. A repo `.toil/classify` that is the user folder
  isn't counted twice.
- Under `~/.toil` a scheme may name only `classify/` and, for a path from a toil
  project, that toil project's own folder. The `--config` file is always off limits.
- Scheme files are capped at 256 KiB (`MAX_SCHEME_BYTES`). A duplicate JSON key is a
  `SCHEME_DUPLICATE_KEY` warning. A link out of a scheme folder is skipped with
  `SCHEME_PATH_INVALID`.
- `set` takes no toil project input, bumps the revision by one, writes where the
  scheme lives, and writes a user copy for a built-in. An unchanged file writes
  nothing and warns `SCHEME_UNCHANGED`. Writes are a temp file, then a rename; the
  user folder is `0o700` and its files `0o600`. In a scheme folder the file must be
  `<name>.json`.
- `projects classify set` resolves the scheme after setting it and warns
  `CLASSIFY_SCHEME_UNRESOLVED`, but still sets it. `--clear` removes the whole
  `classify` key when nothing is left. A scheme path in a toil project must end
  `.json` and be relative; text in `classify` is capped at 200 characters; the key
  refuses `connection`, `host`, `fields`, `transitions` and `writes` inside it.
- `init` and `export` accept `--cwd`.

**`jira issue categorize`**

- JQL quotes and escapes keys. Search is one page of up to 100 keys; keys a
  successful search omitted are read one at a time, and a search answered 400 falls
  back to reading each issue.
- A group with no items returns early with no requests, and `field` has no `id`.
- `editmeta` is used where the proposal said `createmeta`, and is fetched only for
  the first issue of each project and type among the items that carry a field value.
- `changed[].field.value` is the matched option's own text. A live value equal to
  either the plan's value or the matched option's text counts as equal.
- **Known gap:** a plain string sent to a multi-line text field on Cloud v3 needs
  ADF. The `PUT` fails and is recorded as that item's failure.

**`ado work-item categorize`**

- Both deployments use api-version 7.1, on collection-level routes (`collectionOf`
  in `src/areas/ado/server/client.ts`).
- For a dotted reference name, a batch read answered 400 probes
  `GET _apis/wit/fields/<ref>` and turns a 404 into "field not found".
- An item whose read lacks `System.TeamProject` or `System.WorkItemType` is treated
  as not carrying the field. A group with no items sends nothing.
- The field's allowed values come from each work item type's own definition, where
  the proposal said the process lists API.
- The patch starts with a `test` of the revision read. A conflict is a 409, a 412,
  or a 400 naming the test operation or `/rev`; the item is read again and tried
  once more, and a second refusal is that item's failure, with Azure DevOps's own
  message (a review finding narrowed the match from any mention of `rev`).

**`github issue categorize`**

- A second example sets `owner` and `repo`, for the parity suite. The command
  removes `owner` and `repo` from `ctx.resolved.inputs`, so `meta.context` doesn't
  report values it never used.
- The item query uses the field's real name from the project's own field list. Each
  item's project item is read before its labels are written: read all, then write.
- When an item's labels were written and its field step fails, the reason ends
  "(its labels were changed; the field was not)".
- Keys are matched against `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*`; an owner
  or repo of `.` or `..` is refused.
- Option matching inside `setProjectField` keeps `project status`'s compare (ignores
  case, doesn't trim); the check before any write uses `sameValue`.
- A GraphQL `INSUFFICIENT_SCOPES` stops the whole call.

**Shared by the three (`src/core/classify/apply.ts`)**

- `labelsAfter` drops by exact string. `failureReason` rethrows an `AUTH` error
  whenever `details.status` isn't 403, no status included: a 401, a network failure
  and a cancel stop the call; a 403, a 404 and any other HTTP error are that item's
  failure.
- `CATEGORIZE_FAILED` takes its count from `counts.planned`.
- The field is looked up only when some item in the group carries a field value, so
  a plan that changes labels alone needs no field (a review finding).
- All three take the connection name from `ctx.connection.name`, report the
  tracker's own option text in `changed[].field.value`, and word a type through
  `typeLabel(project, type)`: project first, "unknown type" when the type is empty
  (review findings).
- An error that stops a call halfway carries the counts so far in
  `details.categorize`, and its message ends "N of M items were changed before
  this." Nothing is added when no item had been processed (a review finding).

**Not done**

- The sample team this file promises above is decided, not built.
- The `566` slices still to build: the ledger (`--record`, `classify stats`, `tune`,
  `backtest`, `classify mix`) and everything in Toil UI.
