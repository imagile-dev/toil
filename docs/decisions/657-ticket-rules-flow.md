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

## Ticket rules: plain text, judged by an AI agent

The maintainer's call on #657, after #669 merged: "I don't want the pattern rules at all. I want the rules to be plain text instructions that the user can modify freely, just with starter prompts of suggestions", judged by inference from the person's AI agent "so the users can set any kind of criteria to analyze their work items". The ticket rules commands have never been in a release, so replacing their shape in this follow-up, before the next release, is not a declared breaking change: no `feat!:` and no deprecation path. What the first slice decided about checks (places, `skipped`, `criteria`, sections, the regex guard, `labels`, `missing`, `when`, `fail`, `standards check`) no longer holds and is gone from the code; the decisions below replace it.

- **A rule is `{ id, name, text }`.** `name` is one line of at most 120 characters, `text` at most 2,000 characters with line breaks and tabs allowed (it is instructions, often a few lines), no other control character, and nothing shaped like a credential, so a pasted token never lands in a prompt. A standard keeps `name`, `revision`, `description` (300) and 1 to 50 rules. Why 2,000: four short paragraphs, enough for a rule with examples, small enough that 50 rules across a few standards still fit beside eight items in one prompt. Where: `src/core/standards/read.ts`.
- **A file in the old shape is refused, never half-read.** A rule holding `check`, `when`, `fail` or `missing` is `CONFIG_INVALID`, naming the key path, with a fix saying to keep `id`, `name` and `text` and write what the check said into the text. Why: ignoring those keys would quietly turn a strict check into an empty rule. Other unknown keys stay warnings, as before.
- **Whether a rule applies is the agent's call, from the rule's own words.** `when` is gone, so the starters open with "This rule is for stories. For any other kind of item, it does not apply.", and the agent answers `na` for a rule that doesn't apply. A test holds every starter to that opening.
- **The built-ins are starter prompts, revision 2.** gherkin (`scenarios`), user-story (`story-form`) and bug-repro (`steps`, `expected`, `actual`) keep their names and rule ids, so `?rule=gherkin/scenarios`, a toil project's `standards.use` and the demo keep working; their text is plain instructions. Revision 2 says they changed.
- **`toil standards check` is removed.** toil runs no agent, so it can't judge plain text. `toil standards list` gains `--toil-project`, which lists the standards that toil project names, in order, resolved as it names them (a path beside its file included): Toil UI's server needs exactly that and could not compose it from the unfiltered list, since a path beside the toil project isn't in it (principle 3). Without the flag the output is as before, plus `toilProject: null`, and rules are `{ id, name, text }`. A standard the toil project names that can't be read stops the listing, as the check did; none named is an empty list with `STANDARDS_NONE`.
- **`toil standards save <name>` and `toil standards remove <name>` are the write path**, config commands with `writesLocal`, writing only `~/.toil/standards/<name>.json`. `save` reads `--input-file` or `--text` (a `name` in it must match), creates or replaces your own copy, and sets the revision itself: 1 for a new one, one more than the copy it replaces otherwise, and nothing written when the content is the same (`STANDARD_UNCHANGED`). Why create-or-replace with no `--replace`: it is your own folder, the revision records every save, and Toil UI's Settings saves edits repeatedly. Saving under a built-in's name makes your copy, which is what "Edit a copy" in Settings does; `remove` then brings the built-in back (`STANDARD_NOW_FROM` says what the name means afterwards). `remove` deletes only a file that reads as a valid standard, reached through realpath inside the folder.
- **Both are `cli-only` person's commands**, added to `registry.personCommands`, so Toil UI's Settings runs them for a person through `/api/config` (`CONFIG_COMMANDS`) and MCP never serves them. Why: the rules are what an agent's verdicts are held to and their text reaches an agent's prompt, so agents never rewrite the rules that judge their work (principle 2), as `classify scheme set` is a person's. `remove` is also a delete, which MCP never serves.
- **The bounds.** `standards.read` keeps the path rules and caps for reading a rule file and drops the regex parts. Two new exceptions, `standards.write` (`files.workspace`) and `standards.replace` (`files.no-overwrite`), record writing and removing in your own folder only. Where: `docs/bounds.md`, `src/core/bounds.ts`, `src/core/file-catalog.ts` (`removeOwn`).
- **`text.ts` stays**, without `sectionUnder` and `CRITERIA_HEADINGS`, which only the checks used, and with `ADO_ACCEPTANCE_FIELD` moved in from the deleted `check.ts`. Toil UI reads an item's text through it for the agent and the readiness rows.
- **Kept from the first slice:** `STANDARD_SHADOWS_BUILTIN` (a repository's file with a built-in's name is set aside), the generic catalog, the toil project's `standards` key and `projects standards set`, the 256 KiB file cap, and `standards.md` sharing the `classify.md` row in `SKILL.md`.

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
  a bound's reads and its writes to your own folder, and the reader's caps on a checked-in
  file, and
  `test/triage.test.ts` requires every path `docs/bounds.md` names to be flagged.

## Toil UI

