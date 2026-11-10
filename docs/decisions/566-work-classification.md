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
- **`projects classify set` is modelled on `projects analyze set`.** The call is
  `projects classify set <toil-project> [--scheme <name|./file.json>] [--target
  <area>.<key>=<value>]… [--clear <scheme|jira|github|ado>]… [--replace]`, and `--clear`
  is refused over MCP by `offMcpWhen`, as it is there. The `--target` keys are
  `<area>.field=<alias or id>`, `github.project=<owner>/<number>` and
  `<area>.value.<categoryId>=<option>`. After setting a scheme it resolves it and warns
  `CLASSIFY_SCHEME_UNRESOLVED` if it can't, but still sets it. `--clear` removes the
  whole `classify` key when nothing is left. In the toil project file a scheme path
  must be relative and end `.json`, text in `classify` is capped at 200 characters,
  and the key refuses `connection`, `host`, `fields`, `transitions` and `writes`
  inside it, so it can't select a connection or turn writes on (`src/projects/`,
  `src/core/toil-project.ts`).
- **`classify scheme set` and `import` are a person's commands; the rest stay on
  MCP.** The two are `cli-only` and listed in `PERSON_COMMANDS` in `src/api.ts`.
  `init`, `export`, `list`, `show` and `projects classify set` are ordinary config
  commands and are served over MCP.
- **`--scheme` takes a name or a file.** A value ending `.json` or holding a path
  separator is a file (source `file`); anything else is a name, looked up in the user
  folder, then the repository's, then the built-ins. A toil project's
  `classify.scheme` that starts `./` or `../`, or ends `.json`, is relative to the toil
  project file (source `toil-project`). A value that is neither a name nor a file is
  `INVALID_INPUT`; an unknown name is `NOT_FOUND`.
- **`projects classify set` gets the retired `dossiers …` path, as every `projects`
  command but `migrate` does.** The cost: `toil dossiers classify set` answers with
  `TOIL_PROJECT_DEPRECATED_NAME`, though it never existed under that name. `projects
  pivot` and `projects view` will get one too unless the maintainer says otherwise.
  Pinned in `src/classify/scheme-commands.test.ts`.
- **`src/core/classify/` and `src/classify/` are on the safety-layer list in
  `scripts/triage/changes.mjs`.** It is the one `scripts/` edit, and it makes triage
  stricter: a triage PR touching them is listed at the top of the draft PR.
- **`skills/toil/SKILL.md` was shortened in nine places to fit its 4096-byte cap.** It
  is exactly 4096 bytes now, so any addition needs a removal.
- **`classify.md` has its own site page, `/docs/classify/` ("Work categories").** It
  sits in the Use group after Toil projects and carries the classify command index.
  The trackers' `categorize` commands stay on their areas' pages.
- **A scheme file is validated against fixed limits.** `name` matches `SCHEME_NAME`;
  `revision` is a positive whole number, 1 when absent; there are 2 to 12 categories
  with unique ids matching `CATEGORY_ID`, never `unsure`; `short` is 1 to 24
  characters, `name` 1 to 60, `definition` 1 to 600; `label` matches
  `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$/` and is unique ignoring case. `guidance` is at
  most 20 lines of 300 characters, `examples` at most 40, and `rules` at most 100,
  each with an id matching `/^[a-z][a-z0-9-]{0,40}$/`, a `when` with at least one of
  the four keys (each a non-empty list of at most 50) and a `then` that is a category
  id. An unknown `when` key is an error. Where: `src/core/classify/scheme.ts`.
- **A scheme file is also checked for what it may carry.** `signals` defaults to true.
  `labels` takes only `jira`, `github` and `ado`, with category ids inside, unique per
  tracker ignoring case. An unknown top-level key is ignored with `SCHEME_UNKNOWN_KEY`
  (`$schema` is allowed). Text shaped like a credential (`findSecrets`) and control
  characters are refused, and each value is one line.
- **Two schemes are built in: `ktlo-feature` and `balance`, both revision 1.**
  `ktlo-feature` has `ktlo` (short `KTLO`, name `Keep the lights on`, label `ktlo`) and
  `feature` (label `feature`), with the proposal's definitions and one guidance line
  on upgrades. `balance` has `new` ("New capabilities"), `improve` ("Improvements"),
  `ktlo` and `productivity`.
