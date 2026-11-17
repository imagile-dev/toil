# Ticket rules and the flow scheme (#657)

## Flow scheme

- **Risk is tried before defect, so a security bug is Risk.** The built-in `flow`
  scheme's rules run in file order, and the first that matches decides. Its order is
  risk (a `security` or `compliance` label), defect (type Bug), debt by title, then
  debt by the `tech-debt` label. Why: a bug labelled `security` is the work a security
  or compliance review asks about, and filing it under Defect would hide it from the
  Risk share of the work mix. A team that wants it the other way copies the scheme with
  `toil classify scheme init --from flow` and swaps the two rules
  (`src/core/classify/builtin.ts`).
- **The debt title rule is classify's existing substring match.** `{ "title":
  ["Bump", "Upgrade"] }` matches any title containing either word, case-insensitive, so
  "Upgraded the dashboard copy" is Debt too. Why: it uses the vocabulary a team's own
  scheme already has, and a whole-word or start-of-title match would be a new matcher
  for one rule. Dependabot's titles start with "Bump"; Renovate's "Update …" titles
  aren't matched and stay unsure, since "Update" is too common a word in feature titles.
  The rare false hit is one keystroke to overrule in the Classify view.
- **Flow has `signals` off.** toil's built-in signals all mean keep the lights on, and
  flow has no KTLO category, so only its four rules decide and everything else is
  unsure, for a person or an AI agent.

## Ticket rules (standards)

- **A place a record doesn't carry is `skipped`, "not read", and a rule is skipped only
  when none of its places was read.** A rule reads the places in its `in` that the record
  carries and joins them; when it misses with some places unread, its reason names them
  and its `source` says `not read: …`. Why: `bug-repro` reads Azure DevOps' repro steps
  field and the description, and a Jira bug never carries that field, so skipping on any
  unread place would skip every Jira bug. Principle 12 still holds: a miss is only ever
  claimed on text that was read (`src/core/standards/check.ts`).
- **A record with no `body` key never had its description read; `"body": null` is a
  description read and found empty.** OWI writes `body: null` when the tracker sent no
  description, and a hand-made record may leave the key out. Why: that is the one
  difference OWI records already carry. `standards check` keeps the record's `body` as it
  came rather than defaulting it, as `classify`'s `complete()` does
  (`src/standards/commands.ts`).
- **A field is read when its key is in a native record, whatever its value.**
  `fields[<id>]` (Jira, Azure DevOps) or a top-level key (GitHub's `body`), compared
  without regard to case; a key with `null` is read and empty, a key that isn't there is
  not read. The cost, documented in `skills/toil/standards.md`: Azure DevOps leaves an
  empty field out of a work item, so there an empty field reads as not read.
- **`criteria` takes the first source that holds any words.** The toil project's
  `<area>.fields.acceptanceCriteria`, then (Azure DevOps only)
  `Microsoft.VSTS.Common.AcceptanceCriteria`, then the description's section under
  "Acceptance criteria", "Acceptance criterion", "Definition of done" or "Done when", then
  the whole description. When none holds words it is the empty text of the ones read, and
  not read only when none was. Why: a field named but left empty shouldn't hide criteria
  written in the description.
- **An item's `verdict` is the worst of the rules that could be checked, and `null` when
  none could.** A `skipped` result never counts as a pass or a miss; an item whose every
  applicable rule was skipped has a `null` verdict, the same as one no rule applies to, and
  `summary.checked` counts only items with a verdict.
- **`judge` reads `description` unless `in` says otherwise, and is always `skipped`.** The
  plan reserved it without a shape; `in` is its only key so a later AI step can say where
  to look without a format change.
- **A `field` check counts placeholder text as empty.** "TBD", "N/A" and the other lines
  readiness's `realText` drops leave a field empty, with the reason "holds only
  placeholder text". Why: the same reading as Toil UI's description check.
- **`summary.byRule[].types` is the OWI types of the items the rule applied to, sorted.**
  Not the rule's `when.type`: a rule with no `when` still gets a noun for "9 of 23
  stories", and the list is what was there, not what was asked for.
- **`results[].source` is where the text came from (`description, under "Acceptance
  criteria"`, `field customfield_10300 (acceptanceCriteria)`); the standard's name is
  its own field.** Toil UI composes "standard gherkin" from `standard`.
- **Regex safety is a refusal list, not an engine.** A pattern may not hold a
  backreference or repeat (`*`, `+`, `{n,}`, `{n,m}` with m above 1) a group that holds a
  quantifier or an alternation; flags are only `i`, `m`, `s`; at most ten patterns of 200
  characters a rule; a text is cut to 20,000 characters before any pattern runs
  (`BODY_SCAN_LIMIT`). The check errs on refusing: `(ab)+` with no inner quantifier is
  allowed, `(a|b)+` is not (`patternProblem` in `src/core/standards/read.ts`).
- **The other caps.** At most 50 rules a standard; a rule's `name` 120 characters and
  `text` 500, one line each, no credential shape; `description` 300; 1 to 5 places a rule;
  1 to 10 headings of 100 characters; `minWords` 1 to 1,000; `words.min` 1 to 10,000; a
  file 256 KiB. A field place is `field:` then 1 to 100 letters, digits, spaces, `.`,
  `_`, `:`, `/` or `-`.
