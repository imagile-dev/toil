---
area: sample
description: A sample software team to try toil with, two teams and an AI agent over six sprints and three releases, as Open Work Items, a toil project and the pull requests behind them, generated with no connection and no sync
---

# A sample team (`sample`)

`toil sample team` generates a web shop's software team as sample data, so toil, `toil classify run`, `toil projects brief` and Toil UI can be tried on a fresh install before any connection is set up. It asks no service, reads no config, and has no connection, no credential and no `TOIL_SAMPLE_*` variable. Verification level: `unit`. Every host, name and address in it is a placeholder.

| Command | MCP tool |
|---------|----------|
| `toil sample team` | `sample_team` |

## What it holds

Nine people in two teams (Storefront and Platform, one of them an AI agent), about 140 Jira work items in project `SHOP` (one initiative, five epics, stories, tasks, bugs, incidents and sub-tasks), six two-week sprints (five closed, `Sprint 26` current, on its seventh working day of ten), three releases (2.3 shipped, 2.4 due in eleven days with scope added after it started, 2.5 ahead), five components, and sixteen pull requests in `imagile/shop` (open ones waiting on review, one behind failing checks, two from a dependency bot and one from an agent). Each item has a status history. The work mix is about a half feature and a third keep-the-lights-on, with the rest unsure under the built-in `ktlo-feature` scheme.

Every date is an offset from one day, `--as-of`, so the sample is always current. The same day gives the same bytes.

## `toil sample team`

```bash
toil sample team [--as-of <time>] [--part owi|toil-project|jira|prs|facts]
toil sample team --out <dir> [--as-of <time>]
```

| Flag | Meaning |
|------|---------|
| `--as-of <time>` | The day the sample is current on, an ISO time. Default: now. Only its UTC date is used. |
| `--part <part>` | What to print. `owi` (the default) is Open Work Items and changes, in the shape `toil util owi map` returns, so it pipes into `toil classify run` and `toil projects brief`. `toil-project` is the toil project file's content, `jira` is what `toil jira issue search --changelog` prints, `prs` is what `toil github pr get --include reviews,checks,commits,files` prints for each pull request, and `facts` is the counts, sprints, releases and classification the documentation quotes. |
| `--out <dir>` | Write `sample-team.owi.json` and `sample-team.project.json` into this folder inside the workspace instead of printing. It never replaces a file, and writes neither if either exists. Takes no `--part`. |

`--out` is a local write inside the workspace and needs no `--allow-write`. Over MCP the same fields are `asOf`, `part` and `out`.

## Try it on a fresh install

```bash
toil sample team | toil classify run
toil sample team --out sample
toil projects import sample/sample-team.project.json
toil sample team | toil projects brief sample-team
toil sample team | toil projects pivot sample-team --split team
toil sample team | toil projects pivot sample-team --split category --across release
toil sample team | toil classify mix --toil-project sample-team
```

The `sample-team` toil project selects the connections `sample-jira` and `sample-github`, which the sample does not need: it is read only through the piped records. No command here reads from them, and nothing is written to a tracker.