- **Verdicts come from the person's AI agent, on a press, never on load.** "Check with AI agent" (the theme's agent mark, a tooltip saying what it does and reads) judges one item on its page or the open items listed on Tickets. It runs the agent chosen under Settings, AI agent, with no tool (as Classify's ask does), at most 60 items a press and 8 to one call, all within the assignments' time limit (`timeLimitMinutes`), one press per Toil project at a time. Items whose verdicts still hold are skipped, so a second press is free. Why 8: every rule on every item gets a careful look and one bad answer costs little; a time-out or failure keeps the batches that finished and says how many are left. Where: `ui/server/standards.ts`, `ui/src/components/check-rules.tsx`.
- **Each rule and each item is in its own fence.** The judge prompt puts every rule in the `<<<TICKET_RULES … TICKET_RULES>>>` fence a fix already used, and every item in its own `<<<TRACKER_ITEM … TRACKER_ITEM>>>`, with every marker taken out of rule and item text; the system prompt calls both data and says an instruction inside them makes the verdict unsure. The item's text is its title, type, labels, description, and the acceptance criteria field (the toil project's, else Azure DevOps') and Azure DevOps' repro steps, cut at 8,000 characters (`itemText`, `ui/src/rules.ts`). A record with no `body` reads "(not read)", never empty.
- **Four verdicts, each with a reason and a quote.** met, missed, unsure, na. A quote is looked for in the item's text with whitespace, case, quote marks and list markers aside; one that isn't there turns the verdict into unsure with a note quoting what the agent claimed, as an unseen `[[id]]` citation is flagged. A "met" with no quote is unsure too: nothing on the item was shown to meet the rule. A missed may have no quote, since an absence can't be quoted. Entries for items or rules the agent wasn't asked about are dropped, the first entry for a pair wins, and pairs it left out stay not judged, each counted in a note. Where: `readJudgement`, `ui/src/rules.ts`.
- **Verdicts are kept in the cache, newest only**, a `rule_verdicts` table (schema 7) keyed on Toil project, item and rule, each record holding the hash of the item's text as the agent read it (superseded below: once the item's `updated`) and the rule's text's hash. A verdict holds only while both match, so an item is judged again only when it or the rule's wording changes; a renamed rule keeps its verdicts. It is kept per Toil project like the worklog (a sync never rewrites it), follows a rename, goes with the Toil project, and is pruned by when it was judged. The sample keeps its own in memory.
- **Every verdict says it is the agent's reading** (principle 4): the row reads "Missed: <reason> (Claude (sonnet)'s reading, 19 Nov 14:02 UTC)", its source "<agent>'s reading (ticket rules: gherkin)", the quote one press in, and a note Toil UI added stays in view. A rule not judged yet is a dash, "Not judged yet", never a pass, a miss or a zero (principle 12).
- **Missed makes an item thin; a ticket rule never blocks.** Unsure or not judged makes it "Rules unknown" (the `unread` verdict, plain "Rules not known yet"), counted apart, never Ready. Doesn't apply is a row state of its own (`na`) that counts for nothing. Why never blocked: an AI agent's reading shouldn't take an item off the table; a person decides. So the Blocked figure and the Tickets badge are exact again, and `blockedOpenReading` and its floor are gone.
- **Tickets' lines count items as the agent judged them**: "**2** items miss <rule names>, 1 unsure, 3 not judged yet", a standard with several rules one line, only a line with a miss a filter button. The `missing` phrases and the "3 of 27 stories" nouns went with the checks: what a rule applies to is no longer known before it is judged.
- **Fix with AI agent needs a verdict of missed** on the item's current text. `ruleFor` returns the rule's text and its verdict now; the queue refuses met, na, unsure and not judged, each saying so and, for not judged, pointing at Check with AI agent. `AssignedRule` carries the agent's reason, quote and name instead of toil's source; the fixing agent rewrites the place the rule speaks of (the acceptance criteria field when the item has one and the rule is about acceptance criteria, else the description). `quote` and `by` are optional so an older saved assignment still reads. The fix prompt changed, so refine's fingerprint (#305) moved once more.
- **Sync and judge again**: the press syncs, and once that reading is on screen asks the agent, once per press, to judge the item's rules on its new text (`firstJudging`, `ui/src/assign/recheck.ts`), since the person pressed for exactly that; "now passes" became "✓ <agent> judges <rule> now met." with the readiness verdict after it.
- **Settings, Ticket rules is a page of its own** (`#/settings/rules`): which sets a Toil project uses (superseded below by "Choosing a Toil project's rule sets is a person's"), each set as a card (yours: Edit and Remove; a built-in or a repository's: Edit a copy), and the editor (description, each rule's name and instructions, Add a rule from a starter or blank, Remove this rule, Save). Rule ids are made from the name, unique within the set, and an existing rule keeps its id. The form's rows share a 9rem label column above 30rem, label above control below it. The sample's Settings read a canned `standards list` with one set of the person's own and refuse every change, as every sample Settings page does.
- **The sample opens with every state**: card-payments' open items judged by "The sample's scripted agent" an hour before the sample's day, except the last (PAY-107, not judged), with PAY-102's "met" held to unsure because the script quotes a line the item doesn't have; Check with AI agent judges the rest with the same script, through the same `readJudgement`. The script reads each starter's shape off the item; a rule it doesn't know is unsure.
- **The demo seeds keep their own reading** of the starters (`ruleMisses`, `ui/scripts/demo-week-data.mjs`) to look before they write; the test now holds the seeded data to that reading alone, since there is no deterministic check of toil's to compare it with. The agent's verdicts on the demo are its own, so the demo notes say to check them on a dry run.

