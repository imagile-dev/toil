# OSV and OSS Index (`osv`, `ossindex`)

Wave 2 · Integration issue #103 · Suspected bugs #91 (under deps) · No contract commands of their own (they come from `deps frisk --source osv|sonatype`)

## Commands

New per decision 6, one source per command (docs/integrations.md):
- `osv vulns`: known vulnerabilities from OSV.dev. Alias: `deps frisk --source osv`, which is
  also `deps frisk` with no `--source` (the predecessor's default).
- `ossindex vulns`: known vulnerabilities from Sonatype OSS Index. Alias:
  `deps frisk --source sonatype` (the old source name).

The contract covers only `deps frisk` (`--ecosystem` default `all`, `--direct-only`,
`--include-dev`). The aliases keep its output: `tier`, `source`, `sourcesQueried`,
`sourceErrors`, `scanned`, `vulnerable`, and `packages[]` (each package plus
`vulnerabilities[]` of `id, summary, severity, cvss, aliases, remediation{fixAvailable,
fixedVersions, advice}, references`). `--source all` and `deps connectivity` are dropped
(divergences/deps.json).

## Auth

- OSV: public API, no credential. Host fixed at `https://api.osv.dev`.
- OSS Index: host fixed at `https://ossindex.sonatype.org`. The predecessor sent no
  credential at all. The plan makes a token optional; its config keys and `TOIL_` env vars
  are not set by the source and must be chosen in the port (OSS Index uses Basic auth with
  the account's username and API token).

## Paging

No server paging. Client batches: OSV `POST /v1/querybatch` with 500 queries per call;
OSS Index `POST /api/v3/component-report` with 128 coordinates per call (its stated limit).
Batches run one after another.

## Special HTTP needs

- Inventory input: `--from <file>` or stdin (`toil deps scan | toil osv vulns`), or a repo
  scan when pointed at one. The predecessor always scanned the git repo root, transitive
  included by default.
- OSV query: `{ package: { name, ecosystem }, version }`, ecosystems mapped `npm`, `NuGet`,
  `Maven` (Maven name `group:artifact`). Results match queries by array index.
- OSS Index coordinates are purls (`pkg:npm/%40scope/name@v`, `pkg:nuget/...`,
  `pkg:maven/<group>/<artifact>@v`); results match back by `coordinates` string.
- OSS Index 429 becomes an error advising an account to raise the limit.
- Timeouts were 30 s per request.

## Context inputs

`--ecosystem`, `--direct-only`, `--include-dev` per command. No connection context beyond
the optional OSS Index token.

## Supported version

Not applicable: public hosted APIs, OSV `/v1` and OSS Index `/api/v3`.

## Watch for

- Port exactly: severity from `database_specific.severity`, else CVSS (9 CRITICAL, 7 HIGH,
  4 MEDIUM, else LOW; no score is UNKNOWN); fixed versions from `SEMVER`/`ECOSYSTEM` range
  `fixed` events; OSS Index CVE aliases scraped from name, title and description.
- Pin: OSV `querybatch` returns only `id` and `modified` per vulnerability, so summary,
  severity, fixed versions and references come back empty or UNKNOWN unless each ID is
  fetched from `/v1/vulns/<id>`. The predecessor never does. Also `next_page_token` is ignored.
  Unverified against the live API; recorded in #91.
- Pin: the OSS Index 429 advice tells users to add credentials the predecessor never reads.
- Pin: OSS Index may return normalised coordinates; a mismatch drops the package silently.
- Pin: the predecessor probed reachability before every run (an empty batch, 400 counted
  as up) and failed with 503 if unreachable. Probes now belong to `config test`.
- Check whether OSS Index still serves anonymous requests; if not, the token is not optional.
- The old clients used global `fetch` directly, bypassing dry-run, debug and retry.
