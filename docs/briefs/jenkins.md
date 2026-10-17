# Jenkins (`jenkins`)

Wave 1 · Integration issue #26 · Suspected bugs #80 · 9 contract commands

## Commands

- Pipelines: `jenkins pipeline list`, `get`, `run`, `list-runs`, `get-run`, `logs`
- Named instances: `jenkins instance list`, `add`, `remove`. These read and write the global config only and make no HTTP call, so they are config/CLI-only commands. `add` can prompt for the token.

The envelope's command name is hyphenated: `pipeline-list`, `pipeline-run`, `instance-add`, and so on. The predecessor has client, command and raw-instance tests.

## Auth

- Credential: a Jenkins user name plus API token (your user, Security, API Token).
- Config keys: `jenkins.baseUrl` (`TOIL_JENKINS_BASE_URL`), `jenkins.username` (`TOIL_JENKINS_USERNAME`), `jenkins.apiToken` (`TOIL_JENKINS_API_TOKEN`). No CI fallback.
- Named instances: `jenkinsInstances`, an array in the global config of `{name, baseUrl, username?, apiToken?}`. No env vars.
- Header: `Authorization: Basic base64(username:apiToken)`. Both parts are required. No exchange, and no CSRF crumb is requested.
- The predecessor's connectivity check was `GET /api/json?tree=nodeName` with a 10 s timeout.

## Paging

- None. `list-runs` uses the tree range `builds[...]{0,N}` with `--top` default 25 (positive integer). `get` includes `builds[...]{0,10}`. `list` returns `jobs` for the root or a folder in one call.

## Special HTTP needs

- `pipeline run` POSTs to `/job/<path>/build`, or to `/buildWithParameters` with the parameters in the query string when any `--parameter k=v` is given (repeatable). It reads the `Location` response header and takes the queue ID from `/queue/item/<n>/`. With no match, it fails with "did not return a Location header".
- Polling with `--wait`: it polls `/queue/item/<n>/api/json` until `executable.number` appears, then polls `/job/<path>/<n>/api/json` until `building` is false. Each phase gets its own `--timeout` budget (default 600 s), and the interval is `--poll` (default 10 s). The command can therefore run for 20 minutes, well past 120 s, so it needs a declared time limit. Queue cancellation is detected as `why === null && !blocked && !buildable`.
- `pipeline logs` GETs `/job/<path>/<n>/consoleText`, a text response returned whole as `{log: <text>}`.
- `run` and `logs` use a raw path that skips the predecessor's 429 retry. Its error text is the JSON `message` or `HTTP <status> <text>`.
- Server-supplied `url` fields are returned as data, never followed.

## Context inputs

- Group flag `jenkins --instance <name>` selects a `jenkinsInstances` entry and replaces base URL, username and token wholesale, with no fallback to the default `jenkins.*` values. An unknown name or an entry with no `baseUrl` is an error.
- The predecessor resolved `jenkins.baseUrl` as repo config `defaults.jenkins.baseUrl`, then `TOIL_JENKINS_BASE_URL`, then global config. A checked-in repo file could pick the host that receives the user's credentials, above the env var (#80 item 1, security). This doesn't apply to toil, which has no repository config file at all (CLAUDE.md, Configuration Precedence; noted on #80): there is nothing to port and no divergence to list.
- No git remote use.

## Supported version

Not established. The code uses the classic remote access API (`/api/json` with `tree`, `consoleText`, `/queue/item`). No minimum is named.

## Watch for

- Job names `A/B/C` become `A/job/B/job/C`, each segment percent-encoded (`jobPath`). `--folder` uses the same mapping.
- `run` without `--wait` returns `{queueItemId}`. With `--wait`, it returns the final build and sets exit code 1 when `result` is non-null and not `SUCCESS`, while still emitting a success envelope. Progress lines go to stderr.
- `--timeout` / `--poll` are validated only after the build is triggered (#80 item 2, pin).
- `builds{0,N}` silently caps at 100 builds (#80 item 3, pin). No-parameter runs of a parameterized job POST to `/build` (#80 item 4, pin). `parseInt` accepts `12abc` and negatives for `--number`, `--top`, `--timeout`, `--poll` (#80 item 5, pin).
- `instance list` masks tokens as `***`.
- `instance add` requires `--name` and `--base-url`. It adds `https://` when the scheme is missing, refuses an existing name without `--force`, and returns `{name, baseUrl, overwritten}`. Without `--api-token` on a TTY it prompts for one, and blank skips it.
- `instance remove` errors on an unknown name and returns `{removed}`.
- Both `add` and `remove` read-modify-write the stored array as it is on disk, so keychain references in other entries survive.
