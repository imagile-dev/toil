# Sauce Labs (`saucelabs`)

Wave 2 · Integration issue #30 · Suspected bugs #71 · 49 contract commands

## Commands

- **Top level:** `status`, `concurrency`, `platforms`, `appium-versions`, `users`
- **job:** `list`, `get`, `update`, `stop`, `delete`, `assets`
- **rdc-job:** `list`, `get`, `update`, `stop`, `delete`
- **build:** `list`, `get`, `jobs`, `for-job`
- **device:** `list`, `get`, `status`
- **session:** `list`, `create`, `get`, `delete`, `open-url`, `shell`, `install-app`, `installations`, `launch-app`, `uninstall-app`, `settings`, `start-test`, `end-test`, `tests`, `network-profiles`, `network`, `appium`
- **tunnel:** `list`, `get`, `jobs`, `stop`
- **storage:** `files`, `groups`
- **team:** `list`, `get`, `members`

Most ids are **positional arguments**, not flags: `<job-id>`, `<build-id>`, `<device-id>`, `<session-id>`, `<tunnel-id>`, `<team-id>`. `session open-url` and `session shell` also take `<url>` and `<command>`, and `session install-app` takes `<app>`. Declare them with the command's `args`, which maps each positional onto an input field on both front doors (K1's area API), as `jira`'s and `db`'s commands do.

## Auth

- Username plus access key. No token exchange.
- **Base URL:** `saucelabs.baseUrl` (`TOIL_SAUCELABS_BASE_URL`). There's no default. It's the data-center endpoint, for example `https://api.us-west-1.saucelabs.com`, and the not-configured fix names that example.
- **Username:** `saucelabs.username` (`TOIL_SAUCELABS_USERNAME`). CI fallback `SAUCE_USERNAME`.
- **Access key:** `saucelabs.accessKey` (`TOIL_SAUCELABS_ACCESS_KEY`). CI fallback `SAUCE_ACCESS_KEY`.
- Each fallback is read after the `TOIL_` var and before stored config.
- Header: `Authorization: Basic base64(username:accessKey)`.
- The username also goes into most `/rest/v1/<username>/...` paths.
- Credential check: `concurrency` (`/rest/v1.2/users/<username>/concurrency`), which `config test` also uses. Sauce has no "current user" endpoint.

## Paging

There is no paging loop. Each list is one request, and the paging parameters are passed straight through:

| Command | Parameters |
|---------|------------|
| `job list` | `limit`, `skip` |
| `rdc-job list`, `build list`, `users` | `limit`, `offset` (`users` help: default 20, max 100) |
| `storage files`, `storage groups` | `page`, `per_page` (help: max 100) |

`count` is the array's length, and it's omitted when the payload isn't an array.

## Special HTTP needs

- **Repeated query keys:** `build list --status` (repeatable or comma-separated) becomes `status=a&status=b`.
- **Polling:** `session create --wait` polls `GET /rdc/v2/sessions/<id>` every 5 s.
  - It stops at `ACTIVE`.
  - `CLOSING`, `CLOSED` or `ERRORED` is an error.
  - `--timeout` defaults to 300 s, so it needs a per-command time limit above 120 s. The timeout error says the session keeps starting in the background.
- **Long timeout:** `session shell` uses a 120 s per-request timeout. Everything else uses 30 s.
- **Error bodies:** Sauce's v2 and rdc APIs return FastAPI-style `{ detail: "..." }`. The shared parser reads `detail` after `message`.
- **Several API families on one host:**
  - `/rest/v1`, `/rest/v1.2`, `/v1/rdc`, `/rdc/v2` (Real Device Access)
  - `/v2/builds/<vdc|rdc>/` and `/team-management/v1/`, which are Django-style and keep their trailing slash
  - `/v1/storage`
- No downloads or uploads. `job assets` lists names only, and storage is metadata only.

## Context inputs

There are no group-level flags and no named instances. The only implicit input is the configured username, used in paths.

## Supported version

Not established. Sauce Labs is SaaS only, and the API versions are fixed in the paths above. The region is chosen by `baseUrl`.

## Watch for

- Every #71 item is reproduced exactly:
  - 1: `tunnel list --all` returns an object and no `count`.
  - 2: tunnel commands always use your own username.
  - 3: the `--sort` help says creation time.
  - 4: offset-less ISO date-times are read in local time.
  - 5: `--modified-since` is sent raw.
  - 6: `rdc-job --offset` may be 1-based.
  - 7: `--wait` gives up as much as one poll early.
- **Date flags:** `parseUnixTime` accepts Unix seconds as-is, or anything `Date.parse` reads, floored to seconds.
- **Integer flags:** `parseIntOption` accepts non-negative integers only.
- **Enum flags:** matched ignoring case, then sent with the canonical spelling. For example `--os android` is `ANDROID` on `device list`, but `android` on `session create`.
- **Outputs built by the command, not passed through:**
  - Deletes return `{ jobId, deleted: true }`. `rdc-job stop` returns `{ jobId, stopped: true }`.
  - `session open-url`, `launch-app`, `uninstall-app` and `settings` echo their input.
  - `session shell` returns `{ sessionId, command, stdout }`.
  - Lists wrap the payload: `{ count, jobs }`, `{ source, count, builds }`, `{ api, count, platforms }`, and so on.
- **Mutual exclusions, checked before any request:**
  - `job update` / `rdc-job update`: `--passed` or `--failed`, and at least one field.
  - `session launch-app` / `uninstall-app`: exactly one of `--bundle-id` or `--package-name`. `--activity` requires `--package-name`.
  - `session network`: exactly one mode (profile, reset, or explicit conditions), with range checks.
  - `--tunnel-owner` requires `--tunnel-name`. `--appium-version` requires `--start`.
- `session install-app --no-instrumentation`: `enableInstrumentation` defaults to `true`.
- `tunnel list` always sends `full=true`.
