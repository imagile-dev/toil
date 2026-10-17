---
area: dynatrace
description: Monitored entities, services, Kubernetes workloads, problems and distributed traces from Dynatrace
---

# Dynatrace (`dynatrace`)

Monitored entities, services, Kubernetes workloads and problems from the Dynatrace
**Environment API v2**, and distributed-trace spans from **Grail**. Every command
reads; none changes anything. Verification level: `unit`.

**Supported versions:** The oldest Dynatrace version toil supports hasn't been established. The
classic commands call Environment API v2 (`/api/v2`) on SaaS and Managed; `trace`
needs the platform Grail query API (`/platform/storage/query/v1`), so a deployment
without the platform can't run it. No release has been verified yet.

## Credential

Two hosts, two tokens, and each token goes only to its own host:

- **Access token**, for every command except `trace`. In Dynatrace: Access tokens →
  Generate new token, with the `entities.read` and `problems.read` scopes. toil sends
  it to `baseUrl` as `Authorization: Api-Token <token>`.
- **Platform token**, for `trace` only, with the `storage:spans:read` and
  `storage:buckets:read` scopes. toil sends it to `platformUrl` as
  `Authorization: Bearer <token>`.

There is no username, password or browser login, and no CI fallback variable.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_DYNATRACE_BASE_URL` | for all but `trace` | Classic environment URL, e.g. `https://abc12345.live.dynatrace.com`. On Managed, keep the `/e/<environment-id>` path |
| `apiToken` | `TOIL_DYNATRACE_API_TOKEN` | for all but `trace` | Access token, sent as `Api-Token` |
| `platformUrl` | `TOIL_DYNATRACE_PLATFORM_URL` | for `trace` | Platform URL, e.g. `https://abc12345.apps.dynatrace.com` |
| `platformToken` | `TOIL_DYNATRACE_PLATFORM_TOKEN` | for `trace` | Platform token, sent as `Bearer` |
| `env` | `TOIL_DYNATRACE_ENV` | no | The environment name `--env` selects this connection by, when it differs from the connection's name |

A command that needs a missing key fails with `NOT_CONFIGURED` naming it
("Dynatrace baseUrl not configured.").

Environment variables (CI, or a one-off shell):

```bash
export TOIL_DYNATRACE_BASE_URL=https://abc12345.live.dynatrace.com
export TOIL_DYNATRACE_API_TOKEN=<your access token>
export TOIL_DYNATRACE_PLATFORM_URL=https://abc12345.apps.dynatrace.com
export TOIL_DYNATRACE_PLATFORM_TOKEN=<your platform token>
```

## Environments

Each Dynatrace environment is one connection. `--env <name>` picks the connection
named `<name>`, or the one whose `env` setting is `<name>`; an environment toil
doesn't know is an `INVALID_INPUT` that lists the ones it has. Without `--env`, the
area's default connection is used: the one named in `defaults.dynatrace.connection`,
else the one named `dynatrace`, else the only one. Keys every environment shares
(often `platformUrl`) can go once under `defaults.dynatrace`; a connection's own
value wins over them.

```json
{
  "version": 2,
  "connections": {
    "prod": { "area": "dynatrace", "baseUrl": "https://abc12345.live.dynatrace.com" },
    "staging": { "area": "dynatrace", "baseUrl": "https://dynatrace.imagile.dev/e/abc12345-0000-0000-0000-000000000000" }
  },
  "defaults": { "dynatrace": { "connection": "prod" } }
}
```

The tokens never go in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add prod --area dynatrace` (or
`toil connections login prod` for an existing connection) to keep them in the OS
credential store, or set the env vars. `TOIL_DYNATRACE_*` variables configure the
default connection only; for another one use `TOIL_CONN_<NAME>_<KEY>`
(`TOIL_CONN_STAGING_API_TOKEN`).

```bash
toil dynatrace --env staging problems list
```

## Commands

- `entities list`: List monitored entities using an entity selector. `--selector`
  is required; `--from`, `--to` and `--fields` are passed through.
- `entities get`: Get a monitored entity by ID (`--id`, plus `--from`, `--to`,
  `--fields`). `data` is Dynatrace's entity as it came.
- `services`: List monitored services: `entities list` with `type("SERVICE")`
  (`--from`, `--to`). `data` is `{ totalCount, services }`.
- `workloads`: List monitored Kubernetes workloads: `entities list` with
  `type("CLOUD_APPLICATION")` (`--from`, `--to`). `data` is `{ totalCount, workloads }`.
- `problems list`: List problems. `--from` defaults to `now-2h` and `--to` to `now`;
  `--problem-selector` and `--entity-selector` filter. `data` is
  `{ totalCount, problems }`.
- `problems get`: Get a problem by ID (`--id`, `--fields`). `data` is Dynatrace's
  problem as it came.
- `trace`: Get distributed-trace spans from Grail (`--id`, 16 to 32 hexadecimal
  characters). It runs `fetch spans | filter trace.id == "<id>" | sort start_time asc`
  and waits up to 60 seconds for Grail, polling at most once a second; past that it
  fails with `TIMEOUT`. `data` is the query's `result` (`records`, `types`,
  `metadata`). The query sends no timeframe and no record limit, so Grail's
  defaults apply: an old trace or a very large one may come back empty or cut short.

The lists fetch every page, 500 at a time, until Dynatrace stops returning a
`nextPageKey`; `totalCount` is the number of items collected. They stop with an
error after 1,000 pages, and like every command they're subject to toil's time limit
(`TOIL_TIMEOUT_MS`, 120 s by default).

Dynatrace's own error text isn't shown yet: an error is the status line, such as
`HTTP 400 Bad Request`, with toil's fix.

```bash
toil dynatrace entities list --selector 'type("HOST"),tag("team:payments")'
toil dynatrace problems list --from now-1d --problem-selector 'status("open")'
toil dynatrace trace --id 4bf92f3577b34da6a3ce929d0e0e4736
```
