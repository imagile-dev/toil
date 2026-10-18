---
area: checkmarx
description: Projects, scans and scan results statistics on Checkmarx One, the cloud service
---

# Checkmarx One (`checkmarx`)

Projects, scans and scan results statistics on **Checkmarx One**, the cloud service,
through its REST API under `/api`. Every command reads; none changes anything.
Verification level: `unit`.

**Supported versions:** The oldest Checkmarx One version toil supports hasn't been established. Checkmarx
One is cloud only, so there is no server release to pin. toil calls its REST API
under `/api` with a bearer token exchanged from an API key.

## Credential

A Checkmarx One **API key**, generated once in Checkmarx One. The key is a refresh
token: toil exchanges it for a short-lived access token and sends that as
`Authorization: Bearer <token>`. The exchange is a form POST of
`grant_type=refresh_token`, `client_id` and `refresh_token` to

```
https://<region>.iam.checkmarx.net/auth/realms/<tenantName>/protocol/openid-connect/token
```

The IAM host is the API host with `ast.` swapped for `iam.`
(`eu.ast.checkmarx.net` becomes `eu.iam.checkmarx.net`). `client_id` is the key's
own `azp` claim, or `ast-app` when the key doesn't carry one. The access token is
kept in memory, renewed shortly before it expires, and never written to disk.
toil sends the API key only to a host under `checkmarx.net` over HTTPS, or to the
connection's own host; any other derived host is refused with `AUTH`, so Checkmarx
One cloud is the only deployment that works.

**Client credentials aren't supported.** The `client_credentials` grant needs an
OAuth client registered for toil, which the Authentication Bar rules out. Until an
API key is set, the call is `CONFIG_INVALID` naming `apiKey` and
`TOIL_CHECKMARX_API_KEY`.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_CHECKMARX_BASE_URL` | yes | The API base, ending in `/api`, e.g. `https://eu.ast.checkmarx.net/api` |
| `tenantName` | `TOIL_CHECKMARX_TENANT_NAME` | yes | Tenant name (the IAM realm), e.g. `imagile` |
| `apiKey` | `TOIL_CHECKMARX_API_KEY` | yes | API key |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_CHECKMARX_BASE_URL=https://eu.ast.checkmarx.net/api
export TOIL_CHECKMARX_TENANT_NAME=imagile
export TOIL_CHECKMARX_API_KEY=<your API key>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "cx": { "area": "checkmarx", "baseUrl": "https://eu.ast.checkmarx.net/api", "tenantName": "imagile" }
  },
  "defaults": { "checkmarx": { "connection": "cx" } }
}
```

The API key never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add cx --area checkmarx` (or
`toil connections login cx` for an existing connection) to keep it in the OS
credential store, or set `TOIL_CHECKMARX_API_KEY`.

## Commands

- `project list`: List all projects. One request for the first 100; when Checkmarx
  One counts more, `meta.warnings` says so (`CHECKMARX_TRUNCATED`, "N projects
  found; only showing first 100"). `data` is the bare list of projects.
- `project get`: Get a project by ID (`--id <uuid>`).
- `scan list`: List scans, optionally for one project (`--project <uuid>`).
  `--last <n>` sets how many come back (default 100), read as a leading integer,
  so `5abc` is 5; a value with no leading number is `INVALID_INPUT`. No order is
  requested, so "last" is whatever order Checkmarx One returns. More than that
  many gives the same `CHECKMARX_TRUNCATED` warning.
- `scan get`: Get a scan by ID (`--id <uuid>`).
- `scan stats`: Get results statistics for a scan (`--id <uuid>`): the counts
  `highSeverity`, `mediumSeverity`, `lowSeverity`, `infoSeverity` and, when
  Checkmarx One sends it, `severitiesTotalCount`, from `results/summary`.

```bash
toil checkmarx project list
toil checkmarx scan list --project abc12345-0000-0000-0000-000000000000 --last 5
toil checkmarx scan stats --id abc12345-0000-0000-0000-0000000000a1
```
