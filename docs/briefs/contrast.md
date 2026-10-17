# Contrast Security (`contrast`)

Wave 2 · Integration issue #33 · Suspected bugs #87 · 5 contract commands

## Commands

- Applications: `contrast apps list`
- Findings: `contrast findings list`, `contrast findings get`
- Libraries: `contrast libraries list`, `contrast libraries get`

Every command's output is the server response passed through (`opaque` in the
contract), except `libraries get`, which returns the one matching library object.

## Auth

Three secrets and two plain settings, all from **User Settings → Your Keys**:
`contrast.baseUrl` (`TOIL_CONTRAST_BASE_URL`), `contrast.orgUuid` (`TOIL_CONTRAST_ORG_UUID`),
`contrast.username` (`TOIL_CONTRAST_USERNAME`), `contrast.apiKey` (`TOIL_CONTRAST_API_KEY`, secret),
`contrast.serviceKey` (`TOIL_CONTRAST_SERVICE_KEY`, secret). No CI fallback var.

Every request sends two auth headers:
- `Authorization: base64(username:serviceKey)`, with **no** `Basic ` prefix. That is Contrast's
  format; match it exactly.
- `API-Key: <apiKey>`.

Base URL is the instance root (`https://contrast.imagile.dev`, or the SaaS root
`https://app.contrastsecurity.com`); paths start `/Contrast/api/ng/<orgUuid>/...`. No token exchange.

## Paging

Offset paging: `--limit` (default 25) and `--offset` (default 0) go straight to the
`limit`/`offset` query keys on `apps list`, `findings list` and `libraries list`. No cap is
enforced and no follow-up page is fetched; the caller pages by hand.

`libraries get --hash` pages internally: it requests `applications/<app>/libraries` in
batches of 25, stops at the first item whose `hash` equals the flag, or when a page returns
fewer than 25 items. Not found is a 404 `ToilError` naming the hash and app.

## Special HTTP needs

- `API-Key` is a custom auth header: core must refuse a cross-origin redirect, because Node
  strips `Authorization` but keeps `API-Key`.
- `findings list` is a GET on `traces/<app>/filter` with `severities` and `statuses` query keys;
  a comma-separated value (`HIGH,CRITICAL`) must go out with literal commas, as the
  predecessor's URL builder restores them.
- The predecessor follows no server-supplied URLs. The audit lists Contrast among the users
  of core's URL re-pointing; confirm whether any of its commands follows a `links` href before
  relying on it.

## Context inputs

`orgUuid` is a connection setting, required on every command (missing it is a config error
with a `config set contrast.orgUuid` fix). `--app <app-id>` is required per command on
findings and libraries. Nothing comes from the git remote.

## Supported version

Not established. The source targets the TeamServer "ng" REST API (`/Contrast/api/ng/`) on
both SaaS and self-hosted; no minimum release is stated anywhere in the source or docs.

## Watch for

- Match exactly: the prefix-less `Authorization` value, the 25/0 defaults, the query key
  names `severities`/`statuses`, and `libraries get` returning the bare matching object.
- Pin: `--limit`/`--offset` use `parseInt` with no validation, so `--limit abc` sends `NaN`.
- Pin: `libraries get` has no page cap. A server that ignores `offset` and keeps returning 25
  items loops forever; a large app makes many requests.
- Pin: `--severity`/`--status` values are not checked against the listed choices.
- The predecessor's dry-run redacts both auth headers; core's redaction must cover `API-Key`.