- **The built-in signals all point at the category whose id is `ktlo`.** They are
  `signal:type` (bug, incident), `signal:security-id`, `signal:incident-link`,
  `signal:bot-author` (the reporter only), `signal:label` (`security`, `dependencies`,
  `compliance`, `incident`, `hotfix`) and `signal:title` (opens with the whole word
  Bump, Upgrade or Patch).
- **The parent step runs again after agent verdicts, and an item that appears twice is
  classified once.** The second appearance gets `CLASSIFY_DUPLICATE_ITEM`. Where:
  `src/core/classify/`.
- **The engine's warnings are few and grouped.** One `CLASSIFY_VERDICT_IGNORED` covers
  every ignored verdict. `CLASSIFY_NO_WRITE_BACK` names only areas outside jira,
  github and ado that have a settled item. A rule with no keys matches nothing, and a
  rule whose `then` names an unknown category is skipped with one
  `CLASSIFY_RULE_UNKNOWN_CATEGORY` warning, not one per item.
- **The prompt treats the work items as untrusted data.** Its fence is one backtick
  longer than any run inside the data (three at least), with the info string
  `untrusted-data`. Titles, labels and bodies are flattened to one line; a body that
  isn't text keeps only its `text` leaves; an excerpt is 600 characters; at most 200
  items go in by default, with the omitted count stated. Where: `src/core/classify/`.
- **`classify run` finds its toil project, or none.** A toil project named on the call
  or in `TOIL_PROJECT` that doesn't exist is an error, and with no toil project
  catalog it is `NOT_CONFIGURED`. With none, the built-in scheme or `--scheme` applies,
  there are no targets and `toilProject` is `null`. Several candidates is an error
  rather than a guess. A target's field id is
  `toilProject.sections[area]?.fields?.[target.field] ?? target.field`. Where:
  `src/classify/run.ts`.
- **`--verdicts <file>` is read strictly, through `ctx.files`.** `-` is refused. An
  unknown id, an unknown category, a repeat, a non-array, or more than 5000 verdicts
  is `INVALID_INPUT`.
- **Input that isn't a work item is skipped, and no items at all is an error.**
  Records that aren't work items get `CLASSIFY_SKIPPED`; zero items is
  `INVALID_INPUT`. `classify prompt` keeps the input's order and warns
  `CLASSIFY_NOTHING_UNSURE` when there is nothing to ask. The MCP prompt's description
  is "Classify N unsure work items into the scheme X".
- **The workflow page takes backlog, scheme and connection as its inputs.** It tells
  the agent to add `toil github project items <number> --owner <owner>` when the
  category lives in a project field, hands the plan over with `--summary-file
  plan.json`, and says tuning comes in a later release. Toil UI has no `classify`
  face until the UI slice.
- **A broken scheme file is `CONFIG_INVALID`, and `resolve` doesn't fall through.** The
  message is "Scheme <file> can't be used: <path>: <message>", with up to five
  problems in `details`. A file found by name whose `name` differs from its file name
  is an error too. A broken file stops `resolve`, and the next folder's scheme of that
  name does not win; `list` counts its name as taken (`SCHEME_INVALID`). Where: `src/core/classify/catalog.ts`.
- **A scheme file is held to bounds.** Files are capped at 256 KiB
  (`MAX_SCHEME_BYTES`). Under `~/.toil` a scheme may name only `classify/` and, for a
  path from a toil project, that toil project's own folder; the `--config` file is
  always off limits. A link out of a scheme folder is skipped with
  `SCHEME_PATH_INVALID`. A duplicate JSON key is a `SCHEME_DUPLICATE_KEY` warning.
  `resolve` takes an optional `cwd`, and a repository `.toil/classify` that is the
  user folder isn't counted twice. Why: the same rule the file service keeps for
  toil's own config and credentials (**Bounds**).
- **`classify scheme set` takes no toil project input and edits in place.** It bumps
  the revision by one, writes where the scheme lives, and writes a user copy for a
  built-in. An unchanged file writes nothing and warns `SCHEME_UNCHANGED`. A write is a
  temp file then a rename; the user folder is `0o700` and its files `0o600`. In a
  scheme folder the file must be `<name>.json`. `init` and `export` accept `--cwd`.
