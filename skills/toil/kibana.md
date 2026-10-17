---
area: kibana
description: Kibana status, spaces, dashboards (list and NDJSON export), data views and alerting rules, read with an API key
---

# Kibana (`kibana`)

Status, spaces, dashboards, data views and alerting rules on **Kibana**, through its
REST API. Every command reads; none changes anything. Verification level: `unit`.

**Supported versions:** The oldest Kibana version toil supports hasn't been established. `status` reads both the 7.x (`state`/`title`) and the 8.x
(`level`/`summary`) shapes; `data-views list` calls `/api/data_views`, which Kibana
added in 8.0, so on 7.x it fails with `NOT_FOUND`. Requests follow Elastic's current
Kibana API reference. No release has been verified yet.

## Credential

A Kibana or Elasticsearch **API key**: in Kibana, Stack Management → API keys →
Create API key. Copy the **encoded** value, shown once when the key is created, and
give it access to the Kibana features you'll read (dashboards, data views, alerting).
toil sends it as `Authorization: ApiKey <encoded>`, with `kbn-xsrf: true`, only to
the connection's `baseUrl`. There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_KIBANA_BASE_URL` | yes | Kibana root, e.g. `https://kibana.imagile.dev` (keep any context path, such as a `basePath`). Kibana itself, not Elasticsearch |
| `apiKey` | `TOIL_KIBANA_API_KEY` | no | The encoded API key. Unset, the paired Elasticsearch connection's key is used (below) |
| `space` | `TOIL_KIBANA_SPACE` | no | Default space id for the space-scoped commands; unset or `default` is the default space |
| `apiKeyFrom` | `TOIL_KIBANA_API_KEY_FROM` | no | The Elasticsearch connection whose `apiKey` this connection uses when it has none of its own |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_KIBANA_BASE_URL=https://kibana.imagile.dev
export TOIL_KIBANA_API_KEY=<your encoded API key>
export TOIL_KIBANA_SPACE=ops   # optional
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "kibana-prod": { "area": "kibana", "baseUrl": "https://kibana.imagile.dev", "space": "ops" }
  },
  "defaults": { "kibana": { "connection": "kibana-prod" } }
}
```

The key never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add kibana-prod --area kibana` (or
`toil connections login kibana-prod` for an existing connection) to keep it in the
OS credential store, or set `TOIL_KIBANA_API_KEY`.

### Using the Elasticsearch key

One key often serves both. A Kibana connection uses an Elasticsearch connection's
`apiKey` only when you pair them, by naming that connection in `apiKeyFrom`:

```json
{
  "version": 2,
  "connections": {
    "es-prod": { "area": "elasticsearch", "baseUrl": "https://elasticsearch.imagile.dev" },
    "kibana-prod": { "area": "kibana", "baseUrl": "https://kibana.imagile.dev", "apiKeyFrom": "es-prod" }
  }
}
```

An unpaired connection never gets another area's key, with one exception that keeps
the documented env chain: Kibana's default connection takes `TOIL_ELASTICSEARCH_API_KEY`
when `TOIL_KIBANA_API_KEY` isn't set. Which key wins: an env value beats a stored
one, and within a tier Kibana's own key wins. The borrowed key is still sent only to
Kibana's `baseUrl`, never to Elasticsearch's. `meta.context.shared` says when the key
came from Elasticsearch (the connection, and env or store, never the value), and a
401 or 403 while sending it says so in the error: such a key may lack Kibana
privileges, so give that Kibana connection its own key with
`toil connections login <name>` (or `TOIL_KIBANA_API_KEY` for the default connection).

With no key at all, commands fail with `NOT_CONFIGURED`, naming both ways to set one.

## Commands

`--space <id>` on `dashboards`, `data-views` and `rules` picks the space, falling back
to the connection's `space`; the default space has no URL prefix, any other is
`/s/<id>/api/...`. Each of those commands reports `space` as the id used, or
`default`. `status` and `spaces list` are never space-scoped.

- `status`: Show Kibana version and overall status. `data` is `{ name, uuid,
  version, buildFlavor, status, summary }`. An unhealthy Kibana answers 503 with its
  status in the body, and that's a successful answer (`status` `unavailable`, say); a
  503 without Kibana's own status, such as a proxy's, is an `HTTP` error.
- `spaces list`: List the spaces the API key can see. `data` is `{ count, spaces }`,
  each `{ id, name, description, disabledFeatures }`.
- `dashboards list`: List dashboards (id, title, description, last updated).
  `--search` matches titles (a trailing `*` is a wildcard). One page per call:
  `--page` (default 1) and `--per-page` (default 100), each a whole number of at
  least 1. `data` is `{ space, total, page, perPage, count, dashboards }`; ask for the
  next page while `page × perPage < total`. Kibana marks the API it uses
  (`_find`) as deprecated, though it still serves it.
- `dashboards export`: Export dashboards as saved objects, including the
  visualizations and data views they reference. `--id` takes one or more ids;
  `--no-references` exports only the dashboards. `data` is `{ space, count,
  exportDetails, objects }`: the saved objects as Kibana exported them, and its
  closing summary (`exportedCount`, `missingRefCount`, `missingReferences`). Sent as a
  POST; it still only reads.
- `data-views list`: List data views (id, name, index pattern). `data` is `{ space,
  count, dataViews }`, each `{ id, name, pattern, namespaces }`; a view with no name
  is named by its pattern.
- `rules list`: List alerting rules with their schedule and last execution status.
  `--search` matches names; `--page` and `--per-page` as for `dashboards list`. Each
  rule is `{ id, name, ruleTypeId, consumer, enabled, muted, tags, interval,
  executionStatus, lastExecutionDate, lastRunOutcome, error, nextRun, updatedAt }`.
- `rules get`: Get one alerting rule, including its params and actions (`--id`
  required). `data` is the same summary plus `params` and `actions`.

`status` and `dashboards export` hand a 429 back at once; the other commands retry it.

```bash
toil kibana status
toil kibana spaces list
toil kibana dashboards list --search "payments*" --space ops
toil kibana dashboards export --id abc12345 abc12346 --no-references
toil kibana data-views list
toil kibana rules list --search "High*" --per-page 20
toil kibana rules get --id abc12345-0000-0000-0000-000000000000
```
