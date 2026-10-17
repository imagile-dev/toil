# Dynatrace (`dynatrace`)

Wave 2 · Integration issue #36 · Suspected bugs #83 · 7 contract commands

## Commands

- **entities:** `list`, `get`
- **Top level:** `services`, `workloads`, `trace`
- **problems:** `list`, `get`

## Auth

Two credentials on two hosts. Neither has a token exchange or a CI fallback.

- **Classic environment API** (every command except `trace`):
  - Keys: `dynatrace.baseUrl` (`TOIL_DYNATRACE_BASE_URL`, for example `https://abc12345.live.dynatrace.com`) and `dynatrace.apiToken` (`TOIL_DYNATRACE_API_TOKEN`).
  - Header: `Authorization: Api-Token <token>`.
- **Platform / Grail** (`trace` only):
  - Keys: `dynatrace.platformUrl` (`TOIL_DYNATRACE_PLATFORM_URL`, for example `https://abc12345.apps.dynatrace.com`) and `dynatrace.platformToken` (`TOIL_DYNATRACE_PLATFORM_TOKEN`).
  - Header: `Authorization: Bearer <token>`.
- **Named environments:** `dynatrace.environments.<name>.{baseUrl, apiToken, platformUrl, platformToken}` and `dynatrace.defaultEnvironment`. Each field missing from an environment falls back to the flat value.
- The request hook has to pick the host and the auth scheme per command: classic, or platform for `trace`.

## Paging

- **`nextPageKey`:** `entities list`, `services`, `workloads` and `problems list`.
  - The first request sends the filters plus `pageSize=500`. Later requests send only `nextPageKey`, as Dynatrace requires.
  - The loop runs until `nextPageKey` is absent. There is no cap.
- The output's `totalCount` is the number of items collected, not the server's `totalCount`.
- `entities get` and `problems get` are single requests.

## Special HTTP needs

- **Polling (DQL):** `trace` POSTs `/platform/storage/query/v1/query:execute`.
  - The body is `{ query, requestTimeoutMilliseconds: 5000 }`, and each request has a 10 s timeout.
  - The query is `fetch spans | filter trace.id == "<id lowercased>" | sort start_time asc`.
  - While the state is `RUNNING` or `NOT_STARTED`, it GETs `query:poll` with `request-token` and `request-timeout=min(5000, remaining)`, at most once a second.
  - The overall deadline is 60 s, then "did not finish within 60 seconds". A missing `requestToken` is an error, and so is a final state other than `SUCCEEDED` (the error uses `error.message`).
  - `data` is the response's `result`.
- **Base path kept:** Managed URLs carry `/e/<environment-id>`. Core's URL join must not drop the base path.
- `problems list` defaults to `from=now-2h` and `to=now`.
- Default per-request timeout is 30 s. Every request is a GET except `query:execute`.

## Context inputs

- Group flag: `dynatrace --env <name>`. In toil, `--env` selects a connection (K1).
- Predecessor order:
  1. `--env` picks `environments.<name>`. An unknown name is an error whose fix names `dynatrace.environments.<name>.baseUrl`.
  2. Otherwise `defaultEnvironment` picks `environments.<name>`. An unknown name is an error whose fix names both keys.
  3. Otherwise the flat keys.
- With a stored default environment, the `TOIL_DYNATRACE_*` env vars lose to it (#83 item 6). Pin that until it's confirmed.

## Supported version

Not established. Known:

- The classic commands use Environment API v2 (`/api/v2/entities`, `/api/v2/problems`) on SaaS and on Managed (`/e/<env-id>` base URLs).
- `trace` needs the Grail platform query API (`/platform/storage/query/v1`). The source only shows `*.apps.dynatrace.com` platform URLs, so a deployment without the platform can't run `trace`.
- No version check or version endpoint is called.

## Watch for

- Every #83 item is reproduced exactly:
  - 1: Dynatrace's `error.message` is dropped from errors.
  - 2: `trace` uses Grail's default timeframe only.
  - 3: `trace` is capped by the default `maxResultRecords`.
  - 4: 16-character ids can't match.
  - 5: the poll sends `request-timeout`.
  - 6: a stored environment overrides the env vars.
- The trace id check is `^[0-9a-f]{16,32}$` (case-insensitive), so any length from 16 to 32 passes, not only 16 or 32.
- Output keys: `{ totalCount, entities }`, `{ totalCount, services }`, `{ totalCount, workloads }`, `{ totalCount, problems }`.
  - `services` uses the selector `type("SERVICE")`.
  - `workloads` uses `type("CLOUD_APPLICATION")`.
- `entities get` and `problems get` pass the server object through. The id is URL-encoded into the path.
