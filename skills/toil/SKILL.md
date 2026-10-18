---
name: toil
description: Use toil, a structured-JSON CLI and MCP server, to read from and (when allowed) write to databases and the enterprise tools an organization runs, such as issue trackers, source hosts, wikis, CI, artifact repositories, scanners and observability. Use when a task needs data from one of those tools or a database, or mentions `toil` commands, `toil mcp`, a toil connection, or a TOIL_* environment variable.
---

# toil

Every command prints one JSON envelope on stdout: `{ ok, data, error, meta }`.
Check `ok`; on failure, `error.code` says what kind of failure it was and `error.fix`
says what to do about it. Paged results put the next page's cursor in
`meta.page.nextCursor` (null on the last page). `meta.context` says which connection
a call used and how it was chosen, and where any project, repo or environment it
resolved came from. `--pretty` formats the output for people.

To get back only the fields you need, pass `--select <expression>` (`select` over
MCP), a [JMESPath](https://jmespath.org/specification.html) expression applied to
`data`, for example `--select "issues[].{key: key, status: fields.status.name}"`.
`meta`, including `meta.page`, is left as it is. A bad expression is `INVALID_INPUT`
before the command runs, with its position in `error.fix`; one that selects nothing
gives `data: null` and a `SELECT_EMPTY` warning.

Each area is reachable two ways with identical inputs and output: on the command
line as `toil <area> <command>`, and as MCP tools from `toil mcp --areas <area>`
(tool names are the command path with underscores, e.g. `db_query`).

Reads are always allowed. A command that changes data needs `writes: true` on the
connection, set by a person in their own config or environment, and `--allow-write`
on the call (`allowWrite: true` over MCP). Over MCP, write tools aren't listed until
writes are on. Only make a write the user asked for.

For an endpoint no command covers, an HTTP area has `toil <area> api <METHOD> <path>`
(`<area>_api` over MCP), which sends the connection's own credential to a path under
its base URL. GET and HEAD are reads; other methods are writes, and `DELETE` is CLI
only. The area's reference describes it where the area has one (`jira.md`).

Files a command reads or writes (an `--input-file`, an upload, a download, a CSV
report) must be inside the workspace: `--workspace <dir>`, else `TOIL_WORKSPACE`,
else the working directory; under `toil mcp`, the client's root when it shares
exactly one. Relative paths resolve against it, a path outside is refused with
`INVALID_INPUT`, and nothing is ever overwritten. Under `toil mcp` with no single
root, a command that touches a file returns `NOT_CONFIGURED`: add `--workspace <dir>`
to the server's args. A person can let commands reach any path with
`"bounds": { "files": "unbounded" }` in their config, and every envelope then
carries a `BOUND_RELAXED` warning. Saved paths come back absolute, with forward
slashes. Commands that run git need git on PATH and say
`GIT_NOT_FOUND` without it; nothing else does.

Configuration comes from environment variables, which always win, or from
`~/.toil/config.json` (or the file passed with `--config`). A connection is one
instance of an area; `--connection <name>` picks one when there are several.

toil trusts the OS certificate store and Node's bundled CAs, and uses `HTTPS_PROXY` /
`HTTP_PROXY` / `NO_PROXY` when they're set. A `NETWORK` error about an untrusted
certificate means the CA is in neither; `NODE_EXTRA_CA_CERTS` adds it.

## Areas

Each area has its own reference beside this file, named after it: `jira.md` for
`toil jira …`, `db.md` for `toil db …`. Open the one for the area you need; its
frontmatter says what the area covers, and the file lists the oldest server version it
supports, its credential, its configuration keys and every command. `toil --help` lists
the areas this install has.