- *A note on the review rounds below:* they were made on the deterministic check. Where one speaks of toil's check, a `skipped` rule, "Missing" on a row, toil's reason or source, or "Sync and check again" and "now passes", read the agent's verdict, "Missed", the agent's reason and quote, and Sync and judge again, as above; the rest of each decision stands.
- **The flow lens is on the Work mix itself: a "Sort by" menu.** The mix is the pure classify
  engine run on the items in the page (`insights-input.ts`), so another built-in scheme's mix
  is one more run with that scheme, writing nothing. `?lens=<scheme>` in the address picks it;
  `useWorkInsights` reads it from the address, so the drawer behind a segment counts the same
  way. The menu lists the saved scheme first when it is a team's own file, then the three
  built-ins by their category names ("Feature / Defect / Risk / Debt"), the saved one marked
  "(saved)". Under a lens, a person's ledger answers are left out (they name the saved
  scheme's categories), and a note says it is for this view only and the saved categories are
  unchanged. Settings, Classification stays where the saved choice is made.
- *Superseded by the plain-text rework above:* the Command Center's line counting with `missing` phrases and nouns, and a rule's reason built from pattern `labels`.
- **The UX review's round (Toil UI).** What changed, and why each:
  - *An assignment's proposal leads with the change.* `ProposalCard` gained an apply form
    (`lead`): the field table, then Apply, then the reason, with the command, the shell toggle
    and the MCP JSON in a closed "Show the command". The "can't be passed safely … --input-file"
    advice is a note inside it, not red, in the apply and tidy forms alike, since a person
    pressing Apply never types the command. It applies to every assignment proposal; Apply
    still runs the stored proposal through the write gate, unchanged.
  - *Field names are plain.* `fieldName` (model/readiness.ts) names the Toil project's
    acceptance criteria field "Acceptance criteria" and a few fields every tracker shares; an
    unknown id still shows as code, with the id on hover where a name is shown.
  - *The fix's head.* "To meet the ticket rule <name>." with no reason (the dialog and the rows
    carry it), led by "Nothing has changed yet. Review the proposal below and apply it." while
    a proposal waits and none was applied, for every mode; times and usage moved under "Run
    details".
  - *"Fix all N" for one standard.* `AssignRequest.standard` takes `rule` or `rules` (one
    standard, up to 12, unique, each held to the name form); the queue keeps the rules the
    item still misses and refuses with 409 only when none is left. `Assignment.standard`
    became `Assignment.rules` (a non-empty list): the field had not shipped. The prompt lists
    each rule's name, text, reason and source; the fingerprint's placeholders cover one rule
    and two, so refine's prompt hash moved once more.
  - *The Command Center groups a standard.* One line a standard, figure in bold; "and" when
    every missing item misses every rule, else "or". `?rule=<standard>` filters to any rule of
    it; `missing`, `ruleName` and `matchesRef` (src/rules.ts) take either form.
  - *The doubled "AI AI agent" in help.* `plainify` swapped "agent" inside "AI agent"; it now
    leaves an agent already preceded by "AI" alone, so it is idempotent and copy can say "AI
    agent" outright. The setup and classify-ask topics had the same doubling.
  - *Work mix "Sort by" became "Categories",* first and set apart from Split by and Measured
    in, options named for their set ("Flow: …", "Balance: …", "KTLO: Keep the lights on /
    Feature": the review's "KTLO / Feature" is kept as the set's short name with its plain
    categories after it), "(your team's)" for the saved one, and a "Back to saved" link.
  - *Rule rows* are a set-in group under "Ticket rules", one block a standard, the source one
    press in under each row's disclosure (principle 4: reachable, never removed), Fix at the
    row's end at desktop widths and full width under it on a phone, one button style.
  - *The ticket-rules help* is the review's wording in two sentences, because help topics are
    held to two (`ui/test/help.test.tsx`), and names the button "Fix with AI agent".
