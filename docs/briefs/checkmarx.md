# Checkmarx One (`checkmarx`)

Wave 2 · Integration issue #32 · Suspected bugs #89 · 5 contract commands

## Commands

- Projects: `checkmarx project list`, `checkmarx project get --id`
- Scans: `checkmarx scan list [--project] [--last]`, `checkmarx scan get --id`,
  `checkmarx scan stats --id`

Outputs are typed (see the contract): project and scan objects, and for `scan stats` the
`results/summary` counts (`highSeverity`, `mediumSeverity`, `lowSeverity`, `infoSeverity`,
`severitiesTotalCount?`).

## Auth

Decision 5: Checkmarx One cloud only, API key only.
`checkmarx.baseUrl` (`TOIL_CHECKMARX_BASE_URL`, the API base, e.g.
`https://eu.ast.checkmarx.net/api`), `checkmarx.tenantName` (`TOIL_CHECKMARX_TENANT_NAME`,
the IAM realm, e.g. `imagile`), `checkmarx.apiKey` (`TOIL_CHECKMARX_API_KEY`, secret).
No CI fallback var.

The API key is a refresh token. Exchange it with
`POST https://<region>.iam.checkmarx.net/auth/realms/<tenantName>/protocol/openid-connect/token`,
form-encoded `grant_type=refresh_token`, `client_id=<azp>`, `refresh_token=<apiKey>`.
`client_id` is the key's JWT `azp` claim, falling back to `ast-app` when the key does not
decode. The response's `access_token` goes out as `Authorization: Bearer <token>`.

- Token host: `<region>.ast.checkmarx.net` becomes `<region>.iam.checkmarx.net` (and
  `ast.checkmarx.net` becomes `iam.checkmarx.net`). Core refuses a derived host not under
  `checkmarx.net`. The contract only did a regex swap of `ast.` with no host check.
- Cache in memory per connection; refresh when within 60 s of `expires_in`. A failed
  exchange is a `ToilError` naming the token endpoint and status.
- Dropped divergence: `checkmarx.clientId`/`clientSecret` and the `client_credentials`
  grant, under the Authentication Bar. List it in the area's divergences file.

## Paging

None followed. `project list` sends `limit=100`; `scan list` sends `limit=<--last>` (default
100) and `project-id` when given. When `filteredTotalCount` exceeds the returned count, the
contract wrote a warning to stderr (`N projects found; only showing first M`). Carry that
as an envelope warning and decide in the integration whether to page with `offset`.

## Special HTTP needs

- Token exchange as above, through `ctx.fetch`, never written to disk.
- Paths are relative to `baseUrl` (`projects`, `scans`, `results/summary?scan-id=`), so
  `baseUrl` must include `/api`.

## Context inputs

None at group level. `--project` is a project UUID filter on `scan list`. Nothing from the
git remote.

## Supported version

Not applicable as a release number: cloud only. The API is Checkmarx One's REST API under
`/api`; no version is pinned in the source.

## Watch for

- Build exactly: the `azp` lookup with the `ast-app` fallback, the 60 s refresh margin, the
  query keys `project-id` and `scan-id`, and returning the bare `projects`/`scans` arrays.
- Pin: an exchange response without `expires_in` gives a `NaN` expiry, so every request
  re-exchanges.
- Pin: `project list` silently stops at 100 (only a stderr line).
- Pin: `--last` uses `parseInt`, so `5abc` is accepted as 5; `--last 0` is sent as `limit=0`.
  The source passes no sort, so "last N" relies on the server's default order (unverified).
- Pin: `tenantName` goes into the token URL path unencoded.
- The contract's non-OK exchange error omitted the endpoint; core's error names it.
- Dry-run printed only the data request and skipped the exchange; keep it from minting.
- The contract named meta commands `project-list`, `scan-stats` and so on, not the
  contract's spaced paths.