- **`jira issue categorize` searches one page of keys and falls back to reading
  issues.** The JQL quotes and escapes the keys. A search returns one page of up to
  100 keys; keys a successful search omitted are read one at a time, and a search
  answered 400 falls back to reading each issue. A group with no items returns early
  with no requests, and its `field` has no `id`.
- **`jira issue categorize` reads `editmeta` where the proposal said `createmeta`.**
  It is fetched only for the first issue of each project and type among the items that
  carry a field value. `changed[].field.value` is the matched option's own text, and a
  live value equal to either the plan's value or that text counts as equal, so a
  second run sends nothing.
- **Known gap: a plain string sent to a multi-line text field on Jira Cloud v3 needs
  ADF.** The `PUT` fails and is recorded as that item's failure.
- **`ado work-item categorize` uses api-version 7.1 on collection-level routes, on
  both deployments.** Where: `collectionOf` in `src/areas/ado/server/client.ts`. For a
  dotted reference name, a batch read answered 400 probes `GET _apis/wit/fields/<ref>`
  and turns a 404 into "field not found".
- **`ado work-item categorize` takes a field's allowed values from each work item
  type's own definition, where the proposal said the process lists API.** An item
  whose read lacks `System.TeamProject` or `System.WorkItemType` is treated as not
  carrying the field. A group with no items sends nothing.
- **`ado work-item categorize` guards each patch with the revision it read.** The
  patch starts with a `test` of that revision. A conflict is a 409, a 412, or a 400
  naming the test operation or `/rev`; the item is read again and tried once more, and
  a second refusal is that item's failure, with Azure DevOps's own message. A review
  finding narrowed the match from any mention of `rev`.
- **`github issue categorize` reads everything, then writes.** The item query uses the
  field's real name from the project's own field list, and each item's project item is
  read before its labels are written. When an item's labels were written and its field
  step fails, the reason ends "(its labels were changed; the field was not)". The
  command removes `owner` and `repo` from `ctx.resolved.inputs`, so `meta.context`
  doesn't report values it never used. Where: `src/areas/github/`.
- **`github issue categorize` validates its keys and stops on a missing scope.** Keys
  match `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*`, and an owner or repo of `.` or
  `..` is refused. A GraphQL `INSUFFICIENT_SCOPES` stops the whole call. Option matching inside `setProjectField` keeps `project status`'s compare
  (ignores case, doesn't trim); the check before any write uses `sameValue`.
- **Shared by the three: which errors stop a call.** `failureReason`
  (`src/core/classify/apply.ts`) rethrows an `AUTH` error whenever `details.status`
  isn't 403, no status included: a 401, a network failure and a cancel stop the call,
  while a 403, a 404 and any other HTTP error are that item's failure.
- **Shared by the three: the field is looked up only when a group needs it.** It is
  read only when some item in the group carries a field value, so a plan that changes
  labels alone needs no field (a review finding).
- **Shared by the three: an error that stops a call halfway says how far it got.** It
  carries the counts so far in `details.categorize`, and its message ends "N of M items
  were changed before this." Nothing is added when no item had been processed (a
  review finding). Because the calls are idempotent, the caller can rerun.
- **The ledger is reached only through `ctx.manage.ledger`, and is a documented
  exception to the bound on toil's own files.** `~/.toil/classify/<scheme>.jsonl` sits
  where `ctx.files` refuses to read, so a `Ledger` class beside the scheme catalog owns
  it: one append per write, the folder `0o700` and the file `0o600`, a file over 32 MiB
  refused with a fix, and every title and reason cut to 300 characters, stripped of
  control, bidi-override and zero-width characters, and replaced by `[redacted]` when
  it is shaped like a credential. No area command can reach it. Where:
  `src/core/classify/ledger.ts`, `docs/bounds.md` (`classify.ledger`).
- **`classify stats --backtest`, not a `classify backtest` command.** The proposal's
  shape is kept: the backtest is the stats scored twice. It takes the agent's answers
  (`--backtest <file>`), the revised scheme (`--revised <file>`) and, when passed, the
  items, so the revised rules are rerun by code.