- **A section ends at the next heading-shaped line.** A Markdown heading, a line that is
  only bold text, or a short "Label:" line with nothing after it. A heading matches with
  `#`, `**` or a trailing colon, and only on a trimmed line of at most 300 characters, so a
  run of spaces can't slow the match. "Expected results are elsewhere" is not a heading.
- **The ADF walk is a loop, and the text port otherwise verbatim.**
  `src/core/standards/text.ts` is Toil UI's `textOf`, `realText`, `wordCount`,
  `normalise` and `acceptanceInBody`, with the ADF reader rewritten over a stack (at most
  50,000 nodes), heading levels clamped to 1 to 6 (the UI's copy throws on a negative
  level), and a raw value cut to 100,000 characters before conversion. Package C can import
  these and delete its copies.
- **A broken or unknown standard stops the check.** `--standard nope` is `NOT_FOUND`, and
  so is a toil project's `standards.use` naming one that can't be read; nothing is checked
  against a partial list. Why: as `classify` does with a scheme, a typo must not quietly
  check against fewer rules.
- **`STANDARDS_NONE` and no fallback.** No toil project and no `--standard`, or a toil
  project with no `standards` key, checks nothing, with a warning naming the command that
  fixes it. The built-ins apply only when named.
- **A standard given twice is checked once**, from the first, with `STANDARDS_DUPLICATE`;
  a repeated item id, likewise, with `STANDARDS_DUPLICATE_ITEM`.
- **`projects standards set --use` replaces the list; it doesn't append.** A different list
  already set is refused without `--replace`; the same list again changes nothing.
  `--clear` (a boolean, unlike classify's per-part `--clear`, since the key has one part)
  removes the key and is refused over MCP by `offMcpWhen`; `--clear --use x` sets just
  `x`. A standard that can't be read yet is still set, with `STANDARD_UNRESOLVED`. It lives
  in its own file, `src/projects/standards-set.ts`, and gets the retired
  `dossiers standards set` path as every `projects` command does.
- **The toil project key reuses classify's text cap and refused keys.** Each ref is at most
  200 characters (`MAX_CLASSIFY_TEXT`), and `standards` refuses `connection`, `host`,
  `fields`, `transitions` and `writes`, with the same message shape as `classify`.
- **One generic catalog.** `src/core/file-catalog.ts` holds what the scheme catalog did,
  parameterised by folder, noun, reader, built-ins, name form, size cap, warning prefix
  and the words of a fix; `createSchemeCatalog` and `createStandardCatalog` wrap it, and
  every scheme message is word for word what it was. The standards catalog exposes no
  `save`: toil never writes a standard. `classify.write` and `classify.replace` now list
  `src/core/file-catalog.ts` too, and a new exception, `standards.read`, records reading
  `~/.toil/standards/` and `.toil/standards/` outside the workspace (`docs/bounds.md`).
- **`standards` is a top-level command group beside `classify`.** `standards.md` joins
  the general skill pages (`GENERAL` in `test/skills.test.ts`), and the pure half is
  exported from `src/core/standards/index.ts` for Toil UI: the types
  (`StandardsCheckResult`, `ItemStandards`, `RuleResult`), `checkStandards`, the presets
  and the text helpers.
- **The `when` matcher moved to `src/core/classify/when.ts`.** `matchWhen` is the
  engine's old `ruleMatch` over a `when` rather than a rule; `readWhen` is the scheme
  reader's `when` block with the file's own text check passed in, so each error still says
  "a scheme never holds one" or "a standard never holds one".

- **Flow also calls an item labelled `bug` or `defect` a Defect.** Why: Jira team-managed projects and GitHub repositories without issue types file bugs as a task or issue with a label, so a type rule alone left the demo's bugs unsure. Where: `src/core/classify/builtin.ts`, rule `defect-label`, after `risk` so a security bug is still Risk.
- **`standards.md` shares the `classify.md` row in `SKILL.md`.** The index had one byte
  left under its 4 KB cap (`test/skill-bundled.test.ts`), so the row became "`classify.md`,
  `standards.md` | Work categories; ticket rules", "Open only the file the task needs"
  became "Open only what you need", and `core.md`'s "certificates and proxies" became
  "certificates, proxies".
- **A bare site page now, for the docs check.** `test/site-docs.test.ts` fails while a
  skill file has no page, so `site/src/pages/docs/standards.astro` renders `standards.md`
  with the `standards` command index, listed in `skill-pages.mjs` and under Use in
  `docs-path.mjs` as "Ticket rules". Package D owns the page's content beyond that.
- **`src/core/standards/`, `src/standards/` and `src/core/file-catalog.ts` are on triage's
  safety-layer list** (`scripts/triage/changes.mjs`), as `src/core/classify/` is: they hold
  a bound's reads and the caps on patterns a checked-in file runs, and
  `test/triage.test.ts` requires every path `docs/bounds.md` names to be flagged.
