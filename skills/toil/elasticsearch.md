---
area: elasticsearch
description: Cluster health, the index list, and search and count with Query DSL or a Lucene query string on Elasticsearch
---

# Elasticsearch (`elasticsearch`)

Cluster health, the index list, and document search and count on **Elasticsearch**,
through its REST API. Every command reads; none changes anything. Verification
level: `unit`.

**Supported versions:** The oldest Elasticsearch version toil supports hasn't been established. toil
calls `_cluster/health`, `_cat/indices`, `_search` and `_count` with an API key sent as
an `ApiKey` header, following Elastic's current REST API reference. No release has
been verified yet.

## Credential

An Elasticsearch **API key**: in Kibana, Stack Management → API keys → Create API key
(or Elasticsearch's own `POST /_security/api_key`). Copy the **encoded** value, the
base64 string shown once when the key is created. Give it the `read` index privilege
on the indices you'll search and count, `monitor` on those you'll list, and the
`monitor` cluster privilege for `cluster health` and `index list`. toil sends it as
`Authorization: ApiKey <encoded>`. There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_ELASTICSEARCH_BASE_URL` | yes | Elasticsearch root, e.g. `https://elasticsearch.imagile.dev` (keep any context path). Elasticsearch itself, not Kibana |
| `apiKey` | `TOIL_ELASTICSEARCH_API_KEY` | yes | The encoded API key |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_ELASTICSEARCH_BASE_URL=https://elasticsearch.imagile.dev
export TOIL_ELASTICSEARCH_API_KEY=<your encoded API key>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "es-prod": { "area": "elasticsearch", "baseUrl": "https://elasticsearch.imagile.dev" }
  },
  "defaults": { "elasticsearch": { "connection": "es-prod" } }
}
```

The key never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add es-prod --area elasticsearch` (or
`toil connections login es-prod` for an existing connection) to keep it in the OS
credential store, or set `TOIL_ELASTICSEARCH_API_KEY`.

**Sharing the key with Kibana:** a Kibana connection can use this connection's key
instead of its own, but only when you pair them on the Kibana side
(`"apiKeyFrom": "es-prod"`). An unpaired Kibana connection never gets it. The one
exception is an env fallback the contract specifies: Kibana's default connection takes
`TOIL_ELASTICSEARCH_API_KEY` when `TOIL_KIBANA_API_KEY` isn't set. Either way the key
is sent only to that Kibana connection's own host. See `kibana.md`.

## Commands

- `cluster health`: Show cluster health (status, node and shard counts), as
  Elasticsearch reports it. A red cluster is a successful answer whose `status` is
  `red`.
- `index list`: List indices with health, document count and size (`--pattern`
  takes a name or wildcard, comma-separate several). `data` is `{ count, indices }`,
  each row the `_cat/indices` columns `index`, `health`, `status`, `docs.count`,
  `store.size`, `pri` and `rep`, every value a string.
- `index search <index>`: Search one or more indices with Query DSL JSON or a query
  string. The index is required (comma-separate several; wildcards and aliases work; an empty
  name or an empty entry between commas is refused, so nothing silently searches every
  index).
  `--query` takes one Query DSL clause as a JSON object, `--q` a Lucene query string;
  use one or the other, and with neither every document matches. `--sort` takes
  `field:order` pairs, comma-separated (`@timestamp:desc,_score:desc`; an entry with
  no `asc` or `desc` sorts ascending). `--source` is a comma list of fields to return.
  `--limit` (default 100) and `--offset` (default 0) go to the server as its `size`
  and `from`; past 10,000 hits Elasticsearch refuses `from + size` (its
  `max_result_window`).
  `--timeout-ms` (default 30000) is how long toil waits for the answer. `index search`
  has a 10-minute time limit of its own, so a `--timeout-ms` up to 600000 is honoured;
  `TOIL_TIMEOUT_MS`, when set, overrides that limit. `data` is `{ index,
  took, timedOut, total, totalRelation, hitCount, hits, aggregations }`: `hits` as
  Elasticsearch sent them, and `totalRelation` `gte` when `total` is only a lower
  bound.
- `index count <index>`: Count documents matching a query (`--query` or `--q` as
  for `index search`). `data` is `{ index, count }`.

`index search` and `index count` send their query as a POST body. They still only read.

Errors carry Elasticsearch's own reason, e.g. `index_not_found_exception: no such
index [nope]`, or a query parse error under its root cause, so a bad query can be
fixed from the message.

```bash
toil elasticsearch cluster health
toil elasticsearch index list --pattern "logs-*"
toil elasticsearch index search logs-app --q "level:error AND service:api" --sort "@timestamp:desc" --limit 20
toil elasticsearch index count "logs-*" --query '{"term":{"level":"error"}}'
```
