---
description: What every toil command shares, in detail - the envelope and errors, --select, toil wait, paging, writes and their exceptions, global flags, files and the workspace, configuration, the raw API passthrough, dossiers, the audit log, certificates and proxies
---

# Using toil

`SKILL.md` has the rules every call needs. This page has the detail behind them, for
when a call needs more than a command's own flags.

## The envelope and errors

Every command prints one JSON envelope on stdout: `{ ok, data, error, meta }`.
Check `ok`; on failure, `error.code` says what kind of failure it was and `error.fix`
says what to do about it. New codes may appear in any release, so treat a code you
don't know as a generic failure. `meta.warnings` lists anything worth knowing that
isn't a failure, such as a truncated result. `meta.context` says which connection a
call used and how it was chosen, and where any project, repo or environment it
resolved came from. `--pretty` formats the output for people.

## Paging

Paged results put the next page's cursor in `meta.page.nextCursor` (null on the last
page) and the page size in `meta.page.limit`. Pass the cursor back with the
command's own paging flag, which its reference names.

## Selecting fields

To get back only the fields you need, pass `--select <expression>` (`select` over
MCP), a [JMESPath](https://jmespath.org/specification.html) expression applied to
`data`, for example `--select "issues[].{key: key, status: fields.status.name}"`.
`meta`, including `meta.page`, is left as it is. A bad expression is `INVALID_INPUT`
before the command runs, with its position in `error.fix`; one that selects nothing
gives `data: null` and a `SELECT_EMPTY` warning.

## Waiting for something to finish

To wait for a build, a scan or a deployment to finish, don't call a read in a loop:
`toil wait --until "<expression>" -- <read command>` runs it again every `--interval`
(default 15s, at least 5s) until the JMESPath expression over its `data` is true (not
null, false or empty), for example
`toil wait --until "result != null" -- jenkins pipeline get-run --name my-job --number 42` or
`toil wait --until "projectStatus.status != 'NONE'" --timeout 10m -- sonar quality-gate --project my-app`.
Over MCP it's the `wait` tool, with `tool` (the read's tool name), `input` (that tool's
input) and the same `until`, `interval` and `timeout`. It returns the read's last
envelope plus `meta.wait` (`until`, `attempts`, `elapsedMs`). `NETWORK` errors and
`HTTP` 5xx or 429 answers are retried with backoff; any other error ends the wait with
that error. Past `--timeout` (at least 5s; default 30m, or `TOIL_TIMEOUT_MS`, cut to the maximum
with a `WAIT_TIMEOUT_CAPPED` warning when it is longer; at most the
`"wait": { "maxTimeout" }` in config, default 1h) it's `TIMEOUT`, with the last `data`
in `error.details.data`. Only reads can be waited on: a write is `INVALID_INPUT`.
`--select` before `wait` applies to the final `data`; a `--select` after `--` belongs
to the read, so `--until` sees what it selected. Other global flags go before `wait`.

## Writes

Reads are always allowed. A command that changes something, in a service, a database
or a file on this machine outside toil's own config, needs both `writes: true` on the
connection it uses, set by a person in their config or with a
`TOIL_CONN_<NAME>_WRITES` / `TOIL_<AREA>_WRITES` env var, and `--allow-write` on the
call (`allowWrite: true` over MCP). Without either it fails with `WRITE_DISABLED`,
naming what's missing. Over MCP a write tool isn't listed until writes are on, and
deletes are never tools. A command that is CLI only and has no connection yet
(`toil skills marketplace add`) needs `--allow-write` alone.

### Exceptions

Exactly three writes don't follow that rule. Each is the maintainer's choice, made
deliberately, and is listed here with how to avoid it.

