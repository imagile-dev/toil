# Elasticsearch (`elasticsearch`)

Wave 1 · Integration issue #38 · Suspected bugs #84 · 4 contract commands

## Commands

- **Cluster:** `elasticsearch cluster health`
- **Indices:** `elasticsearch indices list [--pattern]`
- **Documents:** `elasticsearch search --index [--query | --q] [--sort] [--source] [--size] [--from] [--timeout-ms]`, `elasticsearch count --index [--query | --q]`

## Auth

- **Credential:** an API key, the base64 "encoded" value from Kibana (Stack Management, API keys).
- **Config keys:** `elasticsearch.baseUrl` (`TOIL_ELASTICSEARCH_BASE_URL`) and `elasticsearch.apiKey` (`TOIL_ELASTICSEARCH_API_KEY`). Env var first, then stored config. No CI fallback var.
- **Header:** `Authorization: ApiKey <value>`, plus `Content-Type` and `Accept: application/json` and `Connection: close`. No token exchange.
- **Shared with Kibana:** `kibana` falls back to this key, including the env var (see `kibana.md`). The connection is declared once here and reused there.
- **Errors:** a missing key or base URL is "Elasticsearch credentials not configured" / "Elasticsearch baseUrl not configured", pointing at config setup.
- **`config test`** calls `GET /_cluster/health`.

## Paging

- No paging loop. `search` passes `--size` (default 100) and `--from` (default 0) straight into the body; there is no client-side cap. The server's `max_result_window` is the only limit.
- `indices list` is a single unpaged `_cat` call. `count` returns one number.

## Special HTTP needs

- `search` and `count` are `POST` with a JSON body to `/<index>/_search` and `/<index>/_count`.
- **Index path:** `--index` (and `--pattern`) is split on commas, each part trimmed and `encodeURIComponent`-ed, and rejoined with literal commas. Wildcards are encoded as-is (`*` is not escaped by `encodeURIComponent`).
- **Query:** `--query` must parse as a JSON object (not an array or null), or `--q` becomes `{"query_string":{"query":...}}`. Both together is an error; neither is `{"match_all":{}}`.
- **`indices list`:** `GET /_cat/indices[/<pattern>]?format=json&h=index,health,status,docs.count,store.size,pri,rep`. The commas in `h` must stay literal in the query string (core's URL builder restores them).
- **Timeout:** `search` uses `--timeout-ms` (default 30000) as the per-request timeout; the others use the 30 s default.
- **429:** the shared retry applies (three attempts, `Retry-After` honoured up to the cap).
- No non-OK statuses are accepted, no NDJSON, no files.

## Context inputs

None. No group-level flags, no git remote, no per-command default from config.

## Supported version

Not established. Hints from the source: `hits.total` is handled both as a number and as `{value, relation}`, so the code expects responses from either shape of the search API. Only `/_cluster/health`, `/_cat/indices`, `/_search` and `/_count` are called.

## Watch for

- **Output shape of `search`:** `{index, took, timedOut, total, totalRelation, hitCount, hits, aggregations}`. `timedOut` defaults to `false`; `total` is `hits.total.value` or the bare number; `totalRelation` is undefined for the number form. `hits` is passed through unchanged.
- **`indices list`** returns `{count, indices}` with the `_cat` rows untouched. `cluster health` returns the server body as-is (opaque in the contract).
- **`--sort`** is `field:order`, split on `:` into exactly `[{field: {order}}]`, order defaulting to `asc`. Pin bug #84 item 3: a field containing `:` or several sort fields is mis-split.
- **`--source`** is split on commas into a `_source` array, empty entries dropped.
- **Integer flags:** `--size`, `--from` and `--timeout-ms` accept any non-negative integer (the helper is named "positive" but allows 0). Pin bug #84 item 2: `--timeout-ms 0` aborts the request at once.
- **Pin bug #84 item 1:** Elasticsearch's `{"error":{"type","reason"}}` body matches nothing in the shared error parser, so every failure is a bare `HTTP <status> <statusText>`.
- **Dry run** prints method, URL, headers with `Authorization` redacted, and the body.