- **The second UX review's findings** (Toil UI):
  - *Proposals first on a refine or a fix.* The Proposals section renders above "Questions for
    you" and "What the agent said" when the mode is refine or the assignment carries rules, so
    the field table and Apply are on the first screen at 1440×900; investigate and implement
    keep the report first, since their proposal follows from it.
  - *Now column.* The diff's "now" was always unknown for a tracker field: `current()`
    (`ui/src/assign/model.ts`) read `item.native.fields`, but `native` is keyed by the command
    that read the item. It now reads each record's `fields`, as the readiness gate does, so a
    field the read returned as null is "empty" and one no read returned is a dash, "not read
    yet". Fixed there rather than in the sample's `ruleFix`, since the diff is built by the
    queue from every runner's proposals; a real run gets the same answer.
  - *One Unsure.* The Work mix's "How it was decided" counted every item the pivot held
    (`total.items` lists every item in the pool, finished or not), while the headline counts
    items finished in the period. `mixDecided` (`model/work-insights.ts`) counts only the items
    the pivot's own throughput measure counts, with the same verdicts, so the two agree under
    any lens and on real data; for Estimate and Days in progress it still counts every item
    the measure holds, since those shares are of points and days.
  - *Plain field name in the acceptance check's reason*; the raw key stays in Source.
  - *A fix's card leaves the proposal's reason out* (`ProposalCard`'s `hideReason`), since the
    agent's paragraph above says it; other assignments keep it.
  - *The proposals lede* names the item's tracker from its synced source, "the tracker" when the
    item isn't in the sync, and the write gate moved into the proposal (i) as its note.
  - *Bar labels* draw only where the 13px text and the thickest edge (a double outline, 4.5 in)
    fit on both sides, so no figure is struck through; the figure stays in the table and drill.
  - *"Missing" on a rule row* is display only (`RULE_WORD`); the row's state stays `thin`.
  - *The notice names the item "Jira PAY-103".* Assignment events carry `itemName`, worked out
    by the queue from the last sync; the notice falls back to the id where the sync doesn't
    hold the item.
  - *"Keep the lights on / Feature (your team's)"*: the "KTLO:" title is dropped, overturning
    the first round's choice to keep it.
  - *The picked AI carries a check mark*, as a menu's chosen item does, on every agent radio
    list (the fix dialog and Assign).
  - *Ticket rules card lines* are "**3 of 27** stories: no Given/When/Then criteria": each
    rule's `missing` phrase, joined with "or" and a repeated leading "no" folded, or "missing"
    and the rule's name where it gives none. The colon removes the verb, so `RuleLine.missAll`
    went. The drill's "Missing: <rule names>" already reads well and is unchanged.
- **The live run's findings** (Toil UI, a real agent on Jira Cloud):
  - *Readable Now and Proposed.* A diff showed Jira Cloud's description as its ADF JSON, since
    `current()` turned any object into JSON. `richText()` (`ui/src/assign/model.ts`) reads ADF,
    Azure DevOps HTML and wiki markup through toil's own `textOf`, with the body's recorded
    format where the record has one, and the page reads a diff stored before the fix (ADF as
    JSON text) the same way, so the live run's saved assignment reads too.
  - *Diff columns.* Field is a fixed 9rem, Now and Proposed share the rest equally, with a fixed
    table layout; at 375 the table stacks as every `DataTable` does.
  - *No "Applied" for a refused write.* The page's status line said "Applied: …" whenever the
    Apply call returned, but a write toil refuses comes back as an assignment whose proposal
    failed, not as an error. The line now comes from the returned proposal (`applyResultText`):
    "Applied" only when it is applied, otherwise "Not applied: … toil refused it; the card below
    says why." The queue's events already said "Apply failed", the Work log's audit match
    counts only `outcome: ok` writes, and the bell never notices a proposal event, so nothing
    else claimed it.
  - *Lists in answers.* An Ask answer's list under a heading line is one part, and drawn as one
    `<p>` its items ran together as " - one - two". `AnswerText` (`ui/src/components/items.tsx`,
    from `blocksOf` in `ui/src/agent.ts`) draws `- ` and `* ` runs as a real list and keeps
    other line breaks, with citations linked in each; used for Ask, the Analyze fallback and an
    assignment's report.
- **Product review, round 3** (Toil UI, for the launch video; principles 4, 11 and 12):
  - *A writes-off refusal in plain words.* The card said toil's raw CLI error in red. A refusal
    whose toil error says writes are off on the connection now reads "Not applied. Writes to
    Jira are off on this computer, so nothing changed. Turn writes on for the jira connection,
    then press Apply again." (the item's tracker and the connection named), still in the
    failure style and in view, with toil's exact words under a closed **Details**
    (`writesOffText`, `ui/src/assign/model.ts`). It is read from the message, not only the
    code, because WRITE_DISABLED also covers a binding the person hasn't adopted, where that
    sentence would be wrong; any other refusal keeps toil's words in view as before. The queue
    now records the error's code on a failed outcome (optional, so older records read). The
    card's status word is "Not applied" rather than "Not applied: toil refused it".
  - *The running page has one live line*, from the run's own transcript (`liveLine`): the last
    tool call and the item it read, "and its parent" only when the cache says so, and the count
    of tool calls. Before the first call it says only that the run started; a tool it doesn't
    know is named as it is. An empty transcript is not shown. The record of what the run
    started on stays a closed disclosure, since it is the run's evidence.
  - *Possible duplicates* are one line each with a **Why?** disclosure, written by Toil UI from
    the scorer's fields (`duplicateWhy`, `ui/src/model/duplicates.ts`), since `src/` is out of
    scope here and the CLI's `summary` is right for the CLI. Seed marks (`toil-seed`, `seed:…`)
    never appear as a reason; the score itself is the scorer's, unchanged.
  - *Cost lines.* With no dollar figure there is no cost line: the answer footer's fold says the
    tokens instead, the "What it looked at" line leaves cost out, and the chat total says
    tokens. A Claude plan's figure reads "Covered by your Claude plan (about $0.12 of usage)",
    the adapter named from the record.
  - *A rule fix cites its own item.* The fix prompt asks the agent to cite `[[id]]` in its
    paragraph, and tells it the proposal's note is plain words for the person applying it,
    nothing about formats or how the text is sent. The citation check is unchanged, so an
    answer that still cites nothing is still flagged. The #305 fingerprint's prompts part
    is built from the prompt text with placeholders, so it moves with these words by itself.
  - *Applied tables* read Before and After, with nothing struck through.
  - *Copy.* The questions end "Answer these in Jira, then ask for a new rewrite." on a refine or a
    fix ("then assign it again" elsewhere); **Mark reviewed** moves below the proposals there;
    the Proposals lede drops "Nothing changes in Jira until you press Apply." while the head
    says "Nothing has changed yet". High confidence reads "All the data this answer needs was
    read, 13 minutes ago, across 134 items." ("All the saved data was read, …" unscoped); the
    lower levels' clauses were already in this form and are unchanged. "(the first one ready)"
    beside **Answered by** is dropped, keeping "your default can't run".
  - *Ready to start?* The plan id moved from the slate's sentence into its hover. The Board
    tab's badge counts the board's items with an insight of weight 2 or more (blocked, blocking,
    a failing build, aging, carried over, a PR with no build, stale, deployed and still open);
    it already had "44 items need attention" for a screen reader and as a hover, and the hover
    now adds which reasons, most first ("16 blocked, 9 stale").
  - *The readiness panel's footer* ("Worked out from the cached record, with no model call."
    and what Check the workflow live reads) moved into the panel's (i); the button stays, and
    after a live read the line beside it still says when and with which command, as the
    result's source.
