# Split.IO (`splitio`)

Wave 1 · Integration issue #29 · Suspected bugs #79 · 14 contract commands

## Commands

- **Workspaces and environments:** `workspaces list`, `environments list`
- **Flags, read:** `flags list`, `flags get`
- **Flags, change requests:** `flags update`, `flags set-rule`, `flags set-default`, `flags toggle`, `flags batch-toggle`, `flags kill`, `flags restore`, `flags archive`
- **Change requests:** `change-requests list`, `change-requests get`

Split.IO is one of the four areas #68 reworks from vendor docs rather than porting bug for bug. It was never run against a live instance. Per the maintainer's 2026-10-17 decision, command names, flags and config keys stay; the wire paths and payloads follow Split's Admin API. The predecessor's tests stub fetch with the same wrong paths, so they prove nothing.

## Auth

- `splitio.baseUrl` (`TOIL_SPLITIO_BASE_URL`) and `splitio.adminApiKey` (`TOIL_SPLITIO_ADMIN_API_KEY`). No CI fallback var. No default host; the setup prompt suggests `https://api.split.io`.
- Header: `Authorization: Bearer <adminApiKey>`, plus JSON `Accept`/`Content-Type`. No exchange.
- The predecessor's connection test is `GET /internal/api/v2/workspaces`.

## Paging

- **offset/limit, caller-driven, no loop:**
  - `flags list`: `--limit` defaults to 50, `--offset` to 0. The output includes `totalCount`.
  - `change-requests list`: `--limit` defaults to 25, `--offset` to 0. The output includes `totalCount`.
- **Single request:** `workspaces list` returns the first page only and drops `totalCount` (#79 item 8). `environments list` is also a single request.
- The response wrapper is `{objects, offset, limit, totalCount}`. Check each endpoint against the vendor docs; `environments` returns a bare array (#79 item 7).

## Special HTTP needs

- **Interactive confirmation:** every write prompts "Submit Change Request ...?" unless `--yes` is given. This needs core's prompter. When the user declines, the command ends with "Aborted by user." and exit code 0.
- **JSON input:** `flags update` and `flags batch-toggle` read `--input-file <path>` (`-` reads stdin). The flag is optional in the parser but required at runtime. The file goes through the workspace bound.
- **Read-modify-write:** `set-rule` and `set-default` GET the environment definition, patch it, then POST a change request.
- **Sequential fan-out:** `batch-toggle` submits one change request per entry. It confirms once for the whole batch, keeps going after a failure, and returns `{submitted, results: [{flag, ok, id?, error?}]}`.
- No multipart, downloads, response headers, GraphQL or polling.

## Context inputs

None. There are no group flags and no config or git defaults. `--workspace` and `--environment` are per-command flags; they're required where the contract lists them, except `--environment` on `flags get` and `change-requests list`.

## Supported version

Not established. The predecessor calls Admin API paths under `/internal/api/v2`. #79 uses Split's Python Admin API client as the reference, because the hosted reference pages moved during the Harness migration.

## Watch for

- The #79 items are the rework list, not pins:
  - Flag and definition paths: the predecessor sends `name/` and `environment/`; the reference uses no `name/` segment and plural `environments`.
  - Change requests are posted without the environment in the path.
  - The `operationType` values are wrong.
  - Approvers are sent as `[{id}]`; the reference takes strings (emails).
  - Bucket sizes are written as `100000`; the reference uses percentages.
  - The definition is nested, and read-only fields are spread into the change request.
  - `environments list` reads `.objects` from a bare array.
  - `workspaces list` reads one page.
- Keep every flag on every command, even where the vendor API forces a different wire shape. `flags archive` has no `--environment` today, but the corrected change-request path needs one; adding it is a contract divergence to list.
- Change-request base fields map `--mnemonic` to `title`, `--description` to `comment` and `--change-number` to `crNumber`. `batch-toggle` titles each change request `<mnemonic> — <flag>` (an em dash).
- `toggle --enabled` counts anything other than `false` or `0` (case-insensitive) as enable, which means RESTORE.
- `set-rule` requires `--treatment` or `--weights`. `--rule-index` must fall within the existing rules. `--weights` goes through a bare `JSON.parse`, so bad JSON surfaces as a raw syntax error.
- `change-requests get` uses `/changeRequests/{id}` with no workspace. Check this against the vendor docs.
