# Kibana (`kibana`)

Wave 1 · Integration issue #39 · Suspected bugs #81 · 7 contract commands

## Commands

- **Instance:** `kibana status`, `kibana spaces list`
- **Dashboards:** `kibana dashboards list [--search] [--space] [--page] [--per-page]`, `kibana dashboards export --id <ids...> [--no-references] [--space]`
- **Data views:** `kibana data-views list [--space]`
- **Alerting:** `kibana rules list [--search] [--space] [--page] [--per-page]`, `kibana rules get --id [--space]`

## Auth

- **Credential:** an API key (Stack Management, API keys). Kibana reuses the Elasticsearch key when it has none of its own. In toil the sharing is an explicit pairing (maintainer decision 7 on #68): a Kibana connection names the Elasticsearch connection whose key it uses, `"apiKeyFrom": "<es connection>"`, through core's declared cross-area connection use (K1), never by reading another area's config directly.
- **Config keys:** `kibana.baseUrl` (`TOIL_KIBANA_BASE_URL`), `kibana.apiKey` (`TOIL_KIBANA_API_KEY`, optional), `kibana.space` (`TOIL_KIBANA_SPACE`, optional).
- **Key resolution, first set value wins:** `TOIL_KIBANA_API_KEY`, then `TOIL_ELASTICSEARCH_API_KEY`, then stored `kibana.apiKey`, then stored `elasticsearch.apiKey`. Env vars outrank both stored keys; within a tier the Kibana key wins. A set-but-empty env var counts as set. The resolver records which key was used (`kibana` or `elasticsearch`). This is the declared cross-area connection from K1.
- **Header:** `Authorization: ApiKey <value>`, `kbn-xsrf: true` on every request, `Content-Type: application/json`, `Connection: close`, and an `Accept` that varies (below).
- **Which-key hint:** a 401 or 403 while using the shared Elasticsearch key appends "(sent the shared Elasticsearch API key; if it lacks Kibana privileges, set TOIL_KIBANA_API_KEY or kibana.apiKey)". The env var name comes from core's naming helper, not a literal.
- **Errors:** no key is "Kibana credentials not configured. Set kibana.apiKey, or elasticsearch.apiKey to share the Elasticsearch key."
- **`config test`** calls `GET /api/status` through the ordinary JSON path (so a 503 fails there), says "(using the Elasticsearch API key)" when shared, and reports "no API key" when only the base URL is set.

## Paging

- `dashboards list` and `rules list`: page/per_page, `--page` default 1, `--per-page` default 100, both validated as integers of at least 1. One request; the response's `total`, `page` and `per_page` are echoed so the caller pages. No loop, no cap.
- `spaces list`, `data-views list` and `rules get` are unpaged.

## Special HTTP needs

- **Status on 503:** `kibana status` reads `GET /api/status` and accepts a 503 only when the body parses and carries an object at `status.overall`. Any other non-OK, including a proxy's 503, is an error with Kibana's `message` if present.
- **NDJSON:** `dashboards export` is `POST /api/saved_objects/_export` with `Accept: application/x-ndjson, application/json`, body `{objects: [{type: "dashboard", id}...], includeReferencesDeep}` (`--no-references` sets it false; default true), and a 60 s timeout. Split on `\n`, blank lines dropped, each line parsed. A line with `exportedCount` and no `type` is `exportDetails`; the rest are `objects`.
- **Non-JSON body:** "Kibana returned a non-JSON response (is baseUrl pointing at Kibana?): " plus the first 120 characters.
- **Retry:** the JSON calls get the shared 429 retry; `status` and `export` (the raw-text path) do not.
- **Paths:** `/api/spaces/space`, `/api/saved_objects/_find?type=dashboard`, `/api/data_views`, `/api/alerting/rules/_find`, `/api/alerting/rule/<encodeURIComponent(id)>`. `search_fields` is `title` (dashboards) or `name` (rules), sent only with `--search`.

## Context inputs

- **`--space`** on the space-scoped commands falls back to `kibana.space`. Unset or `default` leaves the path unprefixed; any other id becomes `/s/<encodeURIComponent(id)>/api/...`. Outputs report `space` as the resolved id or `"default"`.
- `status` and `spaces list` are never space-prefixed.

## Supported version

Not established. Hints: `status` handles both the 7.x `state`/`title` and the 8.x `level`/`summary` shapes. `/api/data_views` exists from Kibana 8.0 (#81), so `data-views list` returns 404 on 7.x.

## Watch for

- **#81 found no credible bugs.** Build exactly; nothing to pin beyond the two notes there (data views floor, missing retry on the raw-text path).
- **Output mapping:** `status` returns `{name, uuid, version, buildFlavor, status: level ?? state, summary: summary ?? title}`. Dashboards map to `{id, title, description, updatedAt}`, an empty description becoming undefined. Data views map to `{id, name: name || title, pattern: title, namespaces}`. Rules flatten through `summarizeRule` (`ruleTypeId`, `muted` default false, `tags` default `[]`, `interval`, `executionStatus`, `lastExecutionDate`, `lastRunOutcome`, `error`, `nextRun`, `updatedAt`); `rules get` adds `params` and `actions`.
- **Credentials stay on `kibana.baseUrl`.** Nothing follows a server-supplied URL; the shared key must never be sent to the Elasticsearch host by a Kibana command, or the reverse.