- **Product review, round 4** (Toil UI, for the launch video: the fix-and-apply loop visibly
  closes; principles 2, 4, 11 and 12):
  - *An applied fix settles the assignment, questions and all.* `settledState`
    (`ui/src/assign/model.ts`) now ends at done once nothing waits and at least one proposal was
    applied, even with questions left: the questions say "Answer these in Jira", so once the
    change is in they are the tracker's conversation, not a step on this page. A run with only
    questions, or whose proposals were all dismissed, still needs you. The queue settles a record
    an older Toil UI saved as needs you on start, so the demo's applied SCRUM-17 reads as done.
    The chip says **Applied** (the done colour) when every proposal was applied, **Done**
    otherwise (`allApplied`). Mark reviewed goes with needs you, since there is nothing left to mark.
  - *The notice and the bell stop counting it.* An assignment event whose state isn't needs you
    removes that assignment's needs-you line from the notices and marks its bell entries
    `settled`, which never count as unread and stay in the list (`ui/src/history.ts`,
    `ui/src/components/notify.tsx`); an older saved history still reads.
  - *The applied card is a record.* Solid border (`proposal--applied`), the agent's pre-apply note
    hidden, and "Applied to Jira SCRUM-17 at 22:39 UTC." (the date too on another day) with
    **Open in Jira** from the item's own `url` when it has one. The server's outcome message is
    unchanged; the page words it from the item.
  - *Sync and check again, not "Check again".* Toil UI has no read of one item that refreshes the
    cache (the agent's `owi_get` reads the cache; the sync is incremental per Toil project), so the
    button syncs the Toil project and says so on itself. The press is remembered outside React
    (`ui/src/assign/recheck.ts`), since the App remounts after a sync, and the rule's result is
    shown only from a reading newer than the press: "now passes", "still missing: <toil's reason>",
    "not checked" or "no longer applies". Where nothing can sync (the preview), it isn't offered,
    since the sample's data never changes and any answer would predate the Apply.
  - *The lede was the wrong way round.* "Nothing changes in Jira until you press Apply." showed
    only when nothing waited. It now shows only part-way (something applied, something still
    waiting); before any Apply the head's "Nothing has changed yet" is the reminder, and once all
    are applied the lede reads "The applied change is in Jira."
  - *A line-level diff.* `lineDiff` (`ui/src/assign/line-diff.ts`), an LCS over lines that ignores
    trailing spaces and CRLF, with no dependency. Kept lines are plain in both columns; removed
    lines are struck in Now (muted, not struck, once applied, keeping round 3's "nothing struck
    through" for the record); added lines are bold with a bar. Each marked line says Removed, Was
    or Added to a screen reader. A field with no earlier text shows the proposal whole, as before.
  - *The header after an Apply.* A tally of changes Toil UI applied (`ui/src/applied.ts`), kept
    outside React and seeded from the assignments the server holds, so a reload still knows; Board
    moves and category changes add to it too. While any is newer than the data, the line reads
    "Data read 22:38 UTC. 1 change applied since." (the date too when the read was on another day)
    with **Sync now** where the app can sync. The audit log wasn't used: the page doesn't read it.
  - *Agent failures say their cause.* Codex threw "Codex failed: …" and the host added "Codex
    failed: " again; the adapter now throws the CLI's own words and the host says the prefix once,
    with one full stop. `agentFailure` (`ui/server/agents/failure.ts`) reads the message for every
    adapter: a usage, rate or quota limit says the plan's limit was reached, when it resets where
    the message says ("at 7:50 PM"), and to try then or pick another AI agent; a sign-in failure
    keeps the sign-in advice; anything else says to ask again and how to see the CLI's own error.
    The notice cuts a long line at a sentence end that keeps at least half, else at a word, with
    an ellipsis (`clip`, `ui/src/notify.ts`).
  - *Polish.* "2 steps so far". While a run works, the record of what it started on and the
    transcript are out of sight (the live line is the focus); they are disclosures once it ends.
    Possible duplicates fold to one line, "4 possible duplicates · Show" (Hide once open), the
    count as the panel's heading. The Blocked card's lede reads "Waiting on another item, done
    already, outside the Toil project, or failing a ticket rule.": a failed ticket rule also
    makes an item blocked, so leaving it out would undercount what the card counts.
  - *A test flake fixed on the way.* The assignment routes test read the next event after
    `since=latest`, which could be the end of the investigate run it had just made; it now waits
    for that run to end first. It failed on the unchanged code too.
- **Product review, round 5** (Toil UI, the last on-camera issues from a live Claude run on
  Jira SCRUM-32; principles 4, 11 and 12):
  - *No false citation alarm on the run's own item.* The assignment's item is handed to the agent
    in its prompt, fenced as data, so naming it is no invention. `finish()` takes `known` ids
    (`ui/server/agents/answer.ts`), which the assign runner sets to the assignment's item, also
    the item a rule fix was checked on; they count as returned for the citation check and for
    "rests on none". Every other id still has to come back from a tool (`ui/test/agents.test.ts`).
  - *Questions only on QUESTION: lines.* The rule-fix prompt now says the paragraph never says
    whether there are questions, and the proposal's note never repeats a QUESTION: line (null
    when there's nothing else to check). The fingerprint picks up the new text with no new
    placeholder, since neither sentence carries a rule's words.
  - *A question shows once.* Before Apply, a note that only asks a question again is left off the
    card (`noteRepeatsQuestion`, `ui/src/assign/model.ts`: half or more of the note's meaningful
    words in one question, as the live paraphrase was); any other note stays whole. Once every
    proposal is applied, the questions card becomes one quiet line per question, "Still to
    confirm with the team: …", with no "ask for a new rewrite". Why a word-overlap rule and not
    exact match: the live note was a paraphrase, and the prompt change is the first line of defence.
  - *Sync and check again answers beside the button.* When every rule passes, the status line next
    to the button reads "✓ <rule> now passes. SCRUM-32 is ready to start.", the second sentence
    from the readiness verdict on that same reading, and otherwise what it is (blocked, or needs
    more detail, with the rows that say why) (`passedText`, `ui/src/assign/recheck.ts`). The sync
    redraws the page at its top, so the result is scrolled into view once per press. A rule still
    missing or not checked keeps its own line.
  - *Copy.* "but the Command Center never slates it" → "but it won't be started automatically."; a
    readiness row read from the cache says "Source: last sync" (the row's source itself changed, in
    `ui/src/model/readiness.ts`, so every place shows it); an assignment started from Toil UI says
    "started by you"; "Too early in the sprint to judge a pace" (and the no-points basis with it)
    is the first line behind **How was this worked out?**, not a line under the headline; the Ask
    prompt's style rule tells the agent to say a gap in the tickets' words ("the tickets don't say
    why"), never in terms of the cache.

- *Superseded:* a rule's `missing` phrase is gone with the checks; a line names the rules instead.
- **Flow calls any other story a Feature** (rule `story`, last). Why: on the demo week, without it, 63% of finished work read as unsure, since most stories carry no label; the Flow Framework counts new user-facing work as a feature. Last in order, so a story labelled security, bug or tech-debt keeps that category. Where: `src/core/classify/builtin.ts`.

## Crate's polish and the motion helpers

- **Crate's `line` is its own, no longer the site's.** The dark hairline is `#2a303a`
  (light `#e0dcd3`), quieter than the site's `#3a414d`. `test/brand-sync.test.ts` now
  holds it between the site's surface and the site's line instead of equal to the line.
  Why: the maintainer found Crate too busy; nothing relies on `--line` as a control's
  boundary (buttons and fields are outlined in `--muted`, which keeps 3:1), so cards and
  rules can go quieter without failing WCAG 1.4.11.
- **Crate's dust is off until Motion is set to Full** (`"ambient": { "default": "off" }`,
  read by `src/ambient/Ambient.tsx`). Picking Full already switches a theme's particles on.
- **Nested cards are raised and unoutlined in Crate only** (theme.css), not in the shared
  `views.css`, so the other themes keep their frames.
- **Motion lives in `src/motion.css`, loaded by `src/motion.ts`**, which every entry loads,
  rather than in each of the two entries. Closing a disclosure is instant: there is no
  way to animate a `<details>` closing without script, and leaving is not worth the wait.

## The agent mark and tooltips over expanders

- **One agent mark per theme, drawn as a mask in the text colour** (`agentMark` in each theme.json, `src/components/agent-mark.tsx`). Why: a mask follows the button's own ink on the accent fill and in both schemes, so no theme can ship a mark that vanishes on one fill; the cost is one colour per mark, which suits a 16px glyph. A theme without one borrows Plain's.
- **Which controls carry it:** those that start a run when pressed (Ask in the bar and the pane, Write it up, Fix with AI agent and Ask for a rewrite, Assign to agent and its Assign or Start, the inbox's Start, Run again, Renew and Renew all, Get a briefing, a job's Run and the job menu's items, Improve with your AI agent, Classify's ask, Start N on Tickets, the guided start's questions, the chart's suggested questions, and the setup guide's starters and Ask), plus the AI agents button, as asked. Left without it: links that only open a job's page (Draw its architecture, Draw it again), and the chart menu's Ask about this chart, which opens the pane without asking.
- **Converted to an (i):** the stand-up's two expanders (Write it up and Export, now one row of buttons; Export reveals its folder field on press), Improve with your AI agent's paragraph, and the paragraph under Start on Tickets. **Left as disclosures:** run details, transcripts, evidence, the coverage gaps, What it may ask you to approve on a job page, the Details for whoever sets it up folds (the adapters' install detail for an engineer), and the setup guide's fold on a phone, which holds a whole chat.
- **The stand-up's Dash has no `title`.** It showed the raw word "none" as a hover tooltip, the stray one between the expanders; the words beside every dash already say what it stands for, and a screen reader still hears it.
- **`.control-row`** makes every button and menu in a row 32px to the eye with the 44px hit area, so a row never mixes 44px, 36px and 32px controls. A ticket rule's row aligns on its text's baseline instead, with Fix with AI agent at `btn--sm`.


## Review round: rules as data, unread rules, the regex guard

- *Superseded:* the regex guard is gone with the patterns; nothing in a standard runs.
- **Every rule is fenced as data in a fix's prompt, not only a repository's.** The assignment (`AssignedRule`, `ui/src/assign/model.ts`) doesn't carry where its standard lived, and threading it through would touch the queue; a rule that describes a ticket loses nothing by being read as a description. The rules sit between `<<<TICKET_RULES` and `TICKET_RULES>>>`, after the task, which names the fence and calls it data; every fence's markers are taken out of rule and item text alike, and a rule that asks for anything but text is an `INJECTION:` line. Where: `ui/server/assign/prompts.ts`.
- **A repository standard that takes a built-in's name is set aside, with a warning**, rather than kept beside it: two standards answering to "gherkin" would need a second name everywhere a rule is addressed (`?rule=gherkin/scenarios`, an assignment's rule), and refusing is one check. The built-in is used and `STANDARD_SHADOWS_BUILTIN` names the file and suggests `team-<name>`. Your own folder may still replace a built-in, as your config replaces a default; a file named by path keeps its own name, since it was named on purpose. Where: `src/core/standards/catalog.ts`.
- *Superseded by the plain-text rework above:* `unread` now means a rule not judged yet or judged unsure ("Rules unknown").
- *Superseded by the plain-text rework above:* a rule never blocks now, so the Blocked figure is always exact.
- **toil's rule warnings ride on the reading** (`RulesReading.warnings`), in toil's words, as well as on `RulesView`; the readiness tools return them as `ticketRuleWarnings`. Where: `ui/src/rules.ts`, `ui/src/model/readiness.ts`.
- *Superseded by the plain-text rework above:* there is no check to keep; verdicts are kept per item and rule in the cache.
- **A view transition's update waits one task, not two frames**: Chrome holds `requestAnimationFrame` back inside the update callback, so a drill-in froze for the transition's 4 s timeout (measured 4,040 ms in headless Chrome; 50 ms after, the whole transition about 395 ms). The fallback without View Transitions keeps its two frames. Where: `ui/src/motion.ts`.
- **A due date ends with its day**: overdue and the plan use the end of the due date (UTC, like every date here), and what waits on an item starts when that item's due day ends. Where: `ui/src/model/gantt.ts` (`dueEnd`).
- **Motion gets a fourth level, "Full, no effects", for a theme with particles**, where Crate starts (its particles default off), so the select never says Full while the effects are off and picking Full turns them on. Where: `ui/src/motion.ts` (`motionLevel`, `motionLevels`, `setMotionLevel`), `ui/src/views/settings/Motion.tsx`.

## The review round on plain-text rules (2026-11-20)

The maintainer's decisions, applied:

- **"Doesn't apply" with no evidence counts as unknown for readiness**, like unsure or not judged, never as neutral, so it never helps an item reach Ready. The verdict itself is kept and shown as the agent's word, with a tag "Counts as unknown: no evidence" and the sentence one press in. Evidence is a quote Toil UI verified in the item's own words, or a quote that is exactly the item's type or one of its labels (`quoteNamesTag`); the default taken where unsure is the simplest reading, no verified quote means unknown, so a quote too short or not found leaves a "doesn't apply" without evidence. The judge prompt asks for that evidence, and the sample's script names the item's type. Tickets' lines count such a verdict as unsure, as readiness does. Where: `countsAs` in `ui/src/model/readiness.ts`, `readJudgement` and `ruleLines` in `ui/src/rules.ts`, `ui/server/assign/prompts.ts`.
- **An agent judging its own fix is accepted as is.** Sync and judge again asks the person's agent to judge the rules on the item it may just have rewritten; nothing changes for that, since a person presses for it, reads the verdict as the agent's reading, and decides.
- **Choosing a Toil project's rule sets is a person's.** `toil projects standards set` is `cli-only` and in `PERSON_COMMANDS` (`src/api.ts`), so MCP never serves it and the API runs it only for a `person`, which is how Toil UI's Settings (`CONFIG_COMMANDS`) runs it, as `standards save` and `remove` are. Its `offMcpWhen` refusal of `--clear` is gone, since nothing that refused is left to serve: a person may clear the list from Settings, where **No rule sets** and **Use no rule sets** send `--clear`. The `STANDARDS_NONE` warning an agent reads now says a person names the rules, in Settings or their own terminal. CLAUDE.md principle 2 records it.
- **The other conventions stay**: a missed rule stays thin and never blocks, and `standards save` keeps create-or-replace with no `--replace`.

Defaults chosen for the code, screen and docs findings:

- **One press per Toil project claims its slot before the first await**, with `judge()` holding it in a `try/finally` around the rest; while the press reads its rules the slot's `by` reads "Your AI agent", replaced by the agent's label once known.
- **A quote supports a verdict only at three words or fifteen characters** after normalising (`MIN_QUOTE_WORDS`, `MIN_QUOTE_CHARS`), the review's example taken as is. A too-short quote is dropped with a note: a "met" becomes unsure, a "missed" keeps its verdict (an absence needs no quote), and a "doesn't apply" is left without evidence. The type-or-label exception applies to "doesn't apply" only.
- **Quotes are checked against the item's own words only** (`itemEvidence`): its title, labels, description and field values, each part apart so a quote can't run from one into the next, never the labels `itemText` writes around them. The agent still reads `itemText`. A quote is verified in full and cut to 300 characters only for display.
- **A verdict is keyed on the hash of the item's text alone**, never `updated`, which stays put when a description or an acceptance field is read later. Cached verdicts keyed on `updated` no longer match and read as not judged yet, once.
- **A press stops between batches** when cancelled or at the time limit, and a press whose signal was aborted before it began judges nothing; both say how many items are left.
- **`removeOwn` removes the named entry**, after validating what it points at: a link `a.json` → `b.json` removes `a.json` and leaves `b.json`. The test is skipped on Windows, where a file symlink needs a privilege, and says so in its name.
- **`toilProjectFor` takes the command to name in its fix**, `toil classify` by default, `toil standards list` from standards.
- **Settings, Ticket rules leads with the rule set picker**, titled "Rules a Toil project uses"; the library is a closed "Your rule sets" disclosure in one panel, with New set of rules at its top and each set a section in it, so each set shows once at the first level. A failed read of the Toil projects or of one Toil project keeps a failed state with toil's message and fix, and a thrown call is caught, never "Reading …" for ever. No Toil project offers **Create a Toil project** (`#/settings/projects/+new`). "No rule sets" is a checkbox beside the sets, checked when none is chosen, and Save reads **Use no rule sets** then. A set's card shows **Yours** or **Built in** (a repository's or a file's keep their words) with the revision in the badge's tooltip. Edit, Remove, Remove this rule and Cancel are framed secondary buttons; Add a rule and Remove this rule start at the control column. The Instructions hint is one line above the rules, the "Edit a copy" explainer an (i) beside "Editing X". A new rule's id follows its name until the set is saved; a saved rule keeps its id.
- **The item page's rule rows** lead with missed, unsure and not-judged rows, and fold met and doesn't-apply (with evidence) rows into one line ("2 rules met · 3 rules don't apply"), as the passing checks fold. A row keeps "(X's reading, date)" inline and its source becomes "From <set>" in plain type one press in. A tag on the row ("Kept as unsure: quote not found", "quote too short", "no quote", "Counts as unknown: no evidence") stands for the note, whose sentence is one press in. The panel's (i) is plain words with Read more.
- **On Tickets, the agent's results are "readings"** everywhere on screen and "Verdict" stays the code-worked column; the card's footer sentence became an "AI agent's reading" badge beside the heading, the sentence in the heading's (i); "Why not ready" keeps the checks' figure ("1 check missed", "Checks pass") with a badge for the rules ("1 rule missed", "Rules unknown"). After a press the status is a compact figure ("Judged 1 · 5 unchanged · 2 left") with the sentence in its title; with no agent, or one that can't run, **Choose an AI agent** opens Settings, AI agent.
- **The Summary's badge reads "Worked out by code"**, its tooltip "Worked out by code, no AI", so it can't be read as covering the ticket rules.
