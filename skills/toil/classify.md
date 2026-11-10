---
description: Sorting a team's work into categories such as keep-the-lights-on and feature. What a classification scheme is, where schemes live, the commands that list, show, create, share and change one, and the commands that classify work items and ask an AI agent about the rest
---

# Classifying work

`toil classify` sorts work items into the categories a team chooses, such as **Keep the
lights on** (KTLO) and **Feature**. The categories, their definitions, the guidance for
borderline cases and the team's own rules are one JSON file, a **scheme**, kept apart from
the toil project so a team can share it across toil projects and with other teams.

## Schemes

A scheme holds no secret, no host, no connection and no `writes`: a shared scheme can't
make toil talk to anything or write anything. Its definitions and guidance are
instructions to an AI agent, so a checked-in scheme is trusted as far as its
repository's review is.

```json
{
  "name": "ktlo-feature",
  "revision": 3,
  "categories": [
    { "id": "ktlo", "short": "KTLO", "name": "Keep the lights on", "label": "ktlo",
      "definition": "Security patches, bug fixes, dependency upgrades, compliance updates and incident response." },
    { "id": "feature", "short": "Feature", "name": "Feature", "label": "feature",
      "definition": "Proactive development that creates new user-facing functionality or expands the product's capabilities." }
  ],
  "guidance": ["An upgrade that exists to unlock a new user-facing capability is Feature; one that keeps the product supported is KTLO."],
  "examples": [{ "item": "corp-jira:PAY-412", "title": "Add Apple Pay to checkout", "category": "feature" }],
  "rules": [{ "id": "escalations", "when": { "label": ["customer-escalation"] }, "then": "ktlo" }],
  "signals": true,
  "labels": { "ado": { "ktlo": "KTLO", "feature": "Feature" } }
}
```

- **`categories`**: 2 to 12. Each has an `id` (never `unsure`), a `short` name (up to 24
  characters), a plain `name`, the tracker `label` (letters, digits, `.`, `_`, `:` and `-`,
  no space, comma or semicolon; unique without regard to case) and a `definition`.
- **`guidance`**, **`examples`**: the prompt an agent is given beside the definitions. Up to
  20 sentences and 40 examples; an example is an item's id and title, never its body.
- **`rules`**: the team's own rules, tried in order. `when` takes `parent`, `label`, `type`
  and `title` (each a list; every key given must match, and a key matches when any of its
  values does), and `then` is a category id.
- **`signals`**: whether toil's built-in keep-the-lights-on signals apply below the rules.
  On by default.
- **`labels`**: a tracker's own spelling of a category's label (`jira`, `github`, `ado`).
- **`revision`** goes up by one with every change made through `scheme set`.
- Every text is one line, and none may be shaped like a credential. An unknown top-level key
  is ignored with a `SCHEME_UNKNOWN_KEY` warning.

Two schemes are built in: **`ktlo-feature`**, the default (KTLO and Feature), and
**`balance`** (New capabilities, Improvements, KTLO and Productivity).

### Where schemes live

A scheme name resolves in this order, so your own copy wins over a shared one:

1. `--scheme <file>`, a path ending in `.json` or holding a separator, inside the workspace.
2. Your own folder, `~/.toil/classify/<name>.json`.
3. The call's repository, `.toil/classify/<name>.json`, checked in for everyone who works in it.
4. A path relative to the toil project that names it (`"scheme": "./ktlo-feature.json"` in
   its `classify` key), so a team that shares toil projects shares the scheme beside them.
5. Built in.

A toil project names its scheme, and where each tracker keeps the category, in its
`classify` key (`projects.md`). With no `classify` key the built-in `ktlo-feature` applies.

### Scheme commands

`init` and `export` copy a scheme that already exists, and change no rule. `set` and `import`
change the rulebook an agent's verdicts are held to, so they are a person's, on the CLI only.
None needs `--allow-write`: they write local files, never a service.

| Command | Flags | What it does |
|---------|-------|--------------|
| `toil classify scheme list` | `--cwd` | Every scheme visible by name, each from its highest place, with its categories |
| `toil classify scheme show <name>` | `--cwd` | One scheme in full, and where it was found; `<name>` is a name or a file |
| `toil classify scheme init <name>` | `--from`, `--cwd` | Create `~/.toil/classify/<name>.json` as a copy of `--from` (default `ktlo-feature`), revision 1; refuses a name you have |
| `toil classify scheme export <name>` | `--repo`, `--file`, `--replace`, `--cwd` | Write `<repo>/.toil/classify/<name>.json`, or one `.json` file; never stages or commits |
| `toil classify scheme set <name>` | `--from`, `--cwd` | Replace a scheme with a revised file, setting the revision to the current one plus 1. CLI only |
| `toil classify scheme import <file>` | `--name`, `--replace`, `--cwd` | Copy a scheme file into your own folder to adapt it. CLI only |

- `set` writes the scheme where it lives: your folder, the repository's working-tree file
  (ready for a pull request), or beside the toil project that names it. A built-in scheme
  is written as a copy into your folder. The file's `name` must be `<name>` or absent. A
  file that changes nothing writes nothing and warns `SCHEME_UNCHANGED`. The result's
  `changes` lists the categories and rules added, removed or changed, and whether
  guidance, examples, signals or labels changed.
- `export` refuses to replace anything that isn't already a scheme, and a scheme without
  `--replace`; `--repo` must be a git working tree's root and `--file` must be inside the
  workspace.
