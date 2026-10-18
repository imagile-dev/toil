---
name: toil
description: Use toil, a structured-JSON CLI and MCP server, to read from and (when allowed) write to databases and the enterprise tools an organization runs, such as issue trackers, source hosts, wikis, CI, artifact repositories, scanners and observability. Use when a task needs data from one of those tools or a database, or mentions `toil` commands, `toil mcp`, a toil connection, or a TOIL_* environment variable.
---

# toil

If `toil version` doesn't print an envelope, toil isn't installed yet: `install.md`,
beside this file, says how.

## Every call

- **Output.** Every command prints one JSON envelope on stdout: `{ ok, data, error,
  meta }`. Check `ok`; on failure, `error.code` says what kind of failure it was and
  `error.fix` what to do about it. `meta.warnings` lists what's worth knowing that
  isn't a failure, and `meta.page.nextCursor` the next page, when there is one.
- **Two front doors, one command.** `toil <area> <command>` on the command line, or
  the MCP tool named after its path (`db_query`) from `toil mcp --areas <area>`, with
  identical inputs and output.
- **Writes.** Reads are always allowed. A command that changes data needs
  `writes: true` on the connection, set by a person, and `--allow-write` on the call
  (`allowWrite: true` over MCP). Only make a write the user asked for.
- **Connections.** Environment variables always win over `~/.toil/config.json`.
  `--connection <name>` picks one when an area has several; `toil connections list`
  names them, never a secret. Setting one up is for a person: a bare `toil` in a
  terminal opens a menu for them.
- **Files** a command reads or writes stay inside the workspace (`--workspace <dir>`,
  else the working directory).
- **Less output.** `--select <expression>` keeps only the fields you name, and
  `toil wait --until <expression> -- <read>` repeats a read until it's true, instead
  of polling yourself.

## Where to look

Open only the file the task needs; each sits beside this one.

| File | When |
|------|------|
| `core.md` | `--select`, `toil wait`, paging, errors, global flags, files, configuration, the raw `api` passthrough, dossiers, the audit log, certificates and proxies |
| `<area>.md` | One per area, named after it: `jira.md` for `toil jira …`. Its frontmatter says what the area covers; the file gives the oldest version it supports, its credential, its configuration keys and every command |
| `db.md` | Databases: `toil db …` on every engine |
| `util.md` | Local utilities with no connection or network: `toil util …` |
| `skills.md` | Skills marketplaces, and keeping this skill installed |
| `mcp.md` | Running toil as an MCP server and registering it with an agent |
| `install.md` | Installing toil, and this skill |

`toil --help` lists the areas this install has.
