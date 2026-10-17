---
name: toil
description: Use toil, a structured-JSON CLI and MCP server, to read from and (when allowed) write to databases and enterprise tools. Use when you need to list schemas or tables, describe a table, preview rows or run SQL against a configured database, read or change Jira Data Center issues, search with JQL, or work with sprints, comments, worklogs and attachments, or when a task mentions `toil` commands, `toil mcp`, a toil connection, or a TOIL_* environment variable.
---

# toil

Every command prints one JSON envelope on stdout: `{ ok, data, error, meta }`.
Check `ok`; on failure, `error.code` says what kind of failure it was and `error.fix`
says what to do about it. Paged results put the next page's cursor in
`meta.page.nextCursor` (null on the last page). `--pretty` formats the output for
people.

Each area is reachable two ways with identical inputs and output: on the command
line as `toil <area> <command>`, and as MCP tools from `toil mcp --areas <area>`
(tool names are the command path with underscores, e.g. `db_query`).

Reads are always allowed. A command that changes data needs `writes: true` on the
connection, set by a person in their own config or environment, and `--allow-write`
on the call (`allowWrite: true` over MCP). Over MCP, write tools aren't listed until
writes are on. Only make a write the user asked for.

Configuration comes from environment variables, which always win, or from
`~/.toil/config.json` (or the file passed with `--config`). A connection is one
instance of an area; `--connection <name>` picks one when there are several.

| Area | Reference | Covers |
|------|-----------|--------|
| `db` | [db.md](db.md) | Databases (SQLite): schemas, tables, describe, preview, read-only queries with paging, gated writes |
| `jira` | [jira.md](jira.md) | Jira Data Center: issues, JQL search, transitions, comments, worklogs, labels, links, attachments, custom fields, boards and sprints |
