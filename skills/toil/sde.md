---
area: sde
description: Projects, countermeasures (tasks), threats and users on SD Elements, read through its REST API v2
---

# SD Elements (`sde`)

Projects, countermeasures (tasks), threats and users on **SD Elements**, through its
REST API v2 (`/api/v2/...`). Every command reads; none changes anything.
Verification level: `unit`.

**Supported versions:** The oldest SD Elements version toil supports hasn't been established. toil
calls `/api/v2/` with an API token sent as `Authorization: Token`. `server-info`
reports the version but needs a super-user, so toil makes no version check. No
release has been verified yet.

## Credential

An SD Elements **API token**: in SD Elements, your user menu → API Tokens. toil sends
it as `Authorization: Token <token>`. There is no username, password or browser
login, and no CI fallback variable.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `connectionString` | `TOIL_SDE_CONNECTION_STRING` | yes | API token and server host in one value, `<token>@<host>` |
| `project` | `TOIL_SDE_PROJECT` | no | Default project ID for `project get`, `task list`, `task get` and `threat list` |

**The connection string** holds both the token and the host:
`abc12345@sde.imagile.dev`, or `abc12345@imagile.sdelements.com` for a hosted
tenant. toil splits it at the first `@`, and the host gets `https://` unless it
already has a scheme (`abc12345@https://sde.imagile.dev/sde` keeps a context path).
A value with no `@`, or with `@` first, sets nothing, and commands fail with
`NOT_CONFIGURED`. An env value beats the config file.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_SDE_CONNECTION_STRING=<your API token>@sde.imagile.dev
```

Or `~/.toil/config.json`, with `project` usually set once under `defaults.sde`:

```json
{
  "version": 2,
  "connections": {
    "corp-sde": { "area": "sde" }
  },
  "defaults": { "sde": { "connection": "corp-sde", "project": "42" } }
}
```

The connection string holds the token, so it never goes in this file; a plaintext
one there is refused with `CONFIG_INVALID`. Run `toil connections add corp-sde --area sde`
(or `toil connections login corp-sde` for an existing connection) to keep it in the
OS credential store, or set `TOIL_SDE_CONNECTION_STRING`.

## Commands

The project ID comes from `--project <id>` (or the `[id]` argument of `project get`), else the
connection's `project` (usually `defaults.sde.project`). With neither, the command
fails with "No project specified"; anything but a positive whole number fails with
"Invalid project ID". Both happen before any request.

- `server-info`: Get server version and platform info. SD Elements answers only a
  super-user.
- `whoami`: Get current authenticated user (`/api/v2/users/me/`).
- `user list`: List users (`--email`, `--first-name`, `--last-name`, `--active true|false`).
- `project list`: List projects (`--name`, `--search`, `--active true|false|all`,
  `--ordering`, `--expand`, `--include`).
- `project get [id]`: Get a single project by ID (`--expand`, `--include`). Without
  `id`, the project comes from `--project`, then the connection's `project`.
- `task list`: List countermeasures for a project (`--phase`, `--priority`, `--status`,
  `--assigned-to`, `--source`, `--verification`, `--tag`, `--accepted`, `--relevant`,
  `--expand`, `--include`).
- `task get <task>`: Get a single countermeasure. Pass the composite ID
  from `task list` (`id`, such as `42-T21`); the value goes into the path as one encoded segment,
  with no prefix added, so the bare `task_id` (`T21`) asks for a different path and SD Elements likely answers
  `NOT_FOUND`.
- `threat list`: List threats for a project (`--severity`, `--search`, `--ordering`,
  `--capec-id`, `--component-id`).

Only `--active` is checked; every other filter goes to the server as given.

`user list`, `project list`, `task list` and `threat list` page with `--page` (default 1) and
`--page-size` (default 100), each a positive whole number; `data` is then SD
Elements' own page, `{ count, next, previous, results }`, with `next` and `previous`
passed through as the server's URLs. `--all` ignores both and fetches every page,
100 at a time, until `count` is reached or a page comes back empty; `data` is then
one bare list of results. `--all` also stops with an error after 1,000 pages
(100,000 items), and like every command it's subject to toil's time limit
(`TOIL_TIMEOUT_MS`, 120 s by default).

Over MCP the same commands are tools named after the path, with spaces and hyphens
as underscores (`sde_project_get`, `sde_task_list`), taking camelCase fields named
after the arguments and flags (`id`, `task`, `project`, `pageSize`).

```bash
toil sde whoami
toil sde project list --active true --all
toil sde task list --project 42 --phase development --page-size 50
toil sde task get 42-T21 --project 42 --expand status,phase
toil sde project get 42 --include task_counts
```
