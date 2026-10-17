# Azure DevOps Server (`ado`)

Wave 2 · Integration issue #22 · Suspected bugs #69 · 56 contract commands

## Commands

- **Top level:** `whoami`, `connection-data` (both call `connectionData`; the output is identical)
- **project:** `list-collections`, `list`, `get`
- **work:** `get`, `create`, `update`, `transition`, `assign`, `link`, `search`, `list-comments`, `add-comment`, `add-tag`, `remove-tag`, `list-attachments`, `add-attachment`, `download-attachment`, `list-areas`, `list-iterations`, `types`, `list-states`, `fields`, `schema`
- **repo:** `list`, `create`, `get`, `list-prs`, `get-pr`, `create-pr`, `update-pr`, `merge-pr`, `abandon-pr`, `list-comments`, `add-comment`, `add-inline-comment`, `reply-comment`, `resolve-comment`, `delete-comment`, `list-files`, `diff`, `get-build-status`, `list-reviewers`, `list-default-reviewers`, `approve`, `unapprove`, `wait-for-author`, `list-builds`
- **pipeline:** `list`, `get`, `run`, `list-runs`, `get-run`, `cancel-run`, `logs`

## Auth

- Personal access token. `ado.baseUrl` (`TOIL_ADO_BASE_URL`) and `ado.pat` (`TOIL_ADO_PAT`).
- CI fallback: `SYSTEM_ACCESSTOKEN` (Azure Pipelines), read after `TOIL_ADO_PAT` and before stored config.
- Header: `Authorization: Basic base64(":" + pat)`, empty username. No token exchange.
- Other stored keys: `ado.fieldAliases`, `ado.discoveredFields`, `ado.discoveredTypes`, written into the global config by `work fields --save` and `work types --save`. Those writes must carry through every other key.

## Paging

- **Continuation header:** `x-ms-continuationtoken` on the response is sent back as the `continuationToken` query parameter until the header is absent. No cap. Used by `project list`, `pipeline list`, and `repo list-builds`.
- **`pipeline list-runs`:** `--top` defaults to 50, so it is always one request with `$top`, sliced to `--top`. `--top 0` is falsy and falls through to the unbounded continuation loop, fetching every run (#69, pin).
- **`repo list-prs`:** `$top=100` and `$skip`, looping until a page is shorter than 100. No cap. This endpoint has no continuation token.
- Everything else is one request: collections, repos, PR threads, iterations, statuses, policy configurations, fields, types, states, build logs.

## Special HTTP needs

- `api-version=7.1` on every request, except `connectionData` (`7.1-preview.1`) and work item comments (`7.1-preview.4`). Keep all three exactly.
- JSON Patch: work create, update, transition, assign, link, tags and the attachment link send `Content-Type: application/json-patch+json`.
- **Raw upload:** `work add-attachment` reads the file, POSTs the bytes as `application/octet-stream` to `/_apis/wit/attachments?fileName=<basename>` (60 s timeout), then PATCHes an `AttachedFile` relation onto the item. The input file is subject to the workspace bound.
- **Binary download, server-supplied URL:** `work download-attachment` fetches the relation's absolute `url` (`Accept: application/octet-stream`, 60 s). Core re-points it at the configured origin (#69 item 1, fixed as a divergence). The predecessor wrote `basename(name)` under `--dir`, defaulting to the predecessor's own dot-folder in the working directory, and overwrote existing files. The port writes inside the workspace and never overwrites. Output: `{ saved, name, size }`.
- **Text:** `pipeline logs --log-id` sends `Accept: text/plain` and returns `{ log: <text> }`. Without `--log-id` it lists the logs. `--id` is an alias of `--build-id`.
- **Polling:** `pipeline run --wait` polls `getBuild` every `--poll` seconds (default 10) until `status` is `completed`, up to `--timeout` seconds (default 600). That needs a per-command time limit above 120 s. A `result` other than `succeeded` sets exit code 1 but still returns the success envelope.
- Links are built from config, not from the server: `work link` and `work create --parent` send `<baseUrl>/<collection>/_apis/wit/workitems/<id>`.
- Default per-request timeout is 30 s.

## Context inputs

- Group flags: `ado --collection --organization --project --repo`. `--organization` is an alias of `--collection`.
- Resolution, per input: flag, then the git remote, then `defaults.ado.{collection,project,repo}` (global and repo config merged, repo wins).
- The remote is parsed only when its host matches `ado.baseUrl`'s hostname, using the `/_git/` shape: `<collection>/<project>/_git/<repo>`. Anything before the collection, such as `/tfs/`, is ignored.
- Collection and project are required by every command, including the server-level ones (#69 item 2). Repo is required by every `repo` command except `list` and `create`.

## Supported version

Azure DevOps Server 2022.1 or later, REST API 7.1 or higher. Requests keep `api-version=7.1` exactly. The area exports `supported` from its `index.ts`, equal to the `supported` block in `site/src/data/integrations/ado.json`. When an older server answers that the requested REST API version is out of range, raise the error with `serverTooOld()` from `src/core/supported.ts`: its message says the server is too old and names the minimum, with the server's own words as `detail`. Which requests are sent does not change.

## Watch for

- Every #69 item is reproduced exactly except item 1. In brief: 2, collection and project are always required; 4, paged and text calls have no 429 retry and bare fetch errors, and read only `message` from error bodies; 5, three remote shapes are misparsed; 6, `--creator` and `--reviewer` are sent as identity GUID filters; 7, `create-pr` double-prefixes a full ref.
- `work create` prints its success envelope before trying the `--parent` link. A failed link is only a warning, and the output never reflects the link (#69, pin).
- `repo list-builds` filters builds by `branchName` = the PR's `sourceRefName`. Builds of the PR merge ref (`refs/pull/<n>/merge`) are probably missed (#69, pin).
- `create-pr --reviewers` help says "IDs or display names", but each value is sent as `{ id }`. `--target` defaults to `main`.
- `merge-pr` reads the PR first and sends `lastMergeSourceCommit` as `''` when it is missing. `--strategy` defaults to `noFastForward`.
- `update-pr --draft` treats any value other than `true` as false.
- `approve`, `unapprove` and `wait-for-author` read `connectionData` for the caller's id, then PUT a vote of 10, 0 or -5.
- `repo list-comments` flattens the threads, skips deleted threads and comments, and sorts by `publishedDate`. `repo diff --path` matches `item.path` with a leading `/` added.
- `work fields` without `--type` lists collection-scoped fields and ignores the project. `work types` makes one extra request per type to get its states.
- Field aliases: built-in defaults plus saved `fieldAliases`, matched ignoring case, spaces and dashes. Keys that don't resolve pass through as reference names.
- `work schema` needs no connection. `--example-only` printed raw JSON without the envelope. As with `jira schema --example-only`, the port returns the example as `data` inside the envelope, listed in `docs/divergences/ado.json` (Output Contract).