- **A person's say in the ledger outranks the rules in `classify run`.** The order is
  field, label, person, rules, signals, parent, agent. A label or field in the tracker
  still comes first, because changing it there is how a person corrects from the
  tracker. `--recheck` ignores labels and fields, never a person's say. `--to unsure`
  stands as no category and is not passed to the engine, so the rules apply again.
  `classify prompt` does not read the ledger: a backtest reuses the scheme's name, and
  a person's say would otherwise settle the very items the agent is being asked about.
- **`classify correct` is served over MCP and marked `via: mcp`.** The maintainer's
  decision 9. It returns the correction without `at` and `via`, which differ by door
  and by clock; both are in the ledger line.
- **A correction from the tracker is recorded only for an item the ledger already
  holds.** Without an earlier verdict there is nothing a label could be correcting. It
  then stands as a person's say, with `by: null`: the read carries no changelog for
  labels yet, so who changed it is unknown and is not guessed.
- **`--record` writes only what changed.** A verdict line is written when the item's
  category or source differs from what the ledger holds, so a second run appends
  nothing. `--record` is a local write (`writesLocalWhen`), refused under the API's
  `readOnly` and allowed over MCP.
- **Only a correction to a classifier's verdict counts as a check.** A correction with
  no earlier verdict, or to a person's own earlier say, is left out of agreement, the
  sources and the confusion table; it still counts in the totals, the doors and the
  items changed twice. Agreement is grouped by the revision of the verdict that was
  checked, and every share is `null` where nothing was checked.
- **Which third is held back is fixed by the item's id.** `heldBack()` hashes the id,
  so `classify tune` and `classify stats --backtest` agree without passing a list. The
  backtest scores only held-back items the ledger saw a classifier verdict for, counts
  an item with no answer as not agreed (`BACKTEST_MISSING`), includes confirmations so
  a revision that breaks something right shows up, and reruns the revised rules with
  `recheck` and no person's say.
- **The three-corrections rule for a rule change is in the tune prompt, not enforced
  by `scheme set`.** `scheme set` sees a scheme file, not the corrections behind it. A
  person applies every revision and sees both backtest scores first.
