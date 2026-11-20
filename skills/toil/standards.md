---
description: Ticket rules, called standards, for how a team writes work items, such as acceptance criteria as Given/When/Then, the user-story form, and a bug's steps to reproduce. What a standard is, where standards live, the three built-in starters, saving and removing your own, and naming the ones a toil project uses
---

# Ticket rules (standards)

A **standard** is one JSON file holding one named set of rules for writing a work item. Each
rule is plain-text instructions a person writes and edits freely: "a story's acceptance
criteria are Given/When/Then scenarios", "a bug says how to reproduce it". Toil UI calls them
**ticket rules**.

toil keeps and lists the rules; it never judges one. Whether an item meets a rule, and whether
a rule applies to it at all, is an AI agent's reading: Toil UI hands the rules and the item's
text to your own agent when you press **Check with AI agent**. To judge rules yourself from a
terminal or an agent, read them with `toil standards list` and the items with the tracker's
own commands.

No standard applies until a toil project names it: which rules a team's tickets are held to
is the team's call.

## A standard

```json
{
  "name": "team-stories",
  "revision": 1,
  "description": "How the payments team writes a story.",
  "rules": [
    {
      "id": "scenarios",
      "name": "Acceptance criteria as Given/When/Then",
      "text": "This rule is for stories. For any other kind of item, it does not apply.\nThe acceptance criteria are written as one or more scenarios, each with a Given, a When and a Then line."
    }
  ]
}
```

- **`name`** is lowercase letters, digits and single hyphens, and in a standards folder it is
  the file's name (`team-stories.json`). `revision` is a whole number (default 1);
  `description` one line of at most 300 characters.
- **`rules`**: 1 to 50. Each has an `id` (unique in the standard), a `name` (a few words a
  screen shows, one line, at most 120 characters) and `text`: the instructions, at most 2,000
  characters, with line breaks and tabs allowed. Say in the text which items the rule is for
  ("This rule is for bugs."): the agent decides whether a rule applies to an item from what
  the text says.
- A standard holds no secret, host, connection or `writes`; text shaped like a credential is
  refused, and so is any control character but a line break or a tab. A rule's text reaches an
  AI agent only as data inside a fence beside the item, never as its instructions.
- A file in the shape ticket rules had before they became plain text (a rule with `check`,
  `when`, `fail` or `missing`) is refused with `CONFIG_INVALID` and a fix: keep `id`, `name`
  and `text`, and write what the check said into the text in plain words.

### The built-in starters

| Name | Rules |
|------|-------|
| `gherkin` | `scenarios`: a story's acceptance criteria are Given/When/Then scenarios |
| `user-story` | `story-form`: a story's description opens "As a …, I want …, so that …" |
| `bug-repro` | `steps`, `expected`, `actual`: a bug says how to reproduce it, what should happen, and what happens instead |

They are starting points: `toil standards list` prints their text, and saving an edited copy
under the same name makes it yours (`toil standards save gherkin --input-file …`).

### Where standards live

Looked up by name in this order, the first found winning: your own folder
(`~/.toil/standards/<name>.json`), the repository the folder is in (`.toil/standards/<name>.json`),
then the built-ins. Your own folder may replace a built-in; a repository's file with a built-in's
name (`.toil/standards/gherkin.json`) is set aside for the built-in, with a
`STANDARD_SHADOWS_BUILTIN` warning, so name a team's version something else (`team-gherkin`).
A toil project may also name a file by a path relative to its own file (`./rules/team.json`).
A team's shared file is written by hand and checked in; toil writes only your own folder.

## Commands

| Command | Flags | What it does |
|---------|-------|--------------|
| `toil standards list` | `--cwd`, `--toil-project` | Every standard visible by name, each from its highest place, with its rules' text; or, with `--toil-project`, the ones that toil project names, in its order |
| `toil standards save <name>` | `--input-file`, `--text` | Save one of your own standards to `~/.toil/standards/<name>.json`; CLI only |
| `toil standards remove <name>` | | Remove one of your own standards; CLI only |
| `toil projects standards set <toil-project>` | `--use`, `--replace`, `--clear` | Name the standards a toil project's work is held to, or none with `--clear`; CLI only |

### `standards list`

```bash
toil standards list --toil-project payments
```

```json
{
  "toilProject": "payments",
  "standards": [{ "name": "gherkin", "revision": 2, "source": "built-in", "description": "…", "rules": [{ "id": "scenarios", "name": "Acceptance criteria as Given/When/Then", "text": "…" }] }]
}
```

Without `--toil-project`, `toilProject` is `null` and every standard toil can see is listed.
With it, a toil project that names none lists none, with a `STANDARDS_NONE` warning; one that
names a standard twice lists it once, from the first, with a `STANDARDS_DUPLICATE` warning; a
standard it names that can't be read stops the listing (`NOT_FOUND` or `CONFIG_INVALID`), so
work is never held to fewer rules than the toil project says.

### `standards save` and `standards remove`

```bash
toil standards save team-stories --input-file rules/team-stories.json
toil standards remove team-stories
```

`save` reads a standard (`{ "description", "rules" }`; a `name`, if given, must be the one
saved) and writes it to your own folder. The revision counts saves: 1 for a new standard, one
more than the copy it replaces otherwise, whatever the file says; the same content again writes
nothing (`STANDARD_UNCHANGED`). `remove` deletes only a valid standard in your own folder, and
says what the name means afterwards (a repository's or the built-in standard of that name,
`STANDARD_NOW_FROM`). Both are a person's commands: the rules are what an AI agent's verdicts
are held to, so they are never served over MCP. Toil UI's Settings runs them for you.

### `projects standards set`

```bash
toil projects standards set payments --use gherkin --use user-story --use bug-repro
toil projects standards set payments --use ./rules/team.json --use gherkin --replace
```

It writes the toil project's `standards` key, `{ "use": [...] }`: at most 20 standards, each
once, each a name or a path relative to the toil project ending `.json`. A different list
already there is refused unless `--replace`, which replaces it whole. A standard that can't be
read yet is set anyway, with a `STANDARD_UNRESOLVED` warning. `--clear` removes the key, so no
standards apply. The key holds no connection, host or `writes`. Choosing which rules an AI
agent's work is judged by is a person's call, so this is a person's command too: never served
over MCP, and run for you by Toil UI's Settings, Ticket rules, where you may also choose no rule
sets at all.
