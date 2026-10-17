# SD Elements (`sde`)

Wave 2 · Integration issue #35 · Suspected bugs #86 · 8 contract commands

## Commands

All eight are top-level: `server-info`, `whoami`, `users`, `projects`, `project`, `tasks`, `task`, `threats`.

Every request is a GET under `/api/v2/`, and every path ends with a trailing slash.

## Auth

- API token, configured as one connection string rather than separate keys.
- Key: `sde.connection` (`TOIL_SDE_CONNECTION`), in the form `<token>@<host>`.
  - It's split at the first `@`.
  - The host gets `https://` unless it already has a scheme, for example `abc123@sde.imagile.dev` or `abc123@imagile.sdelements.com`.
  - A string with no `@`, or with `@` first, leaves both the base URL and the token unset. The command then fails with "not configured".
- Header: `Authorization: Token <token>`. No token exchange and no CI fallback.
- The config view and redaction must mask the token half of the connection string and keep the host.

## Paging

Django page-number paging on `users`, `projects`, `tasks` and `threats`.

- **Without `--all`:** one request with `page` (default 1) and `page_size` (default 100). Both must be positive integers.
  - Returns the server's object as-is: `{ count, next, previous, results }`.
  - `next` and `previous` are server-supplied URLs. They're passed through, never followed.
- **With `--all`:** loops `page=1, 2, …` with `page_size=100`, ignoring `--page` and `--page-size`.
  - It stops once the collected count reaches `count`, or a page comes back empty. There is no cap.
  - Returns a **bare array**, so the output shape differs between the two modes. Keep both.

## Special HTTP needs

None beyond plain JSON GETs. Default per-request timeout is 30 s, and the requests send `Connection: close`.

## Context inputs

- No group-level flags.
- The project id is a per-command input:
  - `--project` on `tasks`, `task` and `threats`.
  - `--id` on `project`.
- It falls back to `defaults.sde.project` (global and repo config merged, repo wins).
- It must be a positive integer. Otherwise the command fails before any request with "No project specified" or "Invalid project ID".

## Supported version

Not established. The area uses `/api/v2/` only, and no version check is made. `server-info` returns the server's version, but its help says it needs a super-user, so it can't serve as a general version probe.

## Watch for

- #86 item 1: `task --task` documents the bare id (`T21`), but the path needs the composite `<project>-T21`.
  - The value is put into the path as given, with no `encodeURIComponent`.
  - Reproduce both.
- **Filters passed to the server:**

  | Command | Flag | Query parameter |
  |---------|------|-----------------|
  | `users` | `--active` | `is_active` (only `true` or `false`) |
  | `users` | `--first-name`, `--last-name` | `first_name`, `last_name` |
  | `projects` | `--active` | `active` (`true`, `false` or `all`) |
  | `tasks` | `--assigned-to` | `assigned_to` |
  | `threats` | `--capec-id`, `--component-id` | `capec_id`, `component_id` |

- **Not validated, sent as given:** `--priority`, `--severity`, `--accepted`, `--relevant`, `--status`, `--ordering`, `--expand` and `--include`.
- **Supported by the client but not exposed as flags:** `slug` on projects, and `title` and `threat_id` on threats. Don't add them in the port.
- `whoami` calls `/api/v2/users/me/`. `project` calls `/api/v2/projects/<id>/` with `expand` and `include`.