- **`classify mix` is a thin wrapper over the insights pivot.** One model counts the
  mix on the CLI, in Toil UI and for an agent (#567). The split is always the category,
  the unsure share is its own entry, and `sources` says how each item was decided
  (rules, signals, labels, parent, agent, person, unsure). Where: `src/classify/mix.ts`.
- **The sample team is generated, not stored, and is relative to an as-of date.**
  `sampleTeam(asOf)` in `src/core/sample/` builds Jira and GitHub data in their own
  shapes from a fixed seed, with every date an offset from `asOf`, and maps it with the
  real mapper. Why: a stored file goes stale ("the last 90 days" would empty out), and
  hand-written Open Work Items would skip the mapper every real team's data goes
  through. `toil sample team` is a standalone command, so it works with no config; it
  is served over MCP, and `--out` is a local write that never replaces a file. Known
  gap: the sprint calendar is counted from a Tuesday, so on another weekday a sprint
  boundary can fall on a weekend.
- **`readBriefRecords` accepts the `sample team` envelope.** It took only `util owi
  map`'s, so `toil sample team | toil classify run` could not work. Where:
  `src/core/brief/read.ts`.
- **In Toil UI a reclassify records the person's say and writes nothing to the
  tracker.** A press on the category chip runs `classify run --record` over the item
  and its parents, then `classify correct`, both local writes to the person's own
  ledger. The record comes first because a confirmation counts as agreement only
  against a stored verdict. Undo records a correction back to the previous word, since
  the ledger is append-only. Where: `ui/server/classify.ts`.
- **A pending tracker change is derived, never stored.** It is a decided item whose
  label differs from the decision, worked out each time, so it survives a reload and
  can't drift from the ledger. After an Apply the page remembers what it wrote until
  the next sync, so nothing is offered twice.
- **Apply builds its plan on the server from the items the page sends, and takes no
  command, path or file name from the page.** It runs `classify run --recheck` over the
  decided items with the accepted agent answers as a verdicts file, saves the result
  with `--summary-file` through toil's file service into Toil UI's data folder, and runs
  the tracker's own `categorize --from <that file> --allow-write`, behind the
  connection's `writes`. It then runs `classify run --record` with the same input. The
  approval card is the one place a command line is shown.
- **The AI agent gets no tool for classification and applies nothing.** Ask your AI
  agent and Improve with your AI agent hand it toil's own prompt, read its answer with
  `readVerdicts` or `readScheme`, and show proposals. Applying a revision, and saving
  the editor, run `classify scheme set` as a person's command and are never on the
  list of config changes an agent-facing route can reach.
- **`classify stats --standing` returns each item's last say from a person.** Added so
  the page and the agent's tools classify with the same corrections the CLI does. It
  is an additive flag.
- **The Classify view lists unsure items and disagreements, and an answer on a parent
  settles the items under it.** A disagreement is an item whose verdict changes when
  labels and fields are ignored. A row whose parent is in the list says how many items
  follow its answer. K and F are bound only for the two-category scheme; any other
  scheme uses 1 to 9, and U is always Unsure.
- **Known gap: the page's build stubs `node:async_hooks`.** The scheme reader the page
  imports reaches toil's progress listener, which makes an `AsyncLocalStorage` when it
  loads. The page never runs a command, so `ui/vite.config.ts` aliases the module to a
  small stand-in for the page build only; the server and the tests use Node's own. The
  cleaner fix is to split the scheme reader from the HTTP helpers it shares a module
  with.
- **Not verified: the real tracker path and a real AI agent in Toil UI.** No
  `categorize` has run against a live Jira, GitHub or Azure DevOps from Toil UI; its
  tests fake that one command, and the scripted sample agent stands in for a real one.
- **A second review of the write paths found nine things; all are fixed.** The two that
  mattered: recording again before Apply let an item's old label undo the person's
  correction, and the editor could save a scheme file the toil project never reads.
  The rest are the next six entries, plus a ledger past its size limit no longer
  stopping a plain `classify run` (it warns `LEDGER_UNREADABLE` and carries on without
  people's corrections; `--record`, `correct`, `stats` and `tune` still fail).
- **A person's say outranks a label that hasn't caught up.** A correction keeps the
  category it replaced. While the tracker still shows that category, the person's say
  is the verdict and no correction from the tracker is recorded; a label that is
  neither is still a correction made in the tracker. Known gap: after Apply writes a
  say to the tracker, a later say on the same item can still be read as a change in
  the tracker, since only the category before the first say is remembered. Where:
  `src/core/classify/engine.ts`, `src/classify/run.ts`.
- **`classify scheme show` and `set` take `--toil-project`.** Additive. With it they
  resolve the scheme exactly as `classify run` does, so Toil UI's editor shows and
  saves the file the toil project reads, a file beside the project included. A
  project that names no scheme uses the built-in one, and the editor says so and
  offers to point the project at a saved copy.
- **An AI agent's revision can't change a label or a category's id.** Labels are what
  `categorize` writes to trackers and ids are what the ledger records, so Toil UI puts
  existing labels back, lists each attempt as ignored, and refuses a revision that
  renames or removes a category. A new category's label is named on the card.
- **Apply runs the plan the card showed.** Planning stages the plan file and returns an
  id that is good for one Apply and thirty minutes; Apply takes only the id. A revision
  is applied only to the scheme revision it was made from, and so is an editor draft.
- **Toil UI's working files are removed when their flow ends,** and leftovers older
  than a day are swept when the server starts. A revision a person dismisses is
  removed when it expires.
- **Every ledger field is held to a pattern on the way in and on the way out.** The
  item id is cleaned like a title, a line whose category or source isn't of the right
  form is skipped and counted, and the tune prompt prints nothing from the ledger
  outside its fence unless it passes those forms.
- **A verdict says which door a person's say came through.** "A person chose", "Recorded
  by an AI agent for a person" (a correction over MCP) or "Changed in the tracker". The
  source stays `person` in all three, as the maintainer's decision 9 counts them.
- **Apply names the connection, so the adoption gate for a toil project's connection
  doesn't apply.** The person pressed Apply on a card that names the connection, which
  is the same as naming it on the command line. The connection's `writes` still
  decides.

**Not verified:** no command here has been run against a real Jira, GitHub or Azure
DevOps. Every request is checked against canned responses shaped from the vendors'
documentation, and each fixture says so.
