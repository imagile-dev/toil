---
area: logscale
description: Query Language searches and repository lists on Falcon LogScale
---

# Falcon LogScale (`logscale`)

Searches a Falcon LogScale repository with the LogScale Query Language, and lists
the repositories a token can see. Both commands read; neither changes anything.
Built from LogScale's API documentation. Verification level: `unit`.

**Supported versions:** The oldest Falcon LogScale version toil supports hasn't been established. toil
calls the synchronous Search API (`/api/v1/repositories/<repo>/query`) and the
GraphQL `repositories` query (`/graphql`), with the token sent as a Bearer header.
No release has been verified yet.

## Credential

A LogScale **personal API token**: in LogScale, your account settings → Personal
API Token. A token with read access to the repository also works for `repository query`;
`repository list` lists what the token's user can see. toil sends it as
`Authorization: Bearer <token>`. There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_LOGSCALE_BASE_URL` | yes | LogScale server root, e.g. `https://logscale.imagile.dev` (keep any context path) |
| `token` | `TOIL_LOGSCALE_TOKEN` | yes | Personal API token |

There is no CI fallback variable.

```bash
export TOIL_LOGSCALE_BASE_URL=https://logscale.imagile.dev
export TOIL_LOGSCALE_TOKEN=<your personal API token>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "corp-logscale": { "area": "logscale", "baseUrl": "https://logscale.imagile.dev" }
  },
  "defaults": { "logscale": { "connection": "corp-logscale" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-logscale --area logscale` (or
`toil connections login corp-logscale`) to keep it in the OS credential store, or set
`TOIL_LOGSCALE_TOKEN`.

## Commands

- `repository list`: List available repositories. `data` is `{ count,
  repositories }`, each with `id`, `name`, `description` and `timeOfLatestIngest`
  from the GraphQL `repositories` query.
- `repository query <repository>`: Execute a LogScale Query Language (LQL) search
  against a repository. `--query` is required.
  - `--start` (default `1h`) and `--end` (default `now`) take epoch milliseconds, an
    ISO 8601 date or date-time (UTC unless it carries an offset), or a relative time
    such as `1h`, `24hours` or `2days`. ISO 8601 is sent as epoch milliseconds.
  - `--limit` (default 200) is the most events returned. LogScale's search has no
    limit field, so toil keeps the first N of what came back and adds a
    `LOGSCALE_LIMIT` warning when there were more. To have LogScale itself return
    fewer, end the query with `| head(N)` or `| tail(N)`.
  - `--timeout-ms` (default 30000, at most 600000) is how long toil waits for the
    answer. A slower answer is `TIMEOUT`.
  - `data` is `{ repository, done, cancelled, eventCount, events, warnings,
    metaData }`. The synchronous search answers with the finished result, so `done`
    is `true`, `cancelled` is `false`, `warnings` is `[]` and `metaData` is `null`.
    Event field values are strings, except `@timestamp`, which is epoch
    milliseconds.

LogScale recommends this synchronous search for filter queries over short windows.
An aggregate (`| count()`) works, but blocks until the whole window is searched.

A query LogScale rejects (a syntax error) is `HTTP`, with LogScale's explanation
after the status, such as `HTTP 400 Bad Request: Unexpected end of input at 1:7`.

```bash
toil logscale repository list
toil logscale repository query imagile-app --query 'level=error' --start 15m
toil logscale repository query imagile-app --query 'level=error | count()' --start 2026-10-01T00:00:00Z --end 2026-10-02T00:00:00Z
```
