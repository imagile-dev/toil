# Sonatype IQ Server (`sonatypeiq`)

Wave 2 · Integration issue #34 · Suspected bugs #90 · 4 contract commands

## Commands

- Applications: `sonatypeiq applications list`, `sonatypeiq applications get`
- Organizations: `sonatypeiq organizations list`
- Policies: `sonatypeiq policies list`
- New per decision 6: `sonatypeiq evaluate`, the policy evaluation that the predecessor ran
  as `deps frisk --source sonatypeiq --application-id <id>`. That old path stays as an alias
  and must keep the `deps frisk` output shape (`tier`, `source`, `sourcesQueried`,
  `sourceErrors`, `scanned`, `vulnerable`, `packages[]` with `vulnerabilities[]`).

The four contract commands return the server response unchanged (`opaque`).

## Auth

User token pair, not a login password: `sonatypeiq.baseUrl` (`TOIL_SONATYPEIQ_BASE_URL`,
e.g. `https://iq.imagile.dev`), `sonatypeiq.userCode` (`TOIL_SONATYPEIQ_USER_CODE`),
`sonatypeiq.passcode` (`TOIL_SONATYPEIQ_PASSCODE`, secret). Sent as
`Authorization: Basic base64(userCode:passcode)`. No exchange, no CI fallback var.

## Paging

None. Every list is one GET returning the full set. The old connectivity probe used
`/api/v2/applications?limit=1`; nothing else passes a limit.

`evaluate` batches the inventory itself: 128 components per evaluation request, as purls
(`pkg:npm/%40scope/name@v`, `pkg:nuget/...`, `pkg:maven/<group>/<artifact>@v`, else
`pkg:generic/...`).

## Special HTTP needs

- **Polling.** `POST /api/v2/evaluation/applications/<internalId>` with
  `{ components: [{ packageUrl }] }`. When the response has `isQueued` and a `resultsUrl`, the
  predecessor polls it up to 10 times, sleeping `2 s × attempt` (about 90 s in all), 60 s
  timeout per request, and fails with a timeout error after the last try. Use core's polling
  helper with a deadline and the command's abort signal.
- **Server-supplied URL.** An absolute `resultsUrl` was fetched as-is with the Basic header;
  a relative one was appended to the base URL. Core re-points it at the configured origin.
- `evaluate` first resolves the public ID with `GET /api/v2/applications?publicId=<id>` and
  uses `applications[0].id`; on any non-OK status it silently falls back to the public ID.
- Results map back by `component.packageUrl`. Only `policyThreatCategory: SECURITY`
  violations count; threat level maps 9+ CRITICAL, 7+ HIGH, 4+ MEDIUM, >0 LOW. With no
  security violations but non-zero vulnerability counts, synthetic `iq-critical-<name>` style
  entries are emitted.

## Context inputs

`--organization-id` on `applications list` and `policies list`; `--public-id` on
`applications get`; `--application-id` (the public ID) on `evaluate`. Nothing from the git
remote. `evaluate` needs an inventory: `--from <file>` or stdin, or a repo scan
(docs/integrations.md). The predecessor required a git repo and scanned it, transitive
included by default.

## Supported version

Not established. The source uses only `/api/v2/` endpoints; no IQ Server release is stated.

## Watch for

- Pin: Sonatype documents the evaluation POST as returning `resultsUrl` with no `isQueued`,
  and the results URL as 404 until ready. If so, the predecessor never polls, reads no
  `components`, and reports zero findings. Unverified; recorded in #91. Verify against a live server.
- Pin: a relative `resultsUrl` without a leading slash would be glued onto the base URL
  with no separator.
- Pin: `applications get` returns the `{ applications: [] }` list wrapper, and an unknown ID
  is an empty list rather than a 404.
- Pin: `applications list --organization-id` sends `organizationId` as a query key; whether
  the server filters on it is unverified. `policies list --organization-id` calls
  `/api/v2/policies/organization/<id>`, also unverified.
- Pin: purls the server normalises differently fail the `packageUrl` lookup and are dropped
  without a warning.
- The old evaluation path called global `fetch` directly, bypassing the shared client's
  dry-run, debug and retry. The integration goes through `ctx.fetch`.
