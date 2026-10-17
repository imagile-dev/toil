# JFrog Artifactory (`artifactory`)

Wave 1 · Integration issue #27 · Suspected bugs #82 · 9 contract commands

## Commands

- Health: `artifactory ping`
- Repositories and items: `artifactory repos`, `artifactory artifact-info`, `artifactory properties-get`, `artifactory properties-set`, `artifactory search`
- Build Integration: `artifactory builds`, `artifactory build-runs`, `artifactory build-info`
- Moved in by decision 6: `artifactory outdated` and `artifactory license-check`. The contract lists them as `deps outdated` and `deps license-check`, which stay as aliases. They are not in the count of 9.

## Auth

- Credential: an access or identity token (Edit Profile, Generate an Identity Token).
- Config keys: `artifactory.baseUrl` (`TOIL_ARTIFACTORY_BASE_URL`), `artifactory.token` (`TOIL_ARTIFACTORY_TOKEN`).
- Repo keys used only by `outdated` / `license-check`: `artifactory.npmRepo` (`TOIL_ARTIFACTORY_REPO_NPM`), `artifactory.nugetRepo` (`TOIL_ARTIFACTORY_REPO_NUGET`), `artifactory.mavenRepo` (`TOIL_ARTIFACTORY_REPO_MAVEN`).
- No CI fallback env var.
- Header: `Authorization: Bearer <token>`. No exchange. Every command refuses up front if the base URL or token is missing.

## Paging

- None. `repos` and the build calls return the server's full list.
- `search` is bounded by AQL `.limit(N)`, default 100, with results sorted `created` descending.

## Special HTTP needs

- `ping` (`GET api/system/ping`) sends `Accept: text/plain` and returns the text body as `data`. It skips the predecessor's 429 retry, and its error text is the JSON `message` or `HTTP <status> <text>`.
- `search` POSTs a raw AQL string to `api/search/aql` with `Content-Type: text/plain`: `items.find({...}).include(...).sort({"$desc":["created"]}).limit(N)`. Criteria: `repo` `$eq`, `name` / `path` `$match`, `created` `$gt` / `$lt`. At least one of `--repo`, `--name`, `--path` is required.
- `properties-get` is `GET api/storage/<repo>/<path>?properties=` (an empty value). `properties-set` is a `PUT` with `properties=k=v;k2=v2` in the query and `recursive=1` only when `--recursive` is set. `;` and `=` are percent-encoded, but commas are restored to literal, because the predecessor un-encodes `%2C` in every query string. Core must keep that comma behavior.
- `builds` has `--timeout <s>`, default 60 s, positive integer only. Every other call uses a 30 s timeout.
- `build-runs` / `build-info` percent-encode the name and number. `artifact-info` / `properties-*` do not encode repo or path, and strip one leading `/` from the path.
- Base URLs with a context root (`/artifactory`) must keep it. The predecessor strips the leading `/` from request paths for that reason.
- `outdated` / `license-check` use their own `fetch` with a 15 s timeout, only an `Authorization` header, and plain `${baseUrl}/api/...` string concatenation. Calls: `api/npm/<repo>/<name>` (scoped names as `@scope%2Fname`), `api/nuget/v3/<repo>/flatcontainer/<lower>/index.json`, `api/nuget/v3/<repo>/registration/<lower>/<version>.json`, and `api/search/latestVersion?g=&a=&repos=`, which returns text. Any failure becomes `null`, not an error. One package at a time, sequentially.

## Context inputs

- No group flags and no config defaults for the core nine.
- `outdated` / `license-check` scan the direct dependencies of the git repository root (`Not inside a git repository.` otherwise), and take `--ecosystem` (`npm`, `nuget`, `maven`, `all`). `outdated` adds `--major` / `--minor` / `--patch` filters; `license-check` adds `--include-dev`. An ecosystem without a configured repo key lands in `uncheckedEcosystems` (outdated) or gets `license: null`.

## Supported version

Not established. The code uses the classic REST API under `api/` plus AQL, and Bearer tokens. No minimum is named anywhere in the source.

## Watch for

- `builds` derives `name` by stripping slashes from each `uri`, and adds a `hint` string when the list is empty. Pin both.
- `properties-set` returns `{repo, path, properties}` built locally, not the server's response. A `key=value` with no key, or no pairs at all, is a usage error.
- Without `--recursive`, nothing is sent, so the server's folder default (likely recursive) applies (#82 item 1, pin).
- Property values are not escaped, and commas become multi-values (#82 item 2, pin).
- `search --properties` adds `"properties"` to `.include()`, likely invalid AQL (#82 item 3, pin).
- Unencoded repo and path (#82 item 4) and unescaped AQL values (#82 item 5): pin.
- `--limit 0` gives 100, and negative values pass through (#82 item 6, pin).
- `outdated` / `license-check` first ran a connectivity probe that pinged Artifactory and also the public OSV service, cached per process. They fail with status 503 if Artifactory is unreachable or rejects the token. The OSV probe's result is unused by these two commands. **Decided: drop the OSV call.** Principle 9 allows traffic to a public API only when the command names that service, and these don't, so the port never contacts OSV here. That is a change a principle requires: list it in `docs/divergences/artifactory.json` (behavior only, `principle: "9"`). Keep the Artifactory probe and its 503 failure as they were.
- Maven licenses are always `null` by design. NuGet returns `See licenseUrl` when only `licenseUrl` is present.