| Write | What it writes, and when | Why | To avoid it |
|-------|--------------------------|-----|-------------|
| **`toil skill install`** | With `--allow-write` alone (CLI only, no connection): the toil skill, into one agent's skills folder as `toil/`, recorded as `bundled`. | Its contents are fixed: the files embedded in toil, no third-party code. It replaces only a `toil/` folder it recorded as `bundled` and refuses any other. | Don't run it. |
| **The toil skill keeping itself current** | With no `--allow-write`: a `toil/` skill folder recorded as `bundled`, and nothing else in a skills folder (never a marketplace or hand-made skill). Rewritten by any command that loads config, on the CLI or over MCP, when that command changed the config file (a connection added, changed or removed) or when the copy was written by another toil version. Said in `meta.warnings` as `SKILL_REWRITTEN`. | So an installed skill never describes connections you no longer have, or a toil you no longer run, with no update command to forget. The contents are fixed; the description holds only area and engine names checked against toil's own list, never a host or a credential; and a rewrite that fails is a `SKILL_REWRITE_FAILED` warning, never a failed command. | Don't install the skill with `toil skill install` (copy `skills/toil` yourself, or use the Claude Code plugin marketplace), or delete the installed `toil/` folder. A call with `--config <file>` never rewrites it. |
| **The welcome menu's game save** | With no `--allow-write`: the game's progress, under the `"game"` key of `~/.toil/config.json`, every other key kept as it was. Only while you play Two Weeks' Notice in the menu bare `toil` opens. | It's a game a person plays at a terminal, and its save touches nothing but its own key. The save is sealed against tampering, not kept secret. | Don't play it. There is no setting to turn the save off. |

## The raw API passthrough

For an endpoint no command covers, an HTTP area has `toil <area> api <METHOD> <path>`
(`<area>_api` over MCP), which sends the connection's own credential to a path under
its base URL. GET and HEAD are reads; other methods are writes, and `DELETE` is CLI
only. The area's reference describes it where the area has one (`jira.md`).

## Files and the workspace

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

## Configuration

Configuration comes from environment variables, which always win, or from
`~/.toil/config.json` (or the file passed with `--config`). A connection is one
instance of an area; `--connection <name>` picks one when there are several.
`toil connections list` names them (never a secret), and `toil connections test
<name>` checks one with a single authenticated read, failing with the `AUTH`,
`NETWORK` or config error a real command would. Setting up a connection, signing
in, turning writes on and choosing a default are for a person: a bare `toil` in a
terminal opens a menu for them.

## Global flags

Global flags go before or after the command: `--pretty`, `--verbose` (adds every
request to `meta.requests`, credentials redacted), `--debug` (traces on stderr),
`--config <file>`, `--output-file <file>` and `--workspace <dir>`. `--help` on any
command lists its own flags.

## Dossiers

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
- `toil <area> check-dossier` checks a section against the service, for the call's
  environment (jira, jira-cloud, confluence, sonar, ado, bitbucket, github, openshift,
  dynatrace).
- `toil dossiers export <name> --repo <root>` writes a shareable copy into a
  repository's `.toil/dossiers/`. It uses host selectors and no local paths, and toil
  never commits it.
- `toil dossiers unlink <name> --area <area> [--env <env>]` removes a section (CLI only).
- `toil dossiers import <file>` copies a teammate's into your own folder. A connection
  or host you lack is listed under `toSetUp`; toil never creates one.

These are local writes and need no `--allow-write`. Each refuses a value that's already
set unless `--replace`. Over MCP they refuse to make a dossier select a connection
with writes on; the user does that on the command line, or under **Dossiers** in the
menu bare `toil` opens, which runs these same commands and asks them to type the
connection's name first.

## The audit log

toil keeps a local audit log of every command it runs, through the CLI and MCP:
one JSON line per call in `~/.toil/audit/<yyyy-mm>.jsonl`, with the command, front
door, connection, whether it wrote, the outcome, the redacted input and each request's
method, URL and status. It never holds a secret, a header, a body or a row, and `db`
SQL is kept only as a SHA-256 hash. `toil audit list` reads it back, newest first,
with `--since <date>`, `--command <name|area>`, `--connection <name>` and
`--writes-only`; `toil audit path` says where it is and whether it's on. Six months are
kept by default (`"audit": { "keepMonths": 12 }` changes that), and only a person can
turn it off, with `"audit": { "enabled": false }` in `~/.toil/config.json`. A call
whose line couldn't be written still succeeds, with an `AUDIT_WRITE_FAILED` warning.

## Certificates and proxies

toil trusts the OS certificate store and Node's bundled CAs, and uses `HTTPS_PROXY` /
`HTTP_PROXY` / `NO_PROXY` when they're set. A `NETWORK` error about an untrusted
certificate means the CA is in neither; `NODE_EXTRA_CA_CERTS` adds it.
