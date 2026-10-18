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

A **dossier** holds what toil knows about one body of work: its repositories, and per
area the keys a call needs (`project`, `owner`, a namespace per environment), which
connection to use (by name, or by `host`), and reference data such as board lists.
It holds no secret and can't add a host or turn on writes. toil reads dossiers on
every area command from `~/.toil/dossiers/`, the folders in `dossierPaths` (or
`TOIL_DOSSIER_PATHS`), and `.toil/dossiers/` in the repository you're in, and uses
the one that applies: `--dossier <name|file>` (`dossier` over MCP, or
`TOIL_DOSSIER`), else the one whose repo matches the folder by path or `origin`
remote. `--cwd <dir>` (`cwd` over MCP) looks from another folder. A value you pass
always beats the dossier's, and `meta.context.dossier` says which dossier applied and
why. When two different dossiers match, the call fails with `INVALID_INPUT` until you
pick one. A write on a connection a dossier chose is `WRITE_DISABLED` unless the
dossier is in your own folder; pass `--connection` to choose it yourself. To see what
a call will use before making it: `toil dossiers context` (which dossier a folder
resolves to and why), `toil dossiers show [name]` (per area: the connection and why,
whether writes are on, the environment and the inputs), `toil dossiers list`, and
`toil dossiers check [name]`, which checks one locally and contacts no service.

To build one for a product: `toil repos scan` lists the git repositories under the
workspace. Then:
- `toil dossiers init <name>` creates the dossier.
- `toil dossiers add-repo <name> <folder|remote>` adds each repository.
- `toil dossiers link <name> <area> --host <host> --set project=PAY [--for-repo <repo>]`
  says which connection an area uses and the keys it supplies.
- `toil dossiers env <name> <env> <area> --set namespace=...` adds an environment.
- `toil dossiers field <name> jira storyPoints customfield_10002` names a field, so
  `--field storyPoints=5` works.
- `toil <area> check-dossier` checks a section against the service (jira, sonar and
  confluence so far).
- `toil dossiers export <name> --repo <root>` writes a shareable copy into a
  repository's `.toil/dossiers/`. It uses host selectors and no local paths, and toil
  never commits it.
- `toil dossiers import <file>` copies a teammate's into your own folder. A connection
  or host you lack is listed under `toSetUp`; toil never creates one.

These are local writes and need no `--allow-write`. Each refuses a value that's already
set unless `--replace`. Over MCP they refuse to make a dossier select a connection
with writes on; the user does that on the command line.

toil trusts the OS certificate store and Node's bundled CAs, and uses `HTTPS_PROXY` /
`HTTP_PROXY` / `NO_PROXY` when they're set. A `NETWORK` error about an untrusted
certificate means the CA is in neither; `NODE_EXTRA_CA_CERTS` adds it.

## Areas

Each area has its own reference beside this file, named after it: `jira.md` for
`toil jira …`, `db.md` for `toil db …`. Open the one for the area you need; its
frontmatter says what the area covers, and the file lists the oldest server version it
supports, its credential, its configuration keys and every command. `toil --help` lists
the areas this install has.
