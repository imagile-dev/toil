# Falcon LogScale (`logscale`)

Wave 1 · Integration issue #37 · Suspected bugs #85 · 2 contract commands

**Reworked, not matched bug for bug.** LogScale is rebuilt from LogScale's own API documentation (#37): the vendor docs are the specification, not the predecessor. Keep the predecessor's command paths, flags, config keys and `data` field names (the contract test checks them); the requests behind them follow the docs. #85's items are the list of things the rework fixes, each verified against the docs rather than pinned. The predecessor's behavior below is what it did, for reference.

## Commands

- **Repositories:** `logscale repositories list`
- **Search:** `logscale query --repository --query [--start] [--end] [--limit] [--timeout-ms]`

## Auth

- **Credential:** a LogScale personal access token (setup prompt wording) or API token (board wording).
- **Config keys:** `logscale.baseUrl` (`TOIL_LOGSCALE_BASE_URL`) and `logscale.token` (`TOIL_LOGSCALE_TOKEN`). Env var first, then stored config. No CI fallback var.
- **Header:** `Authorization: Bearer <token>`, plus `Content-Type` and `Accept: application/json` and `Connection: close`. No token exchange.
- **Errors:** "LogScale credentials not configured" / "LogScale baseUrl not configured", pointing at config setup.
- **`config test`** and the setup prompt both call `GET /api/v1/repositories`.

## Paging

- None. `repositories list` is one `GET /api/v1/repositories`, expected to return a JSON array.
- `query` sends `--limit` (default `"200"`, through `parseInt`) as a `limit` field in the body; there is no client-side cap and no follow-up request.

## Special HTTP needs

- **Query:** one synchronous `POST /api/v1/repositories/<encodeURIComponent(repository)>/query` with body `{queryString, start, end, limit, showQueryEventDistribution: false, isLive: false}`.
- **No polling.** The predecessor does not use LogScale's query-job API (create job, poll, delete). Whether `query` uses it follows the vendor docs.
- **Timeout:** `--timeout-ms` (default 30000, through `parseInt`) is the per-request timeout. `repositories list` uses the 30 s default.
- **429:** the shared retry applies.
- No NDJSON, no non-OK statuses accepted, no files.

## Context inputs

None. `--start` defaults to `1h` and `--end` to `now`; both are sent to the server unchanged, with no parsing or validation.

## Supported version

Not established. The source targets the on-premise product ("On-premise LogScale base URL" in the config type) and calls only the `/api/v1/` paths above.

## Watch for

- **`query` output:** `{repository, done, cancelled, eventCount, events, warnings, metaData}`, with `warnings` defaulting to `[]`. The code reads `data.events.length` without a guard.
- **#85 item 1:** the synchronous `/query` endpoint returns a JSON array, not `{done, cancelled, events}`. If so, `data.events` is undefined and the command fails with a raw `TypeError` in the envelope. The rework follows the documented response shape.
- **#85 item 2:** the `--start`/`--end` help advertises ISO 8601, which the API does not document. Keep the flags; the values and help follow the docs.
- **#85 item 3:** `limit` is a body field the endpoint does not document.
- **#85 item 4:** LogScale's plain-text error bodies fail `JSON.parse` in the shared parser, so failures are bare `HTTP <status> <statusText>`.
- **#85 item 5:** `GET /api/v1/repositories` may not exist in the REST API; `config test` depends on it too.
- **#85 item 6:** non-numeric `--limit` or `--timeout-ms` is not rejected; `parseInt` yields `NaN`, which JSON-serializes `limit` as `null`; a `NaN` timeout is coerced by Node's `setTimeout` to about 1 ms, so the request aborts at once.
- **`repositories list`** returns `{count, repositories}` with the server items passed through.