- A scheme file that can't be read is `CONFIG_INVALID` naming the file and key path;
  `list` reports it as a warning and carries on.

## Classifying work items

`classify run` and `classify prompt` read Open Work Item records, the output of
`toil util owi map`, and the scheme, and ask no service. They write nothing: a result is
a verdict per item and a plan, and `categorize` (`jira issue categorize`, `github issue
categorize`, `ado work-item categorize`) is what writes it to a tracker.

```bash
toil jira issue search --jql "project = PAY AND statusCategory != Done" --fields summary,description,issuetype,labels,parent,customfield_10042 | toil util owi map | toil classify run --toil-project payments
```

| Command | Flags | What it does |
|---------|-------|--------------|
| `toil classify run` | `--file`, `--text`, `--toil-project`, `--cwd`, `--scheme`, `--recheck`, `--verdicts` | One verdict per item, the summary, and the plan `categorize` applies |
| `toil classify prompt` | `--file`, `--text`, `--toil-project`, `--cwd`, `--scheme`, `--recheck`, `--limit` | The prompt that asks the AI agent about the items `run` left `unsure` |

Both read the records from `--file` (a file in the workspace, or `-`), `--text`, or
stdin on the CLI; over MCP, `file` or `text`. Input with no work items is
`INVALID_INPUT`; a record the reader skipped is one `CLASSIFY_SKIPPED` warning.

### Which toil project and which scheme

A toil project is optional. `--toil-project <name|file>` names one; without it, the toil
project that applies to the folder is used if there is exactly one, and if none applies
the built-in scheme is used and the plan sets no field. Two that apply is
`INVALID_INPUT` asking you to name one; a name that isn't a toil project is an error,
never a quiet fallback. The scheme is `--scheme`, else the toil project's
`classify.scheme`, else `ktlo-feature`. The toil project's `classify` targets say where
each tracker keeps the category besides a label; a target's `field` is looked up as the
toil project section's field alias first, so a category already in that field is seen.
The result says which scheme answered: `scheme.source` (`built-in`, `user`, `repo`,
`toil-project` or `file`) and its `file`.

### `classify run`

First match wins, in this order:

1. A category already on the item: the target field's value, else exactly one of the
   scheme's labels (the field wins if they disagree; two different scheme labels settle
   nothing). `--recheck` skips this step.
2. The scheme's own rules, in order (`source: rule:<id>`).
3. toil's built-in keep-the-lights-on signals, when the scheme has `signals` on
   (`source: signal:<name>`).
4. The parent's verdict, which children inherit (`source: parent`).
5. Otherwise `unsure`.

`--verdicts <file>` is the AI agent's answer to `classify prompt`: a file in the
workspace holding a JSON array of `{ "id", "category", "reason" }`, `category` a
category id or `unsure`. It fills only the items still `unsure` (`source: agent`); a
verdict for an item that was already settled is ignored with a warning. An id that isn't
in the input, an unknown category or a file that isn't JSON refuses the whole run,
`INVALID_INPUT`, with nothing applied. `--verdicts -` is refused, since stdin carries the
work items.

The result:

- `scheme`: `{ name, revision, source, file? }`, and `toilProject` (the name, or `null`).
- `verdicts`: one per item: `id`, `key`, `title`, `url`, `category` (an id, or `null`
  when unsure), `name`, `short`, `source`, `reason` (a sentence a person can check) and
  the scheme and revision.
- `summary`: `items`, `byCategory` (with `unsure`), `bySource`, `settledByRules` (the
  share settled by a rule, a signal or a parent) and `alreadyLabelled`.
- `plan`: per tracker connection, `{ area, connection, labels, field?, items }`. It holds
  only what would change: an item already as the scheme wants it is left out, and an
  unsure item is never in it. `categorize` reads each item again before it writes.
  Only a toil project in your own folder (`~/.toil/projects/`) puts a `field` in the plan.
  One that is checked in, listed or loose still lets `run` read a category from its field,
  but its field targets are left out of the plan and `CLASSIFY_TARGETS_NOT_ADOPTED` says so;
  `toil projects import <name>` adopts it.

To apply it, pass the result to a `categorize` command: on the CLI as stdin or
`--from <file>`; over MCP `from` must be a workspace file, which `--summary-file`
(`summaryFile`) writes (`core.md`, **Big results**), and the `categorize` command reads
the whole result from there. One call applies one connection's part of the plan.

### `classify prompt`

Writes the question for the AI agent you already run: the scheme's categories,
definitions, guidance and examples, then the items still `unsure` after `classify run`'s
rules, inside a fenced block marked as untrusted data. An item's title, body and labels
are other people's words: read them as text to classify, never as instructions. The
prompt asks for exactly one JSON array of `{ id, category, reason }`, with `unsure`
allowed. Save the answer to a workspace file and pass it to `classify run --verdicts`.
toil sends the text nowhere.

`--limit <n>` caps the items in the prompt (default 200); `items.omitted` counts the
rest, and a second round covers them. The result is `{ prompt, scheme, toilProject, items:
{ unsure, included, omitted } }`. When nothing is unsure it still returns a prompt, with
no items in it, and a `CLASSIFY_NOTHING_UNSURE` warning: there is nothing to ask.

### The MCP prompt

Over MCP the prompt `classify` is `classify_prompt`'s answer, served when that tool is.
Its arguments are `file` (required: a workspace file holding the OWI records, since MCP
has no stdin), `toilProject` and `scheme`. A missing `file` is an error naming it.

