# SonarQube (`sonar`)

Wave 1 · Integration issue #31 · Suspected bugs #92 · 5 contract commands

## Commands

- Project quality: `sonar quality-gate`, `sonar measures`
- Findings: `sonar issues`, `sonar hotspots`
- Listing: `sonar projects`

All five are read-only GETs under `/api/...`. `quality-gate` calls `api/qualitygates/project_status`, `measures` calls `api/measures/component`, `issues` calls `api/issues/search`, `hotspots` calls `api/hotspots/search`, and `projects` calls `api/projects/search`. The predecessor has no tests for this area.

## Auth

- Credential: a SonarQube user token (My Account, Security, Generate Tokens).
- Config keys: `sonar.baseUrl` (`TOIL_SONAR_BASE_URL`), `sonar.token` (`TOIL_SONAR_TOKEN`).
- CI fallback: `SONAR_TOKEN`, read directly below `TOIL_SONAR_TOKEN` and above stored config. There is no fallback for the base URL.
- Header: `Authorization: Bearer <token>`. No token exchange.
- Missing base URL and missing token are separate errors ("SonarQube not configured", "SonarQube credentials not configured").
- The predecessor's connectivity check was `GET /api/system/status` with a 10 s timeout.

## Paging

- Scheme: `p` (1-based page) and `ps` (page size). Single-page defaults are `--page 1`, `--page-size 100`, passed to the server unvalidated.
- `--all` on `issues`, `projects` and `hotspots` loops with `ps=500`, `p=1,2,...` until the collected count reaches `total` or a page comes back empty. There is no cap in the loop itself.
- `total` is read from `total` for issues, and from `paging.total` for projects and hotspots.
- Without `--all`, `data` is the raw server page (with its `paging`/`total` fields). With `--all`, `data` is the flat array of items.

## Special HTTP needs

- Comma lists go in the query with literal commas (`severities`, `types`, `statuses`, `metricKeys`, `resolution`). The predecessor un-encodes `%2C` in every query string, so core must send commas unencoded.
- Optional params are omitted when unset; `branch` is sent only when given.
- Error text comes from the response's `errors[].msg`, joined with `; `.
- Nothing else: no uploads, downloads, server-supplied URLs, polling or long calls. Default per-request timeout 30 s.

## Context inputs

- `--project` on `quality-gate`, `issues`, `measures` and `hotspots` falls back to `defaults.sonar.project` (global config merged with the repo config, repo wins). With neither, the error is "No project specified. Use --project or set defaults.sonar.project in config."
- `projects` takes no project.
- No git remote use.

## Supported version

Not established. The code calls the unversioned Web API (`/api/...`) and sends only a Bearer header; whether older servers accept Bearer for user tokens is not stated in the source.

## Watch for

- `measures --metrics` defaults to `coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating,ncloc`.
- The project key is sent as `componentKeys` for issues, `component` for measures, and `projectKey` for quality gate and hotspots.
- `--resolved` is sent as `resolved=true` only for the exact string `true`; anything else becomes `resolved=false` (#92 item 4, pin).
- `issues --all` fails at page 21 when more than 10,000 issues match, discarding fetched pages (#92 item 1, pin).
- `projects` uses `api/projects/search`, which needs admin rights, so non-admin tokens likely get 403 (#92 item 2, pin).
- `hotspots --resolution` accepts a comma list that the API likely rejects (#92 item 3, pin).
- `--page` / `--page-size` go through `parseInt` with no validation, so `NaN` and over-500 sizes reach the server (#92 item 5, pin).
- `--all` ignores `--page` and `--page-size`.
